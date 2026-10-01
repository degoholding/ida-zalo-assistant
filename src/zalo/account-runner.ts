import {
  GroupEventType,
  ThreadType,
  Zalo,
  type API,
  type Credentials,
  type GroupEvent,
  type GroupMessage,
  type Undo,
  type UserMessage,
} from "zca-js";
import type { AssistantService } from "../assistant/assistant-service.js";
import { splitForZalo } from "../assistant/assistant-service.js";
import type { AppConfig } from "../config.js";
import { AssistantTurnStatus, AttachmentStatus, BotAccountStatus, CLOSE_CODE_DUPLICATE, CLOSE_CODE_KICKED, ContactRole, MessageKind, SessionEvent } from "../constants.js";
import { decryptJson } from "../crypto/session-cipher.js";
import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import type { AttachmentDownloader } from "../sync/attachment-downloader.js";
import type { FileStorage } from "../storage/file-storage.js";
import type { ContactRow } from "../sync/contact-repository.js";
import {
  directKey,
  ensureGroup,
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
  recordOutgoingMessage,
  type IncomingGroupMessage,
} from "../sync/message-ingest.js";
import { parseZaloContent } from "./content-parser.js";
import { ZaloSender } from "./zalo-sender.js";
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
    quote: data.quote ? { globalMsgId: data.quote.globalMsgId, msg: data.quote.msg ?? "" } : null,
    mentions: "mentions" in data
      ? data.mentions?.map((mention) => ({ uid: mention.uid, pos: mention.pos, len: mention.len })) ?? null
      : null,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AccountRunner {
  private api: API | null = null;
  private ownUid = "";
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly log;

  private readonly sender: ZaloSender;
  // Đang chờ một trang tin cũ của nhóm (lấy tin cũ kiểu từng trang qua kết nối trực tiếp)
  private oldGroupPageWaiter: ((messages: GroupMessage[]) => void) | null = null;
  // Mỗi cuộc riêng trả lời lần lượt — hai câu hỏi liền tay không chạy song song, câu sau đọc được câu trước
  private readonly replyChains = new Map<number, Promise<void>>();

  constructor(
    private readonly account: BotAccountRow,
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly downloader: AttachmentDownloader,
    private readonly storage: FileStorage,
    private readonly assistant: AssistantService | null,
  ) {
    this.log = createLogger(`zalo:${account.label}`);
    this.sender = new ZaloSender(config.assistant.sendIntervalMs);
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
    this.attachListener(this.api);
    this.heartbeat = setInterval(() => {
      touchHeartbeat(this.db, this.account.id).catch((error) => this.log.warn("ghi nhịp tim lỗi", error));
    }, this.config.heartbeatSeconds * 1000);
    // Quét danh sách nhóm chạy nền, không chặn việc nghe tin
    this.scanAllGroups().catch((error) => this.log.warn("quét danh sách nhóm lỗi", error));
    return true;
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
      ingestGroupMessage(
        {
          db: this.db,
          defaults: { readMessages: this.config.defaultGroupRead, captureFiles: this.config.defaultGroupCaptureFiles },
          onNewGroup: (group) => this.onNewGroup(group.id, group.zalo_group_id),
          onAttachmentQueued: (attachmentId) => this.downloader.enqueue(attachmentId),
        },
        accountId,
        toIncomingGroupMessage(message),
      ).catch((error) => this.log.error(`lưu tin nhóm ${message.threadId} lỗi`, error));
    });

    listener.on("old_messages", (messages, threadType) => {
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

    listener.on("group_event", (event: GroupEvent) => {
      this.handleGroupEvent(event).catch((error) => this.log.warn(`xử lý sự kiện nhóm ${event.type} lỗi`, error));
    });

    listener.start({ retryOnClose: true });
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
   * ⚠️ Đường lịch sử nhóm của Zalo (getGroupChatHistory) trả 404 từ ~06/2026 — Zalo đổi/đóng, thư viện
   * chưa sửa (zca-js issue #374). Hỏng thì lách như openzca: xin TỪNG TRANG tin cũ qua kết nối trực tiếp
   * (requestOldMessages). Trang này là tin cũ của MỌI nhóm — lưu hết (nhóm nào không bật đọc thì tự
   * bỏ), rồi đếm riêng phần của nhóm đang lấy.
   */
  async backfillGroup(zaloGroupId: string, count: number): Promise<{ fetched: number; stored: number; oldest: Date | null; method: string }> {
    if (!this.api) throw new Error("bot chưa kết nối");
    try {
      const history = await this.api.getGroupChatHistory(zaloGroupId, count);
      const messages = history.groupMsgs ?? [];
      const stored = await this.ingestOldMessages(messages, true);
      this.log.info(`lấy tin cũ nhóm ${zaloGroupId} (lịch sử nhóm): ${messages.length} tin, lưu mới ${stored}`);
      return { fetched: messages.length, stored, oldest: oldestOf(messages), method: "lịch sử nhóm" };
    } catch (error) {
      this.log.warn(`đường lịch sử nhóm hỏng (${describeError(error)}) — chuyển sang xin từng trang`);
    }
    return this.backfillByPages(zaloGroupId);
  }

  private async backfillByPages(zaloGroupId: string): Promise<{ fetched: number; stored: number; oldest: Date | null; method: string }> {
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
    return { fetched, stored, oldest, method: `từng trang (${pages} trang)` };
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
    // Người lạ (chưa có vai trò): chỉ lưu, không trả lời — đại ca chốt 01/10/2026
    if (!this.assistant || result.contact.role === ContactRole.None) {
      this.log.info(`tin riêng từ ${who}: đã lưu, không trả lời (${this.assistant ? "chưa có vai trò" : "trợ lý tắt"})`);
      return;
    }
    this.log.info(`tin riêng từ ${who}: đang trả lời`);
    const parsed = parseZaloContent(incoming.msgType, incoming.content);
    if (parsed.kind !== MessageKind.Text || !parsed.text.trim()) return;

    const threadId = result.thread.id;
    const previous = this.replyChains.get(threadId) ?? Promise.resolve();
    const next = previous
      .then(() => this.answerQuestion(result.thread, result.contact, result.messageId, parsed.text))
      .catch((error) => this.log.error(`trả lời ${incoming.senderUid} lỗi`, error));
    this.replyChains.set(threadId, next);
    void next.finally(() => {
      if (this.replyChains.get(threadId) === next) this.replyChains.delete(threadId);
    });
  }

  private async answerQuestion(thread: GroupRow, contact: ContactRow, messageId: number | null, question: string): Promise<void> {
    const reply = await this.assistant!.answer({
      botAccountId: this.account.id,
      contact,
      threadId: thread.id,
      questionMessageId: messageId,
      question,
    });
    // Không ghi nội dung câu hỏi / câu trả lời vào log — chỉ ai, kết quả, bao lâu; nội dung xem ở màn Hội thoại
    this.log.info(`trả lời «${contact.display_name || contact.zalo_uid}»: ${AssistantTurnStatus[reply.status]}` +
      `${reply.text ? `, ${reply.text.length} ký tự` : ", không gửi"}${reply.attachmentIds.length ? `, ${reply.attachmentIds.length} tệp` : ""}`);
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
  }
}

