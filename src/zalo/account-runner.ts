import {
  GroupEventType,
  ThreadType,
  Zalo,
  type API,
  type Credentials,
  type GroupEvent,
  type GroupMessage,
  type Reaction,
  type Undo,
  type UserMessage,
} from "zca-js";
import type { AssistantService } from "../assistant/assistant-service.js";
import { reportFileExtension, type GeneratedReportFile } from "../reports/report-exporter.js";
import { splitForZalo } from "../assistant/assistant-service.js";
import type { AppConfig } from "../config.js";
import { AssistantTurnStatus, AttachmentStatus, BotAccountStatus, CLOSE_CODE_DUPLICATE, CLOSE_CODE_KICKED, ContactRole, ConversationType, MessageKind, SessionEvent } from "../constants.js";
import { decryptJson } from "../crypto/session-cipher.js";
import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import { sanitizeFileName, type AttachmentDownloader } from "../sync/attachment-downloader.js";
import type { FileStorage } from "../storage/file-storage.js";
import { findContactByUid, setContactZaloProfile, upsertMemberContact, type ContactRow } from "../sync/contact-repository.js";
import {
  directKey,
  ensureGroup,
  findThread,
  findThreadById,
  groupKey,
  markBotInGroup,
  markBotLeftGroup,
  markBotLeftMissingGroups,
  type GroupRow,
} from "../sync/group-repository.js";
import {
  ingestDirectMessage,
  ingestGroupMessage,
  recallGroupMessage,
  recallMessage,
  OUTGOING_SOURCE,
  recordOutgoingMessage,
  type IncomingGroupMessage,
} from "../sync/message-ingest.js";
import { parseZaloContent } from "./content-parser.js";
import { describeGroupEvent, namesToLookup } from "./group-event-text.js";
import { registerGroupHistoryApi, type HistoryPage } from "./group-history.js";
import { ZaloSender } from "./zalo-sender.js";
import { GroupAssistantReplier } from "./group-assistant-replier.js";
import { ACK_DELAY_MS, pickAckText } from "./assistant-ack.js";
import { AckTracker, enqueueDirectReply, type AckState, type DirectReplyPayload, type GroupReplyPayload } from "./reply-jobs.js";
import type { JobRow } from "../jobs/job-queue.js";
import { recordReaction } from "../flags/message-flags.js";
import { syncGroupMembers, type GroupInfoSource } from "../sync/member-sync.js";
import {
  recordSessionEvent,
  setAccountStatus,
  touchHeartbeat,
  type BotAccountRow,
} from "./bot-account-repository.js";

// Sự kiện nhóm làm đổi danh sách thành viên → đồng bộ lại thành viên nhóm đó
const MEMBER_CHANGING_EVENTS = new Set<string>([
  GroupEventType.JOIN,
  GroupEventType.LEAVE,
  GroupEventType.REMOVE_MEMBER,
  GroupEventType.BLOCK_MEMBER,
  GroupEventType.ADD_ADMIN,
  GroupEventType.REMOVE_ADMIN,
  GroupEventType.UPDATE,
]);
// Nghỉ giữa hai lần hỏi Zalo lúc quét cả loạt nhóm — đừng dồn dập kẻo bị đánh dấu là máy
const GROUP_SCAN_PAUSE_MS = 1500;
// Lấy tin cũ từng trang: tối đa ngần này trang, mỗi trang chờ tối đa / nghỉ giữa hai trang
const BACKFILL_MAX_PAGES = 20;

export interface BackfillProgress {
  pages: number;
  fetched: number;
  stored: number;
  oldest: Date | null;
}

export interface BackfillResult extends BackfillProgress {
  method: string;
}

export interface BackfillOptions {
  /** Trần số trang (50 tin / trang). */
  maxPages: number;
  /** Dừng khi hai trang liền nhau không có tin mới (đã lấy từ trước). */
  stopWhenKnown: boolean;
  onProgress?: (progress: BackfillProgress) => void;
}
const BACKFILL_PAGE_TIMEOUT_MS = 10_000;
const BACKFILL_PAGE_PAUSE_MS = 1500;

function oldestOf(messages: (GroupMessage | UserMessage)[]): Date | null {
  const oldest = messages.reduce((min, message) => Math.min(min, Number(message.data.ts) || Infinity), Infinity);
  return Number.isFinite(oldest) ? new Date(oldest) : null;
}

export function toIncomingGroupMessage(message: GroupMessage | UserMessage): IncomingGroupMessage {
  const { data } = message;
  return {
    zaloGroupId: message.threadId,
    msgId: String(data.msgId),
    cliMsgId: String(data.cliMsgId ?? ""),
    msgType: data.msgType ?? "",
    senderUid: String(data.uidFrom),
    senderName: data.dName ?? "",
    sentAtMs: Number(data.ts) || Date.now(),
    content: data.content,
    quote: data.quote ? { globalMsgId: data.quote.globalMsgId, msg: data.quote.msg ?? "", ownerUid: String(data.quote.ownerId ?? "") } : null,
    mentions: "mentions" in data
      ? data.mentions?.map((mention) => ({ uid: mention.uid, pos: mention.pos, len: mention.len })) ?? null
      : null,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Báo bộ chạy việc có việc mới (src/jobs/job-runner.ts → wake). */
export interface JobWaker {
  wake(): void;
}

export class AccountRunner {
  private api: API | null = null;
  private ownUid = "";
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly log;

  private readonly sender: ZaloSender;
  private readonly groupReplier: GroupAssistantReplier;
  // Đang chờ một trang tin cũ của nhóm (lấy tin cũ kiểu từng trang qua kết nối trực tiếp)
  private oldGroupPageWaiter: ((messages: GroupMessage[]) => void) | null = null;
  // «Em nhận được rồi» cho câu hỏi riêng đang nằm trong hàng đợi
  private readonly acks = new AckTracker();
  // Người nhắn riêng đã hỏi Zalo ảnh đại diện trong phiên này — mỗi người hỏi một lần
  private readonly avatarAsked = new Set<string>();

  constructor(
    private readonly account: BotAccountRow,
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly downloader: AttachmentDownloader,
    private readonly storage: FileStorage,
    private assistant: AssistantService | null,
    private readonly jobs: JobWaker,
  ) {
    this.log = createLogger(`zalo:${account.label}`);
    this.sender = new ZaloSender(config.assistant.sendIntervalMs);
    this.groupReplier = new GroupAssistantReplier({
      db, config, sender: this.sender, log: this.log, accountId: account.id,
      getApi: () => this.api,
      getAssistant: () => this.assistant,
      jobs,
      getBot: () => ({ uid: this.ownUid, name: this.account.display_name || this.account.label }),
      sendReportFile: (thread, file) => this.sendReportFile(thread, file),
    });
  }

  async start(): Promise<boolean> {
    const zalo = new Zalo({ selfListen: false, checkUpdate: false, logging: false });
    try {
      const credentials = decryptJson<Credentials>(this.account.session_cipher!, this.config.sessionEncryptionKey);
      this.api = await zalo.login(credentials);
    } catch (error) {
      // Phiên hết hạn hoặc bị thu hồi — phải quét QR lại: npm run cli -- login <nhãn>
      await setAccountStatus(this.db, this.account.id, BotAccountStatus.NeedsLogin);
      await recordSessionEvent(this.db, this.account.id, SessionEvent.LoginCookieFailed, null, describeError(error));
      this.log.error("đăng nhập bằng phiên đã lưu thất bại — cần quét QR lại", error);
      return false;
    }
    this.ownUid = this.api.getOwnId();
    await recordSessionEvent(this.db, this.account.id, SessionEvent.LoginCookieOk);
    // Chính tài khoản bot cũng vào Danh bạ kèm ảnh — để màn Hội thoại hiện đúng ảnh của bot
    this.api.fetchAccountInfo()
      .then((info) => {
        const profile = (info as { profile?: { displayName?: string; zaloName?: string; avatar?: string; globalId?: string } }).profile ?? {};
        return upsertMemberContact(this.db, this.ownUid, profile.displayName ?? this.account.display_name, profile.zaloName ?? "",
          profile.avatar ?? "", profile.globalId ?? "");
      })
      .catch((error) => this.log.warn("lấy hồ sơ tài khoản bot lỗi", error));
    this.attachListener(this.api);
    this.heartbeat = setInterval(() => {
      touchHeartbeat(this.db, this.account.id).catch((error) => this.log.warn("ghi nhịp tim lỗi", error));
    }, this.config.heartbeatSeconds * 1000);
    // Quét danh sách nhóm chạy nền, không chặn việc nghe tin
    this.scanAllGroups().catch((error) => this.log.warn("quét danh sách nhóm lỗi", error));
    return true;
  }

  /** Trợ lý dựng lại sau khi đổi cài đặt — lượt hỏi đang chạy dở vẫn chạy nốt bằng bản cũ. */
  setAssistant(assistant: AssistantService | null): void {
    this.assistant = assistant;
  }

  setSendInterval(intervalMs: number): void {
    this.sender.setInterval(intervalMs);
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.api?.listener.stop();
    await setAccountStatus(this.db, this.account.id, BotAccountStatus.Disconnected);
    await recordSessionEvent(this.db, this.account.id, SessionEvent.Stopped);
  }

  private get groupSource(): GroupInfoSource {
    const api = this.api!;
    return {
      getGroupInfo: (groupId) => api.getGroupInfo(groupId),
      getGroupMembersInfo: (memberIds) => api.getGroupMembersInfo(memberIds),
    };
  }

  private attachListener(api: API): void {
    const { listener } = api;
    const accountId = this.account.id;

    listener.on("connected", () => {
      this.log.info("đã kết nối");
      // Bù tin lỡ mất lúc bot tắt / mất kết nối — Zalo trả qua sự kiện old_messages
      try {
        listener.requestOldMessages(ThreadType.Group);
        listener.requestOldMessages(ThreadType.User);
      } catch (error) {
        this.log.warn("xin tin cũ lỗi", error);
      }
      void setAccountStatus(this.db, accountId, BotAccountStatus.Connected);
      void recordSessionEvent(this.db, accountId, SessionEvent.Connected);
    });
    listener.on("disconnected", (code, reason) => {
      this.log.warn(`mất kết nối (${code}) ${reason ?? ""}`);
      void setAccountStatus(this.db, accountId, BotAccountStatus.Disconnected);
      void recordSessionEvent(this.db, accountId, SessionEvent.Disconnected, code, reason ?? "");
    });
    listener.on("closed", (code, reason) => {
      const hint =
        code === CLOSE_CODE_DUPLICATE ? " — có nơi khác đang mở Zalo Web bằng tài khoản bot"
        : code === CLOSE_CODE_KICKED ? " — Zalo đá phiên, có thể phải quét QR lại"
        : "";
      this.log.error(`kết nối đóng (${code})${hint}`);
      void setAccountStatus(this.db, accountId, BotAccountStatus.Disconnected);
      void recordSessionEvent(this.db, accountId, SessionEvent.Closed, code, `${reason ?? ""}${hint}`);
    });
    listener.on("error", (error) => {
      this.log.error("lỗi listener", error);
      void recordSessionEvent(this.db, accountId, SessionEvent.Error, null, describeError(error));
    });

    listener.on("message", (message) => {
      if (message.isSelf) return;
      if (message.type === ThreadType.User) {
        this.handleDirectMessage(message).catch((error) => this.log.error(`lưu tin riêng ${message.threadId} lỗi`, error));
        return;
      }
      const incoming = toIncomingGroupMessage(message);
      ingestGroupMessage(
        {
          db: this.db,
          defaults: { readMessages: this.config.defaultGroupRead, captureFiles: this.config.defaultGroupCaptureFiles },
          onNewGroup: (group) => this.onNewGroup(group.id, group.zalo_group_id),
          onAttachmentQueued: (attachmentId) => this.downloader.enqueue(attachmentId),
        },
        accountId,
        incoming,
      )
        // Tin nhóm đang đọc (bot này lưu, hoặc bot khác cùng nhóm lưu trước = "duplicate") mới xét gọi bot.
        // Tin cũ bù lại đi đường old_messages, không qua đây — không làm bot trả lời chuyện cũ.
        .then((outcome) => { if (outcome !== "group_not_read") this.groupReplier.handle(message as GroupMessage, incoming); })
        .catch((error) => this.log.error(`lưu tin nhóm ${message.threadId} lỗi`, error));
    });

    listener.on("old_messages", (messages, threadType) => {
      // Ghi số tin + mốc để biết Zalo đẩy cửa sổ đồng bộ bao xa (không ghi nội dung)
      const oldest = oldestOf(messages);
      this.log.info(`old_messages ${threadType === ThreadType.Group ? "nhóm" : "riêng"}: ${messages.length} tin${oldest ? `, cũ nhất ${oldest.toISOString()}` : ""}`);
      if (threadType === ThreadType.Group && this.oldGroupPageWaiter) {
        this.oldGroupPageWaiter(messages as GroupMessage[]);
        this.oldGroupPageWaiter = null;
      }
      this.ingestOldMessages(messages, threadType === ThreadType.Group)
        .then((stored) => { if (stored) this.log.info(`bù ${stored} tin lỡ mất lúc bot tắt`); })
        .catch((error) => this.log.warn("lưu tin cũ lỗi", error));
    });

    listener.on("undo", (undo: Undo) => {
      const msgId = String(undo.data.content.globalMsgId);
      const recall = undo.isGroup
        ? recallGroupMessage(this.db, undo.threadId, msgId)
        : recallMessage(this.db, directKey(accountId, undo.threadId), msgId);
      recall.catch((error) => this.log.warn("ghi thu hồi tin lỗi", error));
    });

    // Thả / gỡ cảm xúc lên tin (IDA câu 8: thả cảm xúc = «đã xem») — ghi để phase 5 biết tin đã có người xem
    listener.on("reaction", (reaction: Reaction) => {
      this.handleReaction(reaction).catch((error) => this.log.warn("ghi cảm xúc lỗi", error));
    });

    listener.on("group_event", (event: GroupEvent) => {
      this.handleGroupEvent(event).catch((error) => this.log.warn(`xử lý sự kiện nhóm ${event.type} lỗi`, error));
    });

    listener.start({ retryOnClose: true });
  }

  private async handleReaction(reaction: Reaction): Promise<void> {
    if (reaction.isSelf) return;
    const thread = await findThread(this.db, reaction.isGroup ? groupKey(reaction.threadId) : directKey(this.account.id, reaction.threadId));
    if (!thread?.read_messages) return;
    const { data } = reaction;
    for (const target of data.content.rMsg ?? []) {
      await recordReaction(this.db, {
        groupId: thread.id, zaloMsgId: String(target.gMsgID), reactorUid: String(data.uidFrom), icon: String(data.content.rIcon ?? ""),
        at: new Date(Number(data.ts) || Date.now()),
      });
    }
  }

  /**
   * Lưu một loạt tin cũ (bù lúc tắt / lấy lịch sử nhóm). CHỈ LƯU — không trả lời câu hỏi cũ, kẻo bot
   * trả lời lại cả loạt. Tin trùng tự bỏ qua (khóa duy nhất của message).
   */
  private async ingestOldMessages(messages: (GroupMessage | UserMessage)[], isGroup: boolean): Promise<number> {
    let stored = 0;
    const deps = {
      db: this.db,
      defaults: { readMessages: this.config.defaultGroupRead, captureFiles: this.config.defaultGroupCaptureFiles },
      directDefaults: { readMessages: this.config.defaultDirectRead, captureFiles: this.config.defaultDirectCaptureFiles },
      onNewGroup: (group: GroupRow) => this.onNewGroup(group.id, group.zalo_group_id),
      onAttachmentQueued: (attachmentId: number) => this.downloader.enqueue(attachmentId),
    };
    // Cũ trước mới sau — để Danh bạ ghi đúng "lần nhắn gần nhất"
    const ordered = [...messages].sort((a, b) => Number(a.data.ts) - Number(b.data.ts));
    for (const message of ordered) {
      if (isGroup) {
        if ((await ingestGroupMessage(deps, this.account.id, toIncomingGroupMessage(message))) === "stored") stored += 1;
      } else if (!message.isSelf) {
        if ((await ingestDirectMessage(deps, this.account.id, toIncomingGroupMessage(message))).outcome === "stored") stored += 1;
      }
    }
    return stored;
  }

  /**
   * Lấy tin cũ của một nhóm từ Zalo về kho (nút «Lấy tin cũ», hoặc lúc vừa bật đọc nhóm).
   *
   * Đường chính: `/api/cm/getrecentv2` — đường Zalo Web đang dùng, phân trang bằng lastMsgId (xem
   * `group-history.ts`). Đường cũ của zca-js (`getGroupChatHistory`) trả 404 từ ~06/2026. Hỏng cả hai thì
   * lách như openzca: xin TỪNG TRANG tin cũ qua kết nối trực tiếp (requestOldMessages).
   *
   * Lặp lại lần sau: `stopWhenKnown` — hai trang liền nhau không có tin mới thì dừng (đã có trong kho rồi).
   */
  async backfillGroup(zaloGroupId: string, options: BackfillOptions): Promise<BackfillResult> {
    if (!this.api) throw new Error("bot chưa kết nối");
    let fetchPage: ReturnType<typeof registerGroupHistoryApi>;
    try {
      fetchPage = registerGroupHistoryApi(this.api);
    } catch (error) {
      this.log.warn(`không đăng ký được đường lịch sử nhóm (${describeError(error)}) — chuyển sang xin từng trang`);
      return this.backfillByPages(zaloGroupId);
    }
    let cursor = 0;
    let fetched = 0;
    let stored = 0;
    let oldest: Date | null = null;
    let pages = 0;
    let pagesWithoutNew = 0;
    for (; pages < options.maxPages; pages += 1) {
      let page: HistoryPage;
      try {
        page = await fetchPage(zaloGroupId, cursor);
      } catch (error) {
        if (pages === 0) {
          const code = (error as { code?: unknown }).code;
          this.log.warn(`đường lịch sử nhóm (getrecentv2) hỏng (${describeError(error)}${code ? `, mã ${String(code)}` : ""}) — chuyển sang xin từng trang`);
          return this.backfillByPages(zaloGroupId);
        }
        this.log.warn(`trang lịch sử ${pages + 1} lỗi, dừng ở đây: ${describeError(error)}`);
        break;
      }
      // Mốc 0 Zalo chỉ trả KHOẢNG mã tin (minMsgId…maxMsgId) kèm isFiltered, không trả tin — đi lại từ maxMsgId
      if (!page.messages.length && cursor === 0 && Number(page.maxMsgId)) {
        cursor = Number(page.maxMsgId) + 1;
        pages -= 1;
        continue;
      }
      if (!page.messages.length) break;
      const storedNow = await this.ingestOldMessages(page.messages, true);
      fetched += page.messages.length;
      stored += storedNow;
      const pageOldest = oldestOf(page.messages);
      if (pageOldest && (!oldest || pageOldest < oldest)) oldest = pageOldest;
      options.onProgress?.({ pages: pages + 1, fetched, stored, oldest });
      pagesWithoutNew = storedNow ? 0 : pagesWithoutNew + 1;
      if (options.stopWhenKnown && pagesWithoutNew >= 2) break;
      const next = Number(page.lastMsgId);
      if (!page.hasMore || !next || next === cursor) break;
      cursor = next;
      await new Promise((resolve) => setTimeout(resolve, BACKFILL_PAGE_PAUSE_MS));
    }
    this.log.info(`lấy tin cũ nhóm ${zaloGroupId} (getrecentv2): ${pages} trang, ${fetched} tin, lưu mới ${stored}, cũ nhất ${oldest?.toISOString() ?? "?"}`);
    // Mây Zalo rỗng («empty cloud msg») thì còn đường đồng bộ qua kết nối trực tiếp — thử nốt
    if (fetched === 0) return this.backfillByPages(zaloGroupId);
    return { fetched, stored, oldest, pages, method: `lịch sử nhóm (${pages} trang)` };
  }

  private async backfillByPages(zaloGroupId: string): Promise<BackfillResult> {
    const listener = this.api!.listener;
    let cursor: string | null = null;
    let fetched = 0;
    let stored = 0;
    let oldest: Date | null = null;
    let pages = 0;
    for (; pages < BACKFILL_MAX_PAGES; pages += 1) {
      const page = await new Promise<GroupMessage[]>((resolve) => {
        const timer = setTimeout(() => {
          this.oldGroupPageWaiter = null;
          resolve([]);
        }, BACKFILL_PAGE_TIMEOUT_MS);
        this.oldGroupPageWaiter = (messages) => {
          clearTimeout(timer);
          resolve(messages);
        };
        listener.requestOldMessages(ThreadType.Group, cursor);
      });
      if (!page.length) break;
      const mine = page.filter((message) => message.threadId === zaloGroupId);
      fetched += mine.length;
      stored += await this.countStored(mine);
      const pageOldest = oldestOf(page);
      const pageOldestMine = oldestOf(mine);
      if (pageOldestMine && (!oldest || pageOldestMine < oldest)) oldest = pageOldestMine;
      // Mốc trang sau = tin cũ nhất của trang này; trang không lùi thêm được thì dừng
      const oldestMessage = [...page].sort((a, b) => Number(a.data.ts) - Number(b.data.ts))[0];
      const nextCursor = String(oldestMessage.data.msgId);
      this.log.info(`trang tin cũ ${pages + 1}: ${page.length} tin (nhóm này ${mine.length}), cũ nhất ${pageOldest?.toISOString() ?? "?"}`);
      if (nextCursor === cursor) break;
      cursor = nextCursor;
      await new Promise((resolve) => setTimeout(resolve, BACKFILL_PAGE_PAUSE_MS));
    }
    this.log.info(`lấy tin cũ nhóm ${zaloGroupId} (từng trang): ${pages} trang, nhóm này ${fetched} tin, lưu mới ${stored}`);
    return { fetched, stored, oldest, pages, method: `từng trang (${pages} trang)` };
  }

  /** Tin của trang đã được handler old_messages lưu; đếm xem bao nhiêu tin đang có trong kho. */
  private async countStored(messages: GroupMessage[]): Promise<number> {
    if (!messages.length) return 0;
    // Chờ handler old_messages lưu xong trang này (chạy song song) rồi mới đếm
    await new Promise((resolve) => setTimeout(resolve, 300));
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM message m JOIN zalo_group g ON g.id = m.group_id
       WHERE g.thread_type = 1 AND g.zalo_group_id = ? AND m.zalo_msg_id IN (?)`,
      [messages[0].threadId, messages.map((message) => String(message.data.msgId))],
    );
    return Number(rows[0].n);
  }

  /** Tin riêng 1-1: lưu + ghi Danh bạ; người có vai trò thì trợ lý trả lời. */
  private async handleDirectMessage(message: UserMessage): Promise<void> {
    const incoming = toIncomingGroupMessage(message);
    const result = await ingestDirectMessage(
      {
        db: this.db,
        defaults: { readMessages: this.config.defaultGroupRead, captureFiles: this.config.defaultGroupCaptureFiles },
        directDefaults: { readMessages: this.config.defaultDirectRead, captureFiles: this.config.defaultDirectCaptureFiles },
        onAttachmentQueued: (attachmentId) => this.downloader.enqueue(attachmentId),
      },
      this.account.id,
      incoming,
    );
    const who = `«${result.contact.display_name || incoming.senderUid}»`;
    void this.ensureContactAvatar(incoming.senderUid);
    // Người lạ (chưa có vai trò): chỉ lưu, không trả lời — đại ca chốt 01/10/2026
    if (!this.assistant || result.contact.role === ContactRole.None) {
      this.log.info(`tin riêng từ ${who}: đã lưu, không trả lời (${this.assistant ? "chưa có vai trò" : "trợ lý tắt"})`);
      return;
    }
    this.log.info(`tin riêng từ ${who}: đang trả lời`);
    const parsed = parseZaloContent(incoming.msgType, incoming.content);
    if (parsed.kind !== MessageKind.Text || !parsed.text.trim()) return;

    // Ghi việc vào hàng đợi rồi đi tiếp — trả lời do bộ chạy việc làm (runDirectReplyJob), mỗi cuộc lần lượt từng câu
    const payload: DirectReplyPayload = {
      accountId: this.account.id, threadId: result.thread.id, senderUid: incoming.senderUid, messageId: result.messageId, question: parsed.text,
    };
    const jobId = await enqueueDirectReply(this.db, payload, incoming.msgId);
    if (!jobId) return;
    this.acks.watchQueued(jobId, () => this.sendAck(result.thread, result.contact, () => false));
    this.jobs.wake();
  }

  /** Bộ chạy việc gọi: trả lời một câu hỏi riêng đã ghi trong hàng đợi. Ném lỗi = việc lỗi (thử lại nếu còn lượt). */
  async runDirectReplyJob(job: JobRow): Promise<void> {
    const payload = job.payload as DirectReplyPayload;
    const ack = this.acks.begin(job.id);
    try {
      if (!this.api) throw new Error("bot chưa kết nối");
      const thread = await findThreadById(this.db, payload.threadId);
      const contact = await findContactByUid(this.db, payload.senderUid);
      if (!thread || !contact) return;
      await this.answerQuestion(thread, contact, payload.messageId, payload.question, ack);
    } finally {
      this.acks.end(job.id);
    }
  }

  /** Bộ chạy việc gọi: trả lời khi bot được gọi trong nhóm. */
  runGroupReplyJob(job: JobRow): Promise<void> {
    return this.groupReplier.runJob(job.id, job.payload as GroupReplyPayload);
  }

  /** Người nhắn riêng chưa có ảnh / globalId: hỏi Zalo một lần mỗi phiên. */
  private async ensureContactAvatar(zaloUid: string): Promise<void> {
    if (this.avatarAsked.has(zaloUid) || !this.api) return;
    this.avatarAsked.add(zaloUid);
    try {
      const [rows] = await this.db.query<RowDataPacket[]>("SELECT avatar_url, global_id FROM contact WHERE zalo_uid = ?", [zaloUid]);
      if (rows[0]?.avatar_url && rows[0]?.global_id) return;
      await this.fetchUserProfiles([zaloUid]);
    } catch (error) {
      this.log.warn(`lấy hồ sơ ${zaloUid} lỗi`, error);
    }
  }

  /** Hỏi Zalo hồ sơ (ảnh, tên Zalo, globalId) của một loạt người. */
  private async fetchUserProfiles(uids: string[]): Promise<void> {
    if (!uids.length || !this.api) return;
    const info = await this.api.getUserInfo(uids);
    for (const uid of uids) {
      const profile = info.changed_profiles?.[uid] ?? info.changed_profiles?.[`${uid}_0`];
      if (profile) await setContactZaloProfile(this.db, uid, { avatar: profile.avatar, zaloName: profile.zaloName, globalId: profile.globalId });
    }
  }

  /**
   * Khởi động: hỏi bù hồ sơ (ảnh, globalId) cho người nhắn riêng và thành viên nhóm còn thiếu globalId.
   * globalId là mã chung để nối một người giữa nhóm và nhắn riêng — Zalo cấp hai mã khác nhau.
   */
  private async refreshContactProfiles(): Promise<void> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT c.zalo_uid FROM contact c
       WHERE c.global_id IS NULL OR (c.avatar_url = '' AND c.last_dm_at IS NOT NULL)
       ORDER BY c.last_dm_at IS NULL, c.id LIMIT 500`,
    );
    const uids = rows.map((row) => String(row.zalo_uid));
    for (const uid of uids) this.avatarAsked.add(uid);
    for (let start = 0; start < uids.length; start += 50) {
      await this.fetchUserProfiles(uids.slice(start, start + 50));
      await sleep(GROUP_SCAN_PAUSE_MS);
    }
    if (uids.length) this.log.info(`hỏi bù hồ sơ ${uids.length} người`);
  }

  private async answerQuestion(thread: GroupRow, contact: ContactRow, messageId: number | null, question: string, ack: AckState): Promise<void> {
    // Giữ bản trợ lý lúc bắt đầu: khóa bị xóa trên màn Cài đặt giữa chừng thì lượt này vẫn chạy nốt
    const assistant = this.assistant;
    if (!assistant) return;
    let answered = false;
    let ackTimer: NodeJS.Timeout | null = null;
    const reply = await assistant.answer({
      botAccountId: this.account.id,
      contact,
      threadId: thread.id,
      questionMessageId: messageId,
      question,
    }, {
      onAccepted: () => {
        if (ack.acked) return;
        ackTimer = setTimeout(() => {
          if (answered || ack.acked) return;
          ack.acked = true;
          void this.sendAck(thread, contact, () => answered).catch((error) => this.log.warn("nhắn xác nhận lỗi", error));
        }, ACK_DELAY_MS);
      },
    }).finally(() => {
      answered = true;
      if (ackTimer) clearTimeout(ackTimer);
    });
    // Không ghi nội dung câu hỏi / câu trả lời vào log — chỉ ai, kết quả, bao lâu; nội dung xem ở màn Hội thoại
    this.log.info(`trả lời «${contact.display_name || contact.zalo_uid}»: ${AssistantTurnStatus[reply.status]}` +
      `${reply.text ? `, ${reply.text.length} ký tự` : ", không gửi"}${reply.attachmentIds.length ? `, ${reply.attachmentIds.length} tệp` : ""}` +
      `${reply.reportFiles?.length ? `, ${reply.reportFiles.length} tệp báo cáo` : ""}`);
    const api = this.api!;
    const bot = { uid: this.ownUid, name: this.account.display_name || this.account.label };
    if (reply.text) {
      for (const chunk of splitForZalo(reply.text)) {
        const response = await this.sender.send(() => api.sendMessage(chunk, contact.zalo_uid, ThreadType.User));
        const msgId = response.message?.msgId;
        if (msgId) await recordOutgoingMessage(this.db, thread, bot, String(msgId), chunk);
      }
    }
    for (const attachmentId of reply.attachmentIds) {
      await this.sendStoredFile(contact.zalo_uid, attachmentId).catch(async (error) => {
        this.log.warn(`gửi tệp #${attachmentId} lỗi`, error);
        const notice = `Không gửi được tệp #${attachmentId}: ${describeError(error)}`.slice(0, 300);
        await this.sender.send(() => api.sendMessage(notice, contact.zalo_uid, ThreadType.User)).catch(() => undefined);
      });
    }
    for (const file of reply.reportFiles ?? []) {
      await this.sendReportFile(thread, file).catch(async (error) => {
        this.log.warn(`gửi báo cáo ${file.fileName} lỗi`, error);
        const notice = `Không gửi được tệp báo cáo ${file.fileName}: ${describeError(error)}`.slice(0, 300);
        await this.sender.send(() => api.sendMessage(notice, contact.zalo_uid, ThreadType.User)).catch(() => undefined);
      });
    }
  }

  /**
   * Tệp trợ lý vừa tạo (Excel báo cáo / PDF recap, đã cất kho): gửi vào cuộc đang hỏi (tin riêng hoặc nhóm) rồi ghi vào
   * cuộc — màn Tệp thấy, tải lại được.
   */
  async sendReportFile(thread: GroupRow, file: GeneratedReportFile): Promise<void> {
    const api = this.api;
    if (!api) throw new Error("bot chưa kết nối");
    const { peer, type } = this.threadTarget(thread);
    const stream = await this.storage.read(file.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const data = Buffer.concat(chunks);
    const filename = file.fileName as `${string}.${string}`;
    const response = await this.sender.send(() =>
      api.sendMessage({ msg: "", attachments: [{ data, filename, metadata: { totalSize: data.length } }] }, peer, type));
    const msgId = response.message?.msgId ?? response.attachment?.[0]?.msgId;
    if (!msgId) return;
    const bot = { uid: this.ownUid, name: this.account.display_name || this.account.label };
    await recordOutgoingMessage(this.db, thread, bot, String(msgId), file.fileName, {
      kind: MessageKind.File, file: { name: file.fileName, ext: reportFileExtension(file.fileName), storageKey: file.storageKey, bytes: file.bytes },
    });
  }

  /** Thread Zalo (riêng / nhóm) của một cuộc trong kho. */
  private threadTarget(thread: GroupRow): { peer: string; type: ThreadType } {
    return { peer: thread.zalo_group_id, type: thread.thread_type === ConversationType.Group ? ThreadType.Group : ThreadType.User };
  }

  /** Quản trị gõ chữ từ màn Hội thoại: gửi dưới tên tài khoản bot này, lưu lại ngay (nguồn «admin»). */
  async sendAdminText(thread: GroupRow, text: string): Promise<number | null> {
    const api = this.api;
    if (!api) throw new Error("bot chưa kết nối");
    const { peer, type } = this.threadTarget(thread);
    const bot = { uid: this.ownUid, name: this.account.display_name || this.account.label };
    let lastId: number | null = null;
    for (const chunk of splitForZalo(text)) {
      const response = await this.sender.send(() => api.sendMessage(chunk, peer, type));
      const msgId = response.message?.msgId;
      if (msgId) lastId = await recordOutgoingMessage(this.db, thread, bot, String(msgId), chunk, { source: OUTGOING_SOURCE.admin });
    }
    return lastId;
  }

  /**
   * Quản trị gửi tệp / ảnh từ màn Hội thoại: đẩy sang Zalo rồi cất vào kho (để màn Tệp và nút tải về
   * thấy được như tệp người khác gửi). Tên tệp giữ đúng tên gốc.
   */
  async sendAdminFile(thread: GroupRow, data: Buffer, fileName: string, contentType: string): Promise<number | null> {
    const api = this.api;
    if (!api) throw new Error("bot chưa kết nối");
    const { peer, type } = this.threadTarget(thread);
    const safeName = sanitizeFileName(fileName) || "tep";
    const ext = (/\.([a-z0-9]{1,10})$/i.exec(safeName)?.[1] ?? "").toLowerCase();
    const filename = (ext ? safeName : `${safeName}.bin`) as `${string}.${string}`;
    const response = await this.sender.send(() =>
      api.sendMessage({ msg: "", attachments: [{ data, filename, metadata: { totalSize: data.length } }] }, peer, type));
    // Tin chỉ có đính kèm: zca-js trả mã tin trong `attachment[]`, `message` là null
    const msgId = response.message?.msgId ?? response.attachment?.[0]?.msgId;
    if (!msgId) return null;
    const storageKey = await this.storage.put(`${thread.zalo_group_id}/${new Date().toISOString().slice(0, 7)}/admin-${Date.now()}-${filename}`, data, contentType);
    const kind = contentType.startsWith("image/") ? MessageKind.Image : contentType.startsWith("video/") ? MessageKind.Video : MessageKind.File;
    const bot = { uid: this.ownUid, name: this.account.display_name || this.account.label };
    return recordOutgoingMessage(this.db, thread, bot, String(msgId), filename, {
      source: OUTGOING_SOURCE.admin, kind, file: { name: filename, ext: ext || "bin", storageKey, bytes: data.length },
    });
  }

  /** «Em nhận được rồi» — đổi câu cho đỡ máy móc; vào hàng gửi rồi vẫn kiểm lại, trả lời xong trước thì thôi. */
  private async sendAck(thread: GroupRow, contact: ContactRow, isAnswered: () => boolean): Promise<void> {
    const api = this.api;
    if (!api) return;
    const text = pickAckText();
    const response = await this.sender.send(() => (isAnswered() ? Promise.resolve(null) : api.sendMessage(text, contact.zalo_uid, ThreadType.User)));
    const msgId = response?.message?.msgId;
    if (msgId) await recordOutgoingMessage(this.db, thread, { uid: this.ownUid, name: this.account.display_name || this.account.label }, String(msgId), text);
  }

  private async sendStoredFile(peerUid: string, attachmentId: number): Promise<void> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT storage_key, file_name, file_ext FROM attachment WHERE id = ? AND status = ?",
      [attachmentId, AttachmentStatus.Stored],
    );
    const file = rows[0];
    if (!file?.storage_key) throw new Error("tệp chưa có trong kho");
    const stream = await this.storage.read(file.storage_key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const data = Buffer.concat(chunks);
    // Khóa lưu có dạng <nhóm>/<tháng>/<id>-<tên tệp> — bỏ tiền tố id để người nhận thấy đúng tên gốc
    const storedName = String(file.storage_key).split("/").pop()!.replace(/^[0-9]+-/, "");
    const hasExtension = /[.][a-z0-9]{1,10}$/i.test(storedName);
    const filename = (hasExtension ? storedName : `${storedName}.${file.file_ext || "bin"}`) as `${string}.${string}`;
    await this.sender.send(() =>
      this.api!.sendMessage({ msg: "", attachments: [{ data, filename, metadata: { totalSize: data.length } }] },
        peerUid, ThreadType.User));
  }

  private async handleGroupEvent(event: GroupEvent): Promise<void> {
    await this.recordGroupEvent(event).catch((error) => this.log.warn(`ghi tin hệ thống ${event.type} lỗi`, error));
    if (!MEMBER_CHANGING_EVENTS.has(event.type)) return;
    const updated = "updateMembers" in event.data ? event.data.updateMembers ?? [] : [];
    const touchesBot = updated.some((member) => (typeof member === "string" ? member : member.id) === this.ownUid);

    if (touchesBot && (event.type === GroupEventType.LEAVE || event.type === GroupEventType.REMOVE_MEMBER)) {
      // Bot này bị mời ra / tự rời: giữ dữ liệu cũ; bot khác cùng nhóm (nếu có) vẫn đọc tiếp
      await markBotLeftGroup(this.db, this.account.id, event.threadId);
      this.log.info(`bot đã rời nhóm ${event.threadId}`);
      return;
    }
    const { group, created } = await ensureGroup(this.db, event.threadId, {
      readMessages: this.config.defaultGroupRead,
      captureFiles: this.config.defaultGroupCaptureFiles,
    });
    if (touchesBot || created) await markBotInGroup(this.db, this.account.id, group.id);
    if (created) {
      this.onNewGroup(group.id, group.zalo_group_id);
      return;
    }
    await syncGroupMembers(this.db, this.groupSource, group.id, group.zalo_group_id);
  }

  /**
   * Sự kiện nhóm → một dòng tin hệ thống trong khung chat («Duy đã thêm Hân vào nhóm»). Ghi TRƯỚC khi đồng bộ
   * thành viên để tên người vừa rời vẫn tra được trong kho. Nhóm chưa bật đọc thì ingest tự bỏ.
   */
  private async recordGroupEvent(event: GroupEvent): Promise<void> {
    const uids = namesToLookup(event);
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT gm.zalo_uid, COALESCE(NULLIF(gm.display_name, ''), NULLIF(gm.zalo_name, ''), c.display_name) AS name, g.name AS group_name
       FROM zalo_group g
       LEFT JOIN group_member gm ON gm.group_id = g.id AND gm.zalo_uid IN (?)
       LEFT JOIN contact c ON c.zalo_uid = gm.zalo_uid
       WHERE g.thread_type = ? AND g.zalo_group_id = ?`,
      [uids.length ? uids : [""], ConversationType.Group, event.threadId]);
    const names = new Map(rows.filter((row) => row.zalo_uid).map((row) => [String(row.zalo_uid), String(row.name ?? "")]));
    if (this.ownUid) names.set(this.ownUid, names.get(this.ownUid) || this.account.display_name);
    const summary = describeGroupEvent(event, (uid) => names.get(uid) || "Một thành viên", String(rows[0]?.group_name ?? ""));
    if (!summary) return;
    await ingestGroupMessage(
      {
        db: this.db,
        defaults: { readMessages: this.config.defaultGroupRead, captureFiles: this.config.defaultGroupCaptureFiles },
        onNewGroup: (group: GroupRow) => this.onNewGroup(group.id, group.zalo_group_id),
      },
      this.account.id,
      {
        zaloGroupId: event.threadId, msgId: summary.msgId, cliMsgId: "", msgType: "system",
        senderUid: summary.actorUid, senderName: names.get(summary.actorUid) ?? "", sentAtMs: summary.sentAtMs,
        content: { title: summary.text, href: "" }, quote: null, mentions: null,
      },
    );
  }

  private onNewGroup(groupId: number, zaloGroupId: string): void {
    syncGroupMembers(this.db, this.groupSource, groupId, zaloGroupId)
      .then((result) => {
        // TODO(P1 lệnh): báo quản lý qua kênh notify để bật/tắt đọc nhóm này
        this.log.info(`nhóm mới ${zaloGroupId}: ${result.members} thành viên — bật đọc bằng: npm run cli -- group ${zaloGroupId} read=on`);
      })
      .catch((error) => this.log.warn(`đồng bộ thành viên nhóm mới ${zaloGroupId} lỗi`, error));
  }

  /** Khởi động: ghi nhận mọi nhóm bot đang ở + đồng bộ thành viên, để quản lý bật đọc trước khi có tin. */
  private async scanAllGroups(): Promise<void> {
    const response = await this.api!.getAllGroups();
    const zaloGroupIds = Object.keys(response.gridVerMap ?? {});
    this.log.info(`bot đang ở ${zaloGroupIds.length} nhóm`);
    const groupIds: number[] = [];
    for (const zaloGroupId of zaloGroupIds) {
      const { group } = await ensureGroup(this.db, zaloGroupId, {
        readMessages: this.config.defaultGroupRead,
        captureFiles: this.config.defaultGroupCaptureFiles,
      });
      groupIds.push(group.id);
      await markBotInGroup(this.db, this.account.id, group.id);
      try {
        await syncGroupMembers(this.db, this.groupSource, group.id, zaloGroupId);
      } catch (error) {
        this.log.warn(`đồng bộ thành viên ${zaloGroupId} lỗi`, error);
      }
      await sleep(GROUP_SCAN_PAUSE_MS);
    }
    // Nhóm bot từng ở mà nay không còn trong danh sách: bot bị mời ra lúc dịch vụ đang tắt.
    const left = await markBotLeftMissingGroups(this.db, this.account.id, groupIds);
    if (left) this.log.info(`bot đã rời ${left} nhóm trong lúc dịch vụ tắt`);
    await this.refreshContactProfiles().catch((error) => this.log.warn("hỏi bù hồ sơ lỗi", error));
  }
}

