import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { AttachmentStatus, ConversationType, MessageKind } from "../../constants.js";
import { parseZaloContent } from "../../zalo/content-parser.js";
import type { Db } from "../../db/pool.js";
import { findGroupByZaloId } from "../../sync/group-repository.js";
import { ingestGroupMessage, type IncomingGroupMessage } from "../../sync/message-ingest.js";
import { ApiError, readRawBody, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";

// Nhập lịch sử từ Zalo Web: Zalo chỉ đồng bộ ~2 tuần tin từ điện thoại xuống kho cục bộ (IndexedDB) của
// Zalo Web khi đăng nhập thiết bị mới; không có API lấy từ máy chủ (đo 02/10/2026, xem doc/01 mục 7).
// Bookmarklet (web/src/modules/imports) đọc kho đó thành tệp JSON; đây là nơi nhận tệp và ghi vào kho bot.

/**
 * Một tin trong tệp xuất (bookmarklet `web/src/modules/imports/utils/zalo-web-exporter.ts`): chữ thật lấy
 * từ màn hình Zalo Web (kho IndexedDB mã hóa nội dung), siêu dữ liệu lấy từ kho theo msgId.
 */
interface ExportedMessage {
  msgId: string;
  cliMsgId?: string;
  /** Loại tin gốc của Zalo (webchat, chat.photo, share.file…) — cùng mã với zca-js. */
  originMsgType?: string;
  fromUid: string;
  /** "g<mã nhóm>" với nhóm; mã người với cuộc riêng. */
  toUid: string;
  dName?: string;
  /** Mốc ms; null khi kho không còn bản ghi (tin cũ hơn cửa sổ đồng bộ nhưng còn trên màn hình). */
  sendDttm?: string | number | null;
  text?: string;
  media?: { kind: "image" | "file"; url: string; name?: string }[];
  quote?: { globalMsgId?: number | string; msg?: string } | null;
  mentions?: { uid: string; pos: number; len: number }[] | null;
}

interface ExportFile {
  source?: string;
  version?: number;
  account_uid?: string;
  exported_at?: string;
  conversation?: { toUid?: string; name?: string };
  messages?: ExportedMessage[];
}

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const MAX_MESSAGES = 200_000;

/**
 * Dựng `content` đúng hình zca-js đưa cho `parseZaloContent`: chữ là chuỗi; ảnh / tệp là object có href.
 * Ảnh từ Zalo Web đến dưới dạng data URL (web chỉ giữ blob) — bộ tải tệp của bot `fetch` được data: nên đi
 * cùng đường với ảnh tải từ Zalo, cất vào kho như thường.
 */
function buildContent(raw: ExportedMessage): { msgType: string; content: unknown } {
  const media = (raw.media ?? []).find((item) => typeof item.url === "string" && /^(https?:|data:)/.test(item.url));
  const text = raw.text ?? "";
  const originType = raw.originMsgType && raw.originMsgType !== "webchat" ? raw.originMsgType : "";
  if (media?.kind === "image") {
    // data:image/jpeg;base64,… → đuôi jpg để tên tệp trong kho có đuôi đúng
    const mime = /^data:(image\/[a-z0-9.+-]+)/i.exec(media.url)?.[1]?.toLowerCase() ?? "";
    const fileExt = mime === "image/jpeg" ? "jpg" : mime ? mime.slice(6).replace("+xml", "") : "";
    return { msgType: "chat.photo", content: { title: text, href: media.url, params: JSON.stringify({ hd: media.url, fileExt }) } };
  }
  if (media?.kind === "file") {
    const name = media.name || text || "tep";
    return { msgType: "share.file", content: { title: name, href: media.url, params: JSON.stringify({ fileExt: /\.([a-z0-9]{1,10})$/i.exec(name)?.[1] ?? "" }) } };
  }
  // Ảnh / tệp mà web không còn dữ liệu: vẫn ghi đúng LOẠI tin (không có tệp đính kèm) để dòng thời gian không thủng
  if (originType) return { msgType: originType, content: { title: text, href: "" } };
  return { msgType: "webchat", content: text };
}

// Mốc hợp lệ cho giờ gửi suy từ cliMsgId: từ 2012 (Zalo ra đời) tới giờ xuất tệp + 1 ngày (lệch đồng hồ máy)
const EARLIEST_SENT_MS = Date.UTC(2012, 0, 1);
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Giờ gửi của một tin: ưu tiên `sendDttm` từ kho IndexedDB; không có thì lấy `cliMsgId` — Zalo đặt mã này
 * bằng mốc ms của máy gửi (đo 02/10/2026: tệp xuất trên Edge không khớp được kho, 0/63 tin có sendDttm,
 * nhưng cliMsgId 1790391868086 = 26/09 khớp đúng giờ tin trên Zalo). Cả hai hỏng thì lấy giờ xuất tệp.
 */
export function resolveSentAtMs(raw: Pick<ExportedMessage, "sendDttm" | "cliMsgId">, fallbackMs: number): number {
  const fromStore = Number(raw.sendDttm);
  if (Number.isFinite(fromStore) && fromStore > 0) return fromStore;
  const fromClient = Number(raw.cliMsgId);
  if (Number.isFinite(fromClient) && fromClient >= EARLIEST_SENT_MS && fromClient <= fallbackMs + CLOCK_SKEW_MS) return fromClient;
  return fallbackMs;
}

function toIncoming(raw: ExportedMessage, fallbackMs: number): IncomingGroupMessage | null {
  if (!raw || typeof raw.msgId !== "string" || typeof raw.toUid !== "string" || !raw.toUid.startsWith("g")) return null;
  const { msgType, content } = buildContent(raw);
  return {
    zaloGroupId: raw.toUid.slice(1),
    msgId: raw.msgId,
    cliMsgId: String(raw.cliMsgId ?? ""),
    msgType,
    senderUid: String(raw.fromUid),
    // Tên đọc từ màn hình Zalo Web dùng khoảng trắng không ngắt (U+00A0) — đổi về dấu cách thường để tìm / lọc khớp
    senderName: String(raw.dName ?? "").replace(/\u00a0/g, " ").trim(),
    sentAtMs: resolveSentAtMs(raw, fallbackMs),
    content,
    quote: raw.quote?.globalMsgId !== undefined ? { globalMsgId: raw.quote.globalMsgId, msg: raw.quote.msg ?? "" } : null,
    mentions: Array.isArray(raw.mentions) && raw.mentions.length ? raw.mentions : null,
  };
}

/**
 * Tin đã có trong kho nhưng thiếu ảnh / chữ (nhập lần trước khi web chưa đưa được ảnh, hoặc tệp bị lỗi tải):
 * bổ sung từ bản mới. Trả về true nếu có bổ sung gì.
 */
async function enrichExistingMessage(db: Db, incoming: IncomingGroupMessage, onQueueAttachment: (id: number) => void): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.text, a.id AS attachment_id, a.status AS attachment_status
     FROM message m JOIN zalo_group g ON g.id = m.group_id LEFT JOIN attachment a ON a.message_id = m.id
     WHERE g.thread_type = 1 AND g.zalo_group_id = ? AND m.zalo_msg_id = ? AND m.recalled_at IS NULL`,
    [incoming.zaloGroupId, incoming.msgId]);
  const existing = rows[0];
  if (!existing) return false;
  const parsed = parseZaloContent(incoming.msgType, incoming.content);
  let changed = false;
  if (!existing.text && parsed.text) {
    await db.query("UPDATE message SET text = ? WHERE id = ?", [parsed.text, existing.id]);
    changed = true;
  }
  if (parsed.attachment) {
    const stored = existing.attachment_id && existing.attachment_status === AttachmentStatus.Stored;
    if (!existing.attachment_id) {
      const [result] = await db.query<ResultSetHeader>(
        `INSERT INTO attachment (message_id, group_id, file_name, file_ext, declared_size, source_url, status)
         SELECT ?, group_id, ?, ?, ?, ?, ? FROM message WHERE id = ?`,
        [existing.id, parsed.attachment.fileName.slice(0, 255), parsed.attachment.fileExt.slice(0, 20), parsed.attachment.declaredSize,
          parsed.attachment.url, AttachmentStatus.Pending, existing.id]);
      onQueueAttachment(result.insertId);
      changed = true;
    } else if (!stored) {
      await db.query("UPDATE attachment SET source_url = ?, status = ?, attempts = 0, last_error = '' WHERE id = ?",
        [parsed.attachment.url, AttachmentStatus.Pending, existing.attachment_id]);
      onQueueAttachment(Number(existing.attachment_id));
      changed = true;
    }
  }
  return changed;
}

// Tin hệ thống nhập từ Zalo Web không có mã tin thật (bookmarklet tự dựng mã) — trùng với dòng bot đã tự ghi
// lúc đang chạy thì nhận ra bằng cùng câu chữ, cách nhau dưới ngần này
const SYSTEM_DUPLICATE_WINDOW_MS = 90_000;

async function hasSameSystemMessage(db: Db, incoming: IncomingGroupMessage, text: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT m.sent_at FROM message m JOIN zalo_group g ON g.id = m.group_id
     WHERE g.thread_type = ? AND g.zalo_group_id = ? AND m.kind = ? AND m.text = ?`,
    [ConversationType.Group, incoming.zaloGroupId, MessageKind.System, text]);
  return rows.some((row) => Math.abs(new Date(row.sent_at).getTime() - incoming.sentAtMs) < SYSTEM_DUPLICATE_WINDOW_MS);
}

export interface ImportSummary {
  total: number;
  imported: number;
  duplicates: number;
  /** Tin đã có nhưng thiếu ảnh / chữ, được bổ sung từ tệp (vd nhập lần đầu lúc ảnh chưa tải được). */
  enriched: number;
  skipped_direct: number;
  skipped_unknown_group: number;
  skipped_group_not_read: number;
  oldest: Date | null;
  newest: Date | null;
  groups: { zalo_group_id: string; name: string; imported: number }[];
}

/** Ghi các tin nhóm trong tệp xuất vào kho — chỉ nhóm bot ĐÃ biết; trùng mã tin thì bỏ qua. */
export async function importZaloWebExport(db: Db, file: ExportFile, onQueueAttachment: (id: number) => void): Promise<ImportSummary> {
  const messages = Array.isArray(file.messages) ? file.messages : [];
  if (!messages.length) throw new ApiError(422, "validation_error", "Tệp không có tin nào (trường `messages` rỗng)");
  if (messages.length > MAX_MESSAGES) throw new ApiError(422, "validation_error", `Tệp quá nhiều tin (trên ${MAX_MESSAGES})`);
  const summary: ImportSummary = { total: messages.length, imported: 0, duplicates: 0, enriched: 0, skipped_direct: 0, skipped_unknown_group: 0, skipped_group_not_read: 0, oldest: null, newest: null, groups: [] };
  const perGroup = new Map<string, { name: string; imported: number }>();
  const unknown = new Set<string>();
  // Cũ trước mới sau — bộ đếm «tin gần nhất» và Danh bạ ghi đúng thứ tự
  const fallbackMs = Date.parse(file.exported_at ?? "") || Date.now();
  const ordered = messages.map((raw) => toIncoming(raw, fallbackMs)).filter((item): item is IncomingGroupMessage => item !== null).sort((a, b) => a.sentAtMs - b.sentAtMs);
  summary.skipped_direct = messages.length - ordered.length;
  for (const incoming of ordered) {
    if (unknown.has(incoming.zaloGroupId)) {
      summary.skipped_unknown_group += 1;
      continue;
    }
    const group = perGroup.has(incoming.zaloGroupId) ? null : await findGroupByZaloId(db, incoming.zaloGroupId);
    if (!perGroup.has(incoming.zaloGroupId)) {
      if (!group) {
        unknown.add(incoming.zaloGroupId);
        summary.skipped_unknown_group += 1;
        continue;
      }
      perGroup.set(incoming.zaloGroupId, { name: group.label || group.name, imported: 0 });
    }
    const systemText = incoming.msgType === "system" ? parseZaloContent(incoming.msgType, incoming.content).text : "";
    if (systemText && await hasSameSystemMessage(db, incoming, systemText)) {
      summary.duplicates += 1;
      continue;
    }
    // Nhóm đã có nên không tạo mới → botAccountId chỉ dùng khi tạo, truyền 0
    const outcome = await ingestGroupMessage(
      { db, defaults: { readMessages: false, captureFiles: false }, onAttachmentQueued: onQueueAttachment },
      0,
      incoming,
    );
    if (outcome === "group_not_read") summary.skipped_group_not_read += 1;
    else if (outcome === "duplicate") {
      if (await enrichExistingMessage(db, incoming, onQueueAttachment)) summary.enriched += 1;
      else summary.duplicates += 1;
    } else {
      summary.imported += 1;
      perGroup.get(incoming.zaloGroupId)!.imported += 1;
      const at = new Date(incoming.sentAtMs);
      if (!summary.oldest || at < summary.oldest) summary.oldest = at;
      if (!summary.newest || at > summary.newest) summary.newest = at;
    }
  }
  summary.groups = [...perGroup.entries()].map(([zaloGroupId, info]) => ({ zalo_group_id: zaloGroupId, ...info }));
  for (const entry of summary.groups) {
    if (!entry.imported) continue;
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM zalo_group WHERE thread_type = 1 AND zalo_group_id = ?", [entry.zalo_group_id]);
    if (rows[0]) await recordAudit(db, { entity: "group", entityId: Number(rows[0].id), action: "import", message: `Nhập ${entry.imported} tin từ Zalo Web` });
  }
  return summary;
}

export const importRoutes: ApiRoute[] = [
  // Nhóm bot đang đọc tin — nhúng vào nút «Xuất tất cả nhóm của bot» để bookmarklet chỉ ghé đúng các nhóm này
  ["GET", /^\/api\/imports\/zalo-web\/targets$/, async ({ response, service }) => {
    const [rows] = await service.db.query<RowDataPacket[]>(
      `SELECT zalo_group_id AS id, COALESCE(NULLIF(label, ''), name) AS name FROM zalo_group
       WHERE thread_type = ${ConversationType.Group} AND read_messages = 1 ORDER BY name`);
    sendOk(response, rows.map((row) => ({ id: String(row.id), name: String(row.name) })));
  }],
  ["POST", /^\/api\/imports\/zalo-web$/, async ({ request, response, service }) => {
    const body = await readRawBody(request, MAX_IMPORT_BYTES);
    let file: ExportFile;
    try {
      file = JSON.parse(body.toString("utf8")) as ExportFile;
    } catch {
      throw new ApiError(400, "invalid_json", "Tệp không phải JSON hợp lệ");
    }
    if (file.source !== "zalo-web") throw new ApiError(422, "validation_error", "Không phải tệp xuất từ bookmarklet Zalo Web (thiếu source)");
    if (Number(file.version) < 2) throw new ApiError(422, "validation_error", "Tệp xuất bản cũ (nội dung còn mã hóa) — kéo lại nút xuất mới từ trang này rồi xuất lại");
    const summary = await importZaloWebExport(service.db, file, (id) => service.downloader.enqueue(id));
    sendOk(response, summary, `Đã nhập ${summary.imported} tin mới` +
      `${summary.enriched ? `, bổ sung ảnh / chữ cho ${summary.enriched} tin đã có` : ""}` +
      ` (${summary.duplicates} trùng, ${summary.skipped_unknown_group} tin của nhóm bot chưa ở)`);
  }],
];
