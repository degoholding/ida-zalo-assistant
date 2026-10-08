import type { RowDataPacket } from "mysql2";
import { BoardType, ThreadType, type API, type GroupMessage, type NoteDetail, type TMessage } from "zca-js";
import { splitForZalo, type AssistantService } from "../assistant/assistant-service.js";
import type { GroupActions } from "../assistant/group-action-tools.js";
import type { AppConfig } from "../config.js";
import { AssistantTurnStatus, MessageKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { Logger } from "../logger.js";
import { findContactByUid } from "../sync/contact-repository.js";
import type { GeneratedReportFile } from "../reports/report-exporter.js";
import { findGroupByZaloId, findThreadById, type GroupRow } from "../sync/group-repository.js";
import { recordOutgoingMessage, type IncomingGroupMessage } from "../sync/message-ingest.js";
import { parseZaloContent } from "./content-parser.js";
import { ACK_DELAY_MS, pickAckText } from "./assistant-ack.js";
import { buildMentions, type MentionableMember } from "./group-mentions.js";
import { canCallBotInGroup, detectGroupTrigger } from "./group-trigger.js";
import type { ZaloSender } from "./zalo-sender.js";
import { AckTracker, enqueueGroupReply, type AckState, type GroupReplyPayload } from "./reply-jobs.js";

// Trả lời TRONG NHÓM khi bot được gọi (@nhắc tên bot hoặc từ khóa ở màn Cài đặt). Luật an toàn:
// - ai gọi được: người có vai trò + NHÂN SỰ (cài đặt «Trong nhóm: nhân sự gọi được bot», mặc định bật); khách hàng /
//   người chưa phân loại thì bot im lặng (canCallBotInGroup);
// - chỉ nhóm đang bật «Đọc tin»; trợ lý chỉ đọc dữ liệu CỦA NHÓM ĐÓ (groupScope — chặn ở tầng công cụ);
// - câu trả lời trích dẫn tin được hỏi, gửi qua hàng gửi chung (giãn cách chống khóa tài khoản);
// - mỗi nhóm trả lời lần lượt, không chạy song song (serial_key của hàng đợi, 08/10/2026);
// - nhiều tài khoản bot cùng ở một nhóm: chỉ bot ĐƯỢC GHI NHẬN ở nhóm (bot_group) mới trả lời, và mỗi tin chỉ MỘT bot
//   trả lời (dedupe_key của hàng đợi — đúng cả khi chạy nhiều tiến trình). Tài khoản cá nhân dùng tạm làm bot
//   mà không được ghi nhận ở nhóm thì không bao giờ trả lời thay.

/**
 * Bỏ ghim ghi chú: `zca-js` editNote({ pinAct: false }) gửi pinAct = 2 — thử thật 06/10/2026 Zalo chỉ sửa ghi chú, VẪN
 * GHIM. Tự gọi cùng endpoint (board/topic/updatev2) với pinAct = 0 (giá trị createNote dùng cho «không ghim») qua
 * `api.custom`. Đăng ký một lần mỗi phiên API (defineProperty không cho đăng ký lại).
 */
const UNPIN_API_NAME = "unpinGroupNote";
const unpinRegistered = new WeakSet<object>();

type UnpinNoteCall = (props: { groupId: string; topicId: string; title: string }) => Promise<unknown>;

function ensureUnpinApi(api: API): UnpinNoteCall {
  if (!unpinRegistered.has(api)) {
    const serviceMap = (api as unknown as { zpwServiceMap: { group_board: string[] } }).zpwServiceMap;
    api.custom<unknown, { groupId: string; topicId: string; title: string }>(UNPIN_API_NAME, async ({ ctx, utils, props }) => {
      const params = {
        grid: props.groupId, type: 0, color: -16777216, emoji: "", startTime: -1, duration: -1,
        params: JSON.stringify({ title: props.title }), topicId: props.topicId, repeat: 0, imei: ctx.imei, pinAct: 0,
      };
      const encrypted = utils.encodeAES(JSON.stringify(params));
      if (!encrypted) throw new Error("Không mã hóa được tham số bỏ ghim");
      const response = await utils.request(utils.makeURL(`${serviceMap.group_board[0]}/api/board/topic/updatev2`), {
        method: "POST", body: new URLSearchParams({ params: encrypted }),
      });
      return utils.resolve(response, (result: { data: unknown }) => result.data);
    });
    unpinRegistered.add(api);
  }
  return (api as unknown as Record<string, UnpinNoteCall>)[UNPIN_API_NAME];
}

/** Câu trả lời khi được gọi trong nhóm Mật. */
export const CONFIDENTIAL_GROUP_TEXT = "Dạ nhóm này đang để chế độ Mật nên em không đưa nội dung nhóm cho AI xử lý được ạ. Anh/chị nhắn riêng cho em nếu cần việc khác nhé.";

export interface GroupReplierDeps {
  db: Db;
  config: AppConfig;
  sender: ZaloSender;
  log: Logger;
  accountId: number;
  getApi: () => API | null;
  getAssistant: () => AssistantService | null;
  /** Báo bộ chạy việc có việc mới. */
  jobs: { wake(): void };
  getBot: () => { uid: string; name: string };
  /** Gửi tệp trợ lý vừa tạo (PDF recap, Excel) vào cuộc. */
  sendReportFile: (thread: GroupRow, file: GeneratedReportFile) => Promise<void>;
}

export class GroupAssistantReplier {
  private readonly acks = new AckTracker();

  constructor(private readonly deps: GroupReplierDeps) {}

  /** Gọi sau khi tin nhóm đã lưu — bởi bot này hoặc bot khác cùng nhóm. Không gọi bot thì thôi, không tốn gì. */
  handle(message: GroupMessage, incoming: IncomingGroupMessage): void {
    const { config, log } = this.deps;
    if (!config.assistant.groupReplyEnabled || !this.deps.getAssistant()) return;
    const parsed = parseZaloContent(incoming.msgType, incoming.content);
    // Tin chữ, và tin LINK (dán link kèm câu «… bot https://…» — Zalo xếp vào loại link; gặp thật 07/10/2026: bot bỏ qua)
    if (parsed.kind !== MessageKind.Text && parsed.kind !== MessageKind.Link) return;
    // Tin link: chỉ xét chữ người gửi tự gõ (dòng đầu) — mô tả xem trước của trang (vd «… IDA-Bot») không tính là gọi bot
    const typedText = parsed.kind === MessageKind.Link ? parsed.text.split("\n")[0] : parsed.text;
    const trigger = detectGroupTrigger({
      text: typedText, mentions: incoming.mentions, botUid: this.deps.getBot().uid, keywords: config.assistant.groupTriggerKeywords,
      quotedUid: incoming.quote?.ownerUid,
    });
    if (!trigger) return;
    this.enqueue(message, incoming, trigger.question).catch((error) => log.error(`ghi việc trả lời nhóm ${incoming.zaloGroupId} lỗi`, error));
  }

  /**
   * Kiểm nhanh (nhóm đang đọc, bot này được ghi nhận ở nhóm, người gọi được phép) rồi ghi việc vào hàng đợi.
   * Trả lời thật do bộ chạy việc làm (runJob).
   */
  private async enqueue(message: GroupMessage, incoming: IncomingGroupMessage, question: string): Promise<void> {
    const { db, log, sender } = this.deps;
    const group = await findGroupByZaloId(db, incoming.zaloGroupId);
    if (!group?.read_messages) return;
    const [linked] = await db.query<RowDataPacket[]>(
      "SELECT 1 FROM bot_group WHERE group_id = ? AND bot_account_id = ? AND left_at IS NULL", [group.id, this.deps.accountId]);
    if (!linked.length) return;
    const contact = await findContactByUid(db, incoming.senderUid);
    if (!contact) return;
    const groupName = group.label || group.name;
    if (!canCallBotInGroup(contact, this.deps.config.assistant.groupReplyAnyone, group.group_kind)) {
      log.info(`«${incoming.senderName}» gọi bot trong nhóm khách hàng «${groupName}» nhưng không phải nhân sự / chưa có vai trò — không trả lời`);
      return;
    }
    // Nhóm Mật (IDA câu 4): không gửi nội dung nhóm sang AI — trả một câu cố định, không qua mô hình
    if (group.is_confidential) {
      const api = this.deps.getApi();
      if (!api) return;
      const response = await sender.send(() => api.sendMessage({ msg: CONFIDENTIAL_GROUP_TEXT, quote: message.data }, incoming.zaloGroupId, ThreadType.Group));
      const sentId = response?.message?.msgId;
      if (sentId) await recordOutgoingMessage(db, group, this.deps.getBot(), String(sentId), CONFIDENTIAL_GROUP_TEXT);
      log.info(`được gọi trong nhóm Mật «${groupName}» — trả câu cố định, không gửi AI`);
      return;
    }
    const jobId = await enqueueGroupReply(db, { accountId: this.deps.accountId, groupId: group.id, incoming, quote: message.data, question });
    // null = bot khác cùng nhóm đã nhận tin này
    if (!jobId) return;
    this.acks.watchQueued(jobId, async () => {
      const api = this.deps.getApi();
      if (!api) return;
      const ackText = pickAckText();
      const response = await sender.send(() => api.sendMessage({ msg: ackText, quote: message.data }, incoming.zaloGroupId, ThreadType.Group));
      const ackId = response?.message?.msgId;
      if (ackId) await recordOutgoingMessage(db, group, this.deps.getBot(), String(ackId), ackText);
    });
    this.deps.jobs.wake();
  }

  /** Bộ chạy việc gọi: trả lời một lần được gọi trong nhóm đã ghi trong hàng đợi. Ném lỗi = việc lỗi. */
  async runJob(jobId: number, payload: GroupReplyPayload): Promise<void> {
    const ack = this.acks.begin(jobId);
    try {
      await this.answer(payload, ack);
    } finally {
      this.acks.end(jobId);
    }
  }

  /** Việc làm trên Zalo, gắn cứng vào nhóm đang hỏi — mô hình không chọn được nhóm khác. */
  private buildActions(api: API, zaloGroupId: string, groupName: string): GroupActions {
    const { log } = this.deps;
    const listNotes = async () => {
      const board = await api.getListBoard({ count: 50 }, zaloGroupId);
      return board.items
        .filter((item) => item.boardType === BoardType.Note)
        .map((item) => {
          const note = item.data as NoteDetail;
          return { id: String(note.id), title: note.params?.title ?? "", createdAt: Number(note.createTime) };
        });
    };
    return {
      createReminder: async ({ title, startTime, repeat }) => {
        const created = await api.createReminder({ title, startTime, repeat }, zaloGroupId, ThreadType.Group);
        log.info(`tạo nhắc hẹn trong nhóm «${groupName}»`);
        return { id: String("id" in created ? created.id : created.reminderId) };
      },
      createPinnedNote: async ({ title }) => {
        const note = await api.createNote({ title, pinAct: true }, zaloGroupId);
        log.info(`ghim ghi chú trong nhóm «${groupName}»`);
        return { id: String(note.id) };
      },
      createPoll: async ({ question, options, allowMultiChoices }) => {
        const poll = await api.createPoll({ question, options, allowMultiChoices }, zaloGroupId);
        log.info(`tạo bình chọn trong nhóm «${groupName}»`);
        return { id: String(poll.poll_id) };
      },
      listNotes: async () => listNotes(),
      unpinNote: async (id) => {
        const note = (await listNotes()).find((item) => item.id === id);
        if (!note) throw new Error("không có ghi chú này");
        // Giữ nguyên nội dung, chỉ tắt ghim (pinAct = 0 — xem ensureUnpinApi)
        await ensureUnpinApi(api)({ groupId: zaloGroupId, topicId: id, title: note.title });
        log.info(`bỏ ghim ghi chú trong nhóm «${groupName}»`);
      },
      listReminders: async () => {
        const reminders = await api.getListReminder({ count: 50 }, zaloGroupId, ThreadType.Group);
        return reminders.map((item) => ({
          id: String(item.id ?? item.reminderId), title: item.params?.title ?? "", startTime: Number(item.startTime), repeat: Number(item.repeat),
        }));
      },
      cancelReminder: async (id) => {
        await api.removeReminder(id, zaloGroupId, ThreadType.Group);
        log.info(`hủy nhắc hẹn trong nhóm «${groupName}»`);
      },
    };
  }

  private async answer(payload: GroupReplyPayload, ack: AckState): Promise<void> {
    const { db, log, sender } = this.deps;
    const { incoming, question } = payload;
    // Dữ liệu gốc của tin được hỏi (zca-js) — gửi kèm để Zalo vẽ khung trích dẫn
    const quote = payload.quote as TMessage;
    const assistant = this.deps.getAssistant();
    const api = this.deps.getApi();
    if (!assistant) return;
    if (!api) throw new Error("bot chưa kết nối");
    const group = await findThreadById(db, payload.groupId);
    if (!group?.read_messages || group.is_confidential) return;
    const contact = await findContactByUid(db, incoming.senderUid);
    if (!contact) return;
    const groupName = group.label || group.name;
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE group_id = ? AND zalo_msg_id = ?", [group.id, incoming.msgId]);
    const bot = this.deps.getBot();
    // Chưa trả lời xong sau ACK_DELAY_MS thì nhắn «chờ em xíu» (trích dẫn câu hỏi) — người hỏi biết bot đã nhận việc
    let answered = false;
    let ackTimer: NodeJS.Timeout | null = null;
    const sendAck = async () => {
      const ackText = pickAckText();
      const response = await sender.send(() => (answered ? Promise.resolve(null)
        : api.sendMessage({ msg: ackText, quote }, incoming.zaloGroupId, ThreadType.Group)));
      const ackId = response?.message?.msgId;
      if (ackId) await recordOutgoingMessage(db, group, bot, String(ackId), ackText);
    };
    const reply = await assistant.answer({
      botAccountId: this.deps.accountId, contact, threadId: group.id, questionMessageId: rows[0]?.id ?? null, question,
      groupScope: { groupId: group.id, groupName, actions: this.buildActions(api, incoming.zaloGroupId, groupName) },
    }, {
      onAccepted: () => {
        if (ack.acked) return;
        ackTimer = setTimeout(() => {
          if (answered || ack.acked) return;
          ack.acked = true;
          void sendAck().catch((error) => log.warn("nhắn «chờ em xíu» trong nhóm lỗi", error));
        }, ACK_DELAY_MS);
      },
    }).finally(() => {
      answered = true;
      if (ackTimer) clearTimeout(ackTimer);
    });
    // Không ghi nội dung câu hỏi / trả lời vào log — xem ở màn Hội thoại
    log.info(`trả lời trong nhóm «${groupName}» cho «${contact.display_name || contact.zalo_uid}»: ${AssistantTurnStatus[reply.status]}`);
    if (reply.text) {
      const members = reply.text.includes("@") ? await this.loadMembers(group.id, bot.uid) : [];
      for (const [index, chunk] of splitForZalo(reply.text).entries()) {
        // Tin đầu trích dẫn câu được hỏi để cả nhóm biết bot đang trả lời ai; «@Tên» thành viên → thẻ nhắc thật
        const mentions = buildMentions(chunk, members);
        const content = { msg: chunk, ...(index === 0 ? { quote } : {}), ...(mentions.length ? { mentions } : {}) };
        const response = await sender.send(() => api.sendMessage(content, incoming.zaloGroupId, ThreadType.Group));
        const msgId = response.message?.msgId;
        if (msgId) await recordOutgoingMessage(db, group, bot, String(msgId), chunk);
      }
    }
    for (const file of reply.reportFiles ?? []) {
      await this.deps.sendReportFile(group, file).catch(async (error) => {
        log.warn(`gửi tệp ${file.fileName} vào nhóm «${groupName}» lỗi`, error);
        const notice = `Em chưa gửi được tệp ${file.fileName} vào nhóm, anh/chị nhắn lại giúp em nhé.`;
        await sender.send(() => api.sendMessage(notice, incoming.zaloGroupId, ThreadType.Group)).catch(() => undefined);
      });
    }
  }

  /** Thành viên đang ở nhóm (trừ chính bot) — để gắn thẻ «@Tên» trong câu trả lời. */
  private async loadMembers(groupId: number, botUid: string): Promise<MentionableMember[]> {
    const [rows] = await this.deps.db.query<RowDataPacket[]>(
      "SELECT zalo_uid, display_name, zalo_name FROM group_member WHERE group_id = ? AND left_at IS NULL AND zalo_uid <> ?", [groupId, botUid]);
    // Gắn được cả theo tên hiển thị trong nhóm lẫn tên Zalo gốc
    return rows.flatMap((row) => [...new Set([String(row.display_name ?? ""), String(row.zalo_name ?? "")])]
      .filter(Boolean).map((name) => ({ uid: String(row.zalo_uid), name })));
  }
}
