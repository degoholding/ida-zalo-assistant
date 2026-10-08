import type { RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import { AlertKind, ContactKind, ConversationType, GroupKind, MessageKind, MessagePriority } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { JobRow } from "../jobs/job-queue.js";
import { liveEvents, type MessageEvent } from "../live-events.js";
import { createLogger, describeError } from "../logger.js";
import type { WorkCalendar } from "../schedule/work-calendar.js";
import {
  closeAnsweredFlags,
  composeUrgentAlert,
  loadAlertSetup,
  pendingUrgentItems,
  recordAlertBatch,
  saveDecision,
  scheduleUrgentDispatch,
  watchesGroup,
  type AlertSetup,
} from "./alert-store.js";
import { classifyMessage } from "./classifier.js";

// Cảnh báo tin nhắn ở tiến trình app (phase 5, N1): nghe sự kiện «tin mới đã lưu» (live-events) → đóng các tin đang chờ
// mà tin này vừa trả lời → phân loại tin này (từ khóa, VIP, nhắc tên người nhận, câu hỏi của khách) → ghi cờ → tin KHẨN /
// VIP thì hẹn một lượt gom-và-báo cho từng người nhận theo dõi nhóm đó. Lượt báo (AlertDispatch) cũng chạy ở app vì app
// giữ phiên Zalo. Không gọi AI ở đây — AI xét theo lô ở worker (src/alerts/ai-review.ts).

const log = createLogger("alerts");
/** Tin cũ (nhập lịch sử, bù lúc nối lại) không báo — chỉ tin mới thật sự. */
const FRESH_MS = 15 * 60_000;
const SETUP_CACHE_MS = 60_000;

export interface AlertDispatchPayload {
  recipientId: number;
}

export class AlertService {
  private setup: AlertSetup | null = null;
  private setupLoadedAt = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly getCalendar: () => WorkCalendar | null,
    /** Bộ chạy việc của app — gọi khi vừa hẹn một lượt báo để chạy ngay */
    private readonly wakeJobs: () => void,
    /** Gửi tin riêng cho người nhận (SyncService.sendRecipientMessage) */
    private readonly sendToRecipient: (recipientId: number, text: string) => Promise<void>,
  ) {}

  start(): void {
    this.unsubscribe = liveEvents.onMessage((event) => {
      if (event.kind !== "new") return;
      this.onNewMessage(event).catch((error) => log.warn(`xử lý cảnh báo tin #${event.messageId} lỗi: ${describeError(error)}`));
    });
  }

  stop(): void {
    this.unsubscribe?.();
  }

  /** Người nhận / VIP / từ khóa đổi (màn Người nhận, Cài đặt, lệnh qua Zalo) thì nạp lại ngay ở lượt sau. */
  invalidate(): void {
    this.setup = null;
  }

  private async getSetup(): Promise<AlertSetup> {
    if (!this.setup || Date.now() - this.setupLoadedAt > SETUP_CACHE_MS) {
      this.setup = await loadAlertSetup(this.db, this.config);
      this.setupLoadedAt = Date.now();
    }
    return this.setup;
  }

  async onNewMessage(event: Pick<MessageEvent, "threadId" | "messageId">, now = new Date()): Promise<void> {
    if (!this.config.alerts.enabled) return;
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT m.id, m.group_id, m.sender_uid, m.kind, m.text, m.sent_at, m.quote_msg_id, m.mentions, m.recalled_at,
              g.thread_type, g.group_kind, g.read_messages, COALESCE(c.kind, 0) AS sender_kind,
              (SELECT q.sender_uid FROM message q WHERE q.group_id = m.group_id AND q.zalo_msg_id = m.quote_msg_id LIMIT 1) AS quote_owner
       FROM message m JOIN zalo_group g ON g.id = m.group_id LEFT JOIN contact c ON c.zalo_uid = m.sender_uid
       WHERE m.id = ?`, [event.messageId]);
    const row = rows[0];
    if (!row || Number(row.thread_type) !== ConversationType.Group || !row.read_messages || row.recalled_at) return;
    const sentAt = new Date(row.sent_at);
    if (now.getTime() - sentAt.getTime() > FRESH_MS) return;
    const mentionUids = parseMentionUids(row.mentions);
    const message = { id: Number(row.id), groupId: Number(row.group_id), senderUid: String(row.sender_uid), sentAt };

    // (1) Tin này có trả lời tin nào đang chờ không — chạy cho MỌI tin (kể cả ảnh / tệp trả lời trích dẫn)
    await closeAnsweredFlags(this.db, { ...message, quoteZaloMsgId: row.quote_msg_id ? String(row.quote_msg_id) : null, mentionUids });

    // (2) Phân loại chính tin này
    const kind = Number(row.kind);
    if (kind !== MessageKind.Text && kind !== MessageKind.Link) return;
    const setup = await this.getSetup();
    const decision = classifyMessage({
      text: String(row.text ?? ""), senderUid: message.senderUid, senderKind: Number(row.sender_kind) as ContactKind,
      groupKind: Number(row.group_kind) as GroupKind, mentionUids, quoteOwnerUid: row.quote_owner ? String(row.quote_owner) : null,
    }, setup.context);
    if (!decision) return;
    let calendar: WorkCalendar | null = null;
    try {
      calendar = this.getCalendar();
    } catch {
      // Lịch làm việc cài sai — đồng hồ chờ tính theo giờ thường
    }
    await saveDecision(this.db, message, decision, calendar, this.config);

    // (3) KHẨN (đã chắc, không chờ AI) hoặc tin của VIP → hẹn báo cho người nhận theo dõi nhóm này
    let scheduled = false;
    for (const recipient of setup.recipients) {
      if (!recipient.notifyUrgent || !watchesGroup(recipient, message.groupId)) continue;
      const urgent = decision.priority === MessagePriority.Urgent && !decision.pendingAi;
      if (!urgent && !recipient.vipUids.has(message.senderUid)) continue;
      if (await scheduleUrgentDispatch(this.db, recipient.id, this.config.alerts.urgentMergeSeconds, now)) scheduled = true;
    }
    if (scheduled) this.wakeJobs();
  }

  /** Bộ chạy việc gọi: gom mọi tin khẩn / VIP chưa báo của người nhận thành MỘT tin rồi gửi. */
  async runDispatchJob(job: JobRow): Promise<void> {
    const { recipientId } = job.payload as AlertDispatchPayload;
    const setup = await this.getSetup();
    const recipient = setup.recipients.find((item) => item.id === recipientId);
    if (!recipient) return;
    const items = await pendingUrgentItems(this.db, recipient);
    if (!items.length) return;
    await this.sendToRecipient(recipient.id, composeUrgentAlert(items));
    await recordAlertBatch(this.db, recipient.id, AlertKind.Urgent, items.map((item) => item.messageId));
    log.info(`báo khẩn cho người nhận «${recipient.name}»: ${items.length} tin`);
  }
}

/** Cột mentions (JSON [{uid,pos,len}]) → danh sách uid. */
export function parseMentionUids(raw: unknown): string[] {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.map((item) => String((item as { uid?: unknown })?.uid ?? "")).filter(Boolean);
}
