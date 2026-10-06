import type { RowDataPacket } from "mysql2";
import { BoardType, ThreadType, type API, type GroupMessage, type NoteDetail } from "zca-js";
import { splitForZalo, type AssistantService } from "../assistant/assistant-service.js";
import type { GroupActions } from "../assistant/group-action-tools.js";
import type { AppConfig } from "../config.js";
import { AssistantTurnStatus, MessageKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { Logger } from "../logger.js";
import { findContactByUid } from "../sync/contact-repository.js";
import type { GeneratedReportFile } from "../reports/report-exporter.js";
import { findGroupByZaloId, type GroupRow } from "../sync/group-repository.js";
import { recordOutgoingMessage, type IncomingGroupMessage } from "../sync/message-ingest.js";
import { parseZaloContent } from "./content-parser.js";
import { ACK_DELAY_MS, pickAckText } from "./assistant-ack.js";
import { buildMentions, type MentionableMember } from "./group-mentions.js";
import { canCallBotInGroup, detectGroupTrigger } from "./group-trigger.js";
import type { ZaloSender } from "./zalo-sender.js";

// Trả lời TRONG NHÓM khi bot được gọi (@nhắc tên bot hoặc từ khóa ở màn Cài đặt). Luật an toàn:
// - ai gọi được: người có vai trò + NHÂN SỰ (cài đặt «Trong nhóm: nhân sự gọi được bot», mặc định bật); khách hàng /
//   người chưa phân loại thì bot im lặng (canCallBotInGroup);
// - chỉ nhóm đang bật «Đọc tin»; trợ lý chỉ đọc dữ liệu CỦA NHÓM ĐÓ (groupScope — chặn ở tầng công cụ);
// - câu trả lời trích dẫn tin được hỏi, gửi qua hàng gửi chung (giãn cách chống khóa tài khoản);
// - mỗi nhóm trả lời lần lượt, không chạy song song;
// - nhiều tài khoản bot cùng ở một nhóm: chỉ bot ĐƯỢC GHI NHẬN ở nhóm (bot_group) mới trả lời, và mỗi tin chỉ MỘT bot
//   trả lời (giữ chỗ trong tiến trình — mọi tài khoản chạy chung một tiến trình). Tài khoản cá nhân dùng tạm làm bot
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

/** Tin đã có bot nhận trả lời — chung cho mọi AccountRunner trong tiến trình. */
const claimedMessages = new Set<string>();
const MAX_CLAIMED = 2000;

function claimMessage(key: string): boolean {
  if (claimedMessages.has(key)) return false;
  claimedMessages.add(key);
  // Set giữ thứ tự chèn — bỏ bớt mục cũ nhất cho khỏi phình
  if (claimedMessages.size > MAX_CLAIMED) claimedMessages.delete(claimedMessages.values().next().value as string);
  return true;
}

export interface GroupReplierDeps {
  db: Db;
  config: AppConfig;
  sender: ZaloSender;
  log: Logger;
  accountId: number;
  getApi: () => API | null;
  getAssistant: () => AssistantService | null;
  getBot: () => { uid: string; name: string };
  /** Gửi tệp trợ lý vừa tạo (PDF recap, Excel) vào cuộc. */
  sendReportFile: (thread: GroupRow, file: GeneratedReportFile) => Promise<void>;
}

export class GroupAssistantReplier {
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly deps: GroupReplierDeps) {}

  /** Gọi sau khi tin nhóm đã lưu — bởi bot này hoặc bot khác cùng nhóm. Không gọi bot thì thôi, không tốn gì. */
  handle(message: GroupMessage, incoming: IncomingGroupMessage): void {
    const { config, log } = this.deps;
    if (!config.assistant.groupReplyEnabled || !this.deps.getAssistant()) return;
    const parsed = parseZaloContent(incoming.msgType, incoming.content);
    if (parsed.kind !== MessageKind.Text) return;
    const trigger = detectGroupTrigger({
      text: parsed.text, mentions: incoming.mentions, botUid: this.deps.getBot().uid, keywords: config.assistant.groupTriggerKeywords,
      quotedUid: incoming.quote?.ownerUid,
    });
    if (!trigger) return;
    const groupKey = incoming.zaloGroupId;
    const next = (this.chains.get(groupKey) ?? Promise.resolve())
      .then(() => this.answer(message, incoming, trigger.question))
      .catch((error) => log.error(`trả lời trong nhóm ${groupKey} lỗi`, error));
    this.chains.set(groupKey, next);
    void next.finally(() => {
      if (this.chains.get(groupKey) === next) this.chains.delete(groupKey);
    });
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

  private async answer(message: GroupMessage, incoming: IncomingGroupMessage, question: string): Promise<void> {
    const { db, log, sender } = this.deps;
    const assistant = this.deps.getAssistant();
    const api = this.deps.getApi();
    if (!assistant || !api) return;
    const group = await findGroupByZaloId(db, incoming.zaloGroupId);
    if (!group?.read_messages) return;
    const [linked] = await db.query<RowDataPacket[]>(
      "SELECT 1 FROM bot_group WHERE group_id = ? AND bot_account_id = ? AND left_at IS NULL", [group.id, this.deps.accountId]);
    if (!linked.length) return;
    if (!claimMessage(`${incoming.zaloGroupId}:${incoming.msgId}`)) return;
    const contact = await findContactByUid(db, incoming.senderUid);
    const groupName = group.label || group.name;
    if (!contact) return;
    if (!canCallBotInGroup(contact, this.deps.config.assistant.groupReplyAnyone)) {
      log.info(`«${incoming.senderName}» gọi bot trong nhóm «${groupName}» nhưng không phải nhân sự / chưa có vai trò — không trả lời`);
      return;
    }
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE group_id = ? AND zalo_msg_id = ?", [group.id, incoming.msgId]);
    const bot = this.deps.getBot();
    // Chưa trả lời xong sau ACK_DELAY_MS thì nhắn «chờ em xíu» (trích dẫn câu hỏi) — người hỏi biết bot đã nhận việc
    let answered = false;
    let ackTimer: NodeJS.Timeout | null = null;
    const sendAck = async () => {
      const ackText = pickAckText();
      const response = await sender.send(() => (answered ? Promise.resolve(null)
        : api.sendMessage({ msg: ackText, quote: message.data }, incoming.zaloGroupId, ThreadType.Group)));
      const ackId = response?.message?.msgId;
      if (ackId) await recordOutgoingMessage(db, group, bot, String(ackId), ackText);
    };
    const reply = await assistant.answer({
      botAccountId: this.deps.accountId, contact, threadId: group.id, questionMessageId: rows[0]?.id ?? null, question,
      groupScope: { groupId: group.id, groupName, actions: this.buildActions(api, incoming.zaloGroupId, groupName) },
    }, {
      onAccepted: () => {
        ackTimer = setTimeout(() => { if (!answered) void sendAck().catch((error) => log.warn("nhắn «chờ em xíu» trong nhóm lỗi", error)); }, ACK_DELAY_MS);
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
        const content = { msg: chunk, ...(index === 0 ? { quote: message.data } : {}), ...(mentions.length ? { mentions } : {}) };
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
