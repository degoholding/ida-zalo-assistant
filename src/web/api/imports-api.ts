import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { AttachmentStatus, ConversationType, MessageKind, UserRole } from "../../constants.js";
import { parseZaloContent } from "../../zalo/content-parser.js";
import type { Db } from "../../db/pool.js";
import { findGroupByZaloId, type GroupDefaults } from "../../sync/group-repository.js";
import { ingestDirectMessage, ingestGroupMessage, type IncomingGroupMessage, type IngestDeps } from "../../sync/message-ingest.js";
import { indexMessage } from "../../search/message-search-index.js";
import { ApiError, readJson, readRawBody, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";

// Nhập lịch sử: tệp JSON khuôn «zalo-web v2» từ hai nguồn — bookmarklet Zalo Web (~2 tuần, web/src/modules/imports) và
// Ghế đồng bộ Zalo PC (tin nhiều năm từ điện thoại, kho zalo-pc-gateway + tools/cdp-export.mjs; phase 14). Cùng khuôn:
// `conversation.toUid` = g<mã nhóm> (nhóm) hoặc uid người đối diện (chat riêng, phase 14.5); `account_uid` = tài khoản
// Zalo đã xuất — với chat riêng phải là một tài khoản nghe của bot (chủ cuộc riêng).
// Tệp đính kèm của tin nhập theo tùy chọn `files` (phase 14.8): none · images_pdf (mặc định) · all.

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

/**
 * Tệp chat riêng: `conversation.toUid` là uid người đối diện; từng tin có `toUid` = người nhận (người kia khi mình gửi,
 * mình khi họ gửi) nên mã cuộc lấy từ `conversation`, không lấy từ tin.
 */
function toIncoming(raw: ExportedMessage, fallbackMs: number, directPeerUid: string | null = null): IncomingGroupMessage | null {
  if (!raw || typeof raw.msgId !== "string") return null;
  if (!directPeerUid && (typeof raw.toUid !== "string" || !raw.toUid.startsWith("g"))) return null;
  const { msgType, content } = buildContent(raw);
  return {
    zaloGroupId: directPeerUid ?? raw.toUid.slice(1),
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
async function enrichExistingMessage(
  db: Db,
  incoming: IncomingGroupMessage,
  onQueueAttachment: (id: number) => void,
  thread: { threadType: number; ownerBotId: number | null },
  wantFile: (attachment: { fileName: string; fileExt: string; kind: MessageKind }) => boolean,
): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.text, a.id AS attachment_id, a.status AS attachment_status
     FROM message m JOIN zalo_group g ON g.id = m.group_id LEFT JOIN attachment a ON a.message_id = m.id
     WHERE g.thread_type = ? AND g.zalo_group_id = ? AND (? IS NULL OR g.owner_bot_id = ?) AND m.zalo_msg_id = ? AND m.recalled_at IS NULL`,
    [thread.threadType, incoming.zaloGroupId, thread.ownerBotId, thread.ownerBotId, incoming.msgId]);
  const existing = rows[0];
  if (!existing) return false;
  const parsed = parseZaloContent(incoming.msgType, incoming.content);
  let changed = false;
  if (!existing.text && parsed.text) {
    await db.query("UPDATE message SET text = ? WHERE id = ?", [parsed.text, existing.id]);
    // Tin trước đây không có chữ nên chưa nằm trong bảng tìm
    await indexMessage(db, Number(existing.id));
    changed = true;
  }
  if (parsed.attachment) {
    const stored = existing.attachment_id && existing.attachment_status === AttachmentStatus.Stored;
    // Tệp loại không chọn tải (phase 14.8): có dòng attachment rồi thì giữ nguyên, chưa có thì ghi dòng Skipped (tên + link)
    const capture = wantFile({ fileName: parsed.attachment.fileName, fileExt: parsed.attachment.fileExt, kind: parsed.kind });
    if (!existing.attachment_id) {
      const [result] = await db.query<ResultSetHeader>(
        `INSERT INTO attachment (message_id, group_id, file_name, file_ext, declared_size, source_url, status)
         SELECT ?, group_id, ?, ?, ?, ?, ? FROM message WHERE id = ?`,
        [existing.id, parsed.attachment.fileName.slice(0, 255), parsed.attachment.fileExt.slice(0, 20), parsed.attachment.declaredSize,
          parsed.attachment.url, capture ? AttachmentStatus.Pending : AttachmentStatus.Skipped, existing.id]);
      if (capture) onQueueAttachment(result.insertId);
      changed = true;
    } else if (!stored && capture) {
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
  /** Tệp chat riêng của tài khoản Zalo chưa gắn vào bot: bỏ cả tệp (phase 14.5). */
  skipped_unknown_account: number;
  /** Tệp này là chat riêng (true) hay nhóm (false). */
  direct: boolean;
  oldest: Date | null;
  newest: Date | null;
  groups: { zalo_group_id: string; name: string; imported: number }[];
}

/** Tùy chọn tải tệp của tin nhập (phase 14.8). `images_pdf` là mặc định đại ca chốt 09/11/2026. */
export type ImportFilesMode = "none" | "images_pdf" | "all";
export const IMPORT_FILES_MODES: readonly ImportFilesMode[] = ["none", "images_pdf", "all"];

export function wantFileByMode(mode: ImportFilesMode): (attachment: { fileName: string; fileExt: string; kind: MessageKind }) => boolean {
  if (mode === "all") return () => true;
  if (mode === "none") return () => false;
  return (a) => a.kind === MessageKind.Image || a.fileExt.toLowerCase() === "pdf";
}

export interface ImportOptions {
  files?: ImportFilesMode;
  /** Mặc định cuộc riêng mới tạo khi nhập (từ config DEFAULT_DM_*); không có thì đọc + không lấy file. */
  directDefaults?: GroupDefaults;
}

/** Tài khoản nghe đã gắn vào bot có `zalo_uid` này — chủ các cuộc riêng của tệp xuất chat riêng. */
async function findBotAccountByUid(db: Db, zaloUid: string): Promise<{ id: number; label: string } | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id, label FROM bot_account WHERE zalo_uid = ? LIMIT 1", [zaloUid]);
  return rows[0] ? { id: Number(rows[0].id), label: String(rows[0].label) } : null;
}

/**
 * Ghi các tin trong tệp xuất vào kho. Nhóm: chỉ nhóm bot ĐÃ biết. Chat riêng (phase 14.5): cuộc riêng của tài khoản nghe
 * có `zalo_uid` = `account_uid`; tin do tài khoản đó gửi gán người gửi là nó, người đối diện là mã cuộc. Trùng mã tin thì bỏ.
 */
export async function importZaloWebExport(db: Db, file: ExportFile, onQueueAttachment: (id: number) => void, options: ImportOptions = {}): Promise<ImportSummary> {
  const messages = Array.isArray(file.messages) ? file.messages : [];
  if (!messages.length) throw new ApiError(422, "validation_error", "Tệp không có tin nào (trường `messages` rỗng)");
  if (messages.length > MAX_MESSAGES) throw new ApiError(422, "validation_error", `Tệp quá nhiều tin (trên ${MAX_MESSAGES})`);
  const convId = typeof file.conversation?.toUid === "string" ? file.conversation.toUid : "";
  const direct = !!convId && !convId.startsWith("g");
  const summary: ImportSummary = { total: messages.length, imported: 0, duplicates: 0, enriched: 0, skipped_direct: 0, skipped_unknown_group: 0, skipped_group_not_read: 0, skipped_unknown_account: 0, direct, oldest: null, newest: null, groups: [] };
  const wantFile = wantFileByMode(options.files ?? "images_pdf");
  const deps: IngestDeps = {
    db, defaults: { readMessages: false, captureFiles: false },
    directDefaults: options.directDefaults ?? { readMessages: true, captureFiles: false },
    onAttachmentQueued: onQueueAttachment,
    captureOverride: (a) => wantFile(a),
  };
  // Cũ trước mới sau — bộ đếm "tin gần nhất" và Danh bạ ghi đúng thứ tự
  const fallbackMs = Date.parse(file.exported_at ?? "") || Date.now();

  if (direct) {
    const accountUid = typeof file.account_uid === "string" ? file.account_uid : "";
    const account = accountUid ? await findBotAccountByUid(db, accountUid) : null;
    if (!account) { summary.skipped_unknown_account = messages.length; return summary; }
    const peerName = typeof file.conversation?.name === "string" ? file.conversation.name : "";
    const ordered = messages.map((raw) => toIncoming(raw, fallbackMs, convId)).filter((item): item is IncomingGroupMessage => item !== null).sort((a, b) => a.sentAtMs - b.sentAtMs);
    summary.skipped_direct = 0;
    // Tên người đối diện: tên trong tệp, không có thì tên người gửi đầu tiên không phải tài khoản nghe
    const peer = { uid: convId, name: peerName || ordered.find((m) => m.senderUid !== accountUid)?.senderName || "" };
    let imported = 0;
    for (const incoming of ordered) {
      const result = await ingestDirectMessage(deps, account.id, incoming, { peer });
      if (result.outcome === "group_not_read") summary.skipped_group_not_read += 1;
      else if (result.outcome === "duplicate") {
        if (await enrichExistingMessage(db, incoming, onQueueAttachment, { threadType: ConversationType.Direct, ownerBotId: account.id }, wantFile)) summary.enriched += 1;
        else summary.duplicates += 1;
      } else {
        summary.imported += 1; imported += 1;
        const at = new Date(incoming.sentAtMs);
        if (!summary.oldest || at < summary.oldest) summary.oldest = at;
        if (!summary.newest || at > summary.newest) summary.newest = at;
      }
    }
    summary.groups = [{ zalo_group_id: convId, name: peer.name || convId, imported }];
    if (imported) {
      const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM zalo_group WHERE thread_type = ? AND zalo_group_id = ? AND owner_bot_id = ?", [ConversationType.Direct, convId, account.id]);
      if (rows[0]) await recordAudit(db, { entity: "group", entityId: Number(rows[0].id), action: "import", message: `Nhập ${imported} tin chat riêng (tài khoản ${account.label})` });
    }
    return summary;
  }

  const perGroup = new Map<string, { name: string; imported: number }>();
  const unknown = new Set<string>();
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
    const outcome = await ingestGroupMessage(deps, 0, incoming);
    if (outcome === "group_not_read") summary.skipped_group_not_read += 1;
    else if (outcome === "duplicate") {
      if (await enrichExistingMessage(db, incoming, onQueueAttachment, { threadType: ConversationType.Group, ownerBotId: null }, wantFile)) summary.enriched += 1;
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

/** Trạng thái ghế đồng bộ Zalo PC (phase 14.6) — phần gọn của `GET /status` ở Cổng, đủ cho màn Nhập lịch sử. */
export interface SeatInfo {
  configured: boolean;
  reachable: boolean;
  error?: string;
  status?: {
    phase: string;
    user: { userId: string; displayName: string } | null;
    /** Tài khoản đang ngồi ghế có gắn vào bot không (có thì tệp chat riêng nhập được). */
    linked_account: string | null;
    conversations: number;
    last_qr_at: number;
    sync: { ready: boolean; running: boolean; progress: number | null; last_result: string | null; started_at: number | null; finished_at: number | null } | null;
    /** Tiến độ việc ghế do `tools/sync-once.mjs` đẩy vào cổng (POST /job); null khi ghế chạy tay không qua sync-once. */
    job: SeatJob | null;
  };
}

/** Một việc ghế: login → sync (điện thoại gửi tin) → export (ghế xuất tin) → import (nạp vào bot) → done | error. */
export interface SeatJob {
  stage: "login" | "sync" | "export" | "import" | "done" | "error";
  percent: number;
  note: string | null;
  error: string | null;
  conversations: { done: number; total: number } | null;
  files: { done: number; total: number } | null;
  /** Số tệp đính kèm (ảnh, PDF, …) trong các tệp đã xuất — tệp thật bot tải về sau, đếm ở bảng kết quả. */
  media: number | null;
  messages: { imported: number; duplicates: number } | null;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number | null;
}

const SEAT_STAGES = new Set<SeatJob["stage"]>(["login", "sync", "export", "import", "done", "error"]);

function parseSeatJob(raw: unknown): SeatJob | null {
  if (!raw || typeof raw !== "object") return null;
  const job = raw as Record<string, unknown>;
  const pair = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    return { done: Number(v.done) || 0, total: Number(v.total) || 0 };
  };
  const messages = job.messages && typeof job.messages === "object" ? (job.messages as Record<string, unknown>) : null;
  const stage = SEAT_STAGES.has(job.stage as SeatJob["stage"]) ? (job.stage as SeatJob["stage"]) : "login";
  return {
    stage,
    percent: Math.max(0, Math.min(100, Number(job.percent) || 0)),
    note: job.note ? String(job.note) : null,
    error: job.error ? String(job.error) : null,
    conversations: pair(job.conversations),
    files: pair(job.files),
    media: job.media == null ? null : Number(job.media) || 0,
    messages: messages ? { imported: Number(messages.imported) || 0, duplicates: Number(messages.duplicates) || 0 } : null,
    started_at: Number(job.startedAt) || null,
    finished_at: Number(job.finishedAt) || null,
    updated_at: Number(job.updatedAt) || null,
  };
}

const SEAT_TIMEOUT_MS = 4000;

export async function fetchSeatInfo(db: Db, gatewayUrl: string, fetcher: typeof fetch = fetch): Promise<SeatInfo> {
  if (!gatewayUrl) return { configured: false, reachable: false };
  let raw: Record<string, unknown>;
  try {
    const res = await fetcher(`${gatewayUrl}/status`, { signal: AbortSignal.timeout(SEAT_TIMEOUT_MS) });
    if (!res.ok) return { configured: true, reachable: false, error: `Cổng trả HTTP ${res.status}` };
    raw = (await res.json()) as Record<string, unknown>;
  } catch (error) {
    return { configured: true, reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
  const user = raw.user && typeof raw.user === "object" ? (raw.user as { userId?: unknown; displayName?: unknown }) : null;
  const userId = user && user.userId ? String(user.userId) : "";
  let linked: string | null = null;
  if (userId) {
    const account = await findBotAccountByUid(db, userId);
    linked = account ? account.label : null;
  }
  const sync = raw.sync && typeof raw.sync === "object" ? (raw.sync as Record<string, unknown>) : null;
  const progress = sync && sync.progress && typeof sync.progress === "object" ? (sync.progress as Record<string, unknown>) : null;
  return {
    configured: true,
    reachable: true,
    status: {
      phase: String(raw.phase ?? ""),
      user: userId ? { userId, displayName: String(user?.displayName ?? "") } : null,
      linked_account: linked,
      conversations: Number(raw.conversations ?? 0) || 0,
      last_qr_at: Number(raw.lastQrAt ?? 0) || 0,
      sync: sync ? {
        ready: Boolean(sync.ready),
        running: Boolean(sync.running),
        // Hai giai đoạn của đồng bộ v2: tin xem trước + gần đây, rồi phần còn lại — gộp thành một số cho dễ nhìn
        progress: progress ? Math.round(((Number(progress.previewAndRecent) || 0) + (Number(progress.other) || 0)) / 2) : null,
        last_result: sync.lastResult ? String(sync.lastResult) : null,
        started_at: Number(sync.startedAt) || null,
        finished_at: Number(sync.finishedAt) || null,
      } : null,
      job: parseSeatJob(raw.job),
    },
  };
}

/** Dịch vụ bật / tắt ghế trên máy chủ (tools/seat-launcher.mjs, phase 14.9) nhìn từ bot. */
export interface SeatLauncherInfo {
  configured: boolean;
  reachable: boolean;
  /** Người đang xem có được bấm Bật / Tắt không (chỉ Quản trị). */
  can_control: boolean;
  error?: string;
  running: boolean;
  account: string | null;
  started_at: number | null;
  finished_at: number | null;
  exit_code: number | null;
  log_tail: string[];
}

export interface SeatLauncherConfig {
  url: string;
  token: string;
}

const LAUNCHER_TIMEOUT_MS = 8000;

async function callLauncher(config: SeatLauncherConfig, pathname: string, method: "GET" | "POST", body?: unknown, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!config.url) throw new ApiError(404, "not_found", "Chưa cấu hình SEAT_LAUNCHER_URL");
  if (!config.token) throw new ApiError(500, "misconfigured", "Thiếu SEAT_LAUNCHER_TOKEN");
  try {
    return await fetcher(`${config.url}${pathname}`, {
      method, headers: { "X-Seat-Token": config.token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(LAUNCHER_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(502, "launcher_unreachable", "Không nối được tới dịch vụ bật ghế trên máy chủ");
  }
}

function shapeLauncher(raw: Record<string, unknown>, canControl: boolean): SeatLauncherInfo {
  return {
    configured: true, reachable: true, can_control: canControl,
    running: Boolean(raw.running), account: raw.account ? String(raw.account) : null,
    started_at: Number(raw.started_at) || null, finished_at: Number(raw.finished_at) || null,
    exit_code: raw.exit_code === null || raw.exit_code === undefined ? null : Number(raw.exit_code),
    log_tail: Array.isArray(raw.log_tail) ? raw.log_tail.slice(-6).map((line) => String(line).slice(0, 300)) : [],
  };
}

const LAUNCHER_OFF = (canControl: boolean): SeatLauncherInfo => ({
  configured: false, reachable: false, can_control: canControl, running: false, account: null, started_at: null, finished_at: null, exit_code: null, log_tail: [],
});

export async function fetchSeatLauncherInfo(config: SeatLauncherConfig, canControl: boolean, fetcher: typeof fetch = fetch): Promise<SeatLauncherInfo> {
  if (!config.url) return LAUNCHER_OFF(canControl);
  let res: Response;
  try {
    res = await callLauncher(config, "/status", "GET", undefined, fetcher);
  } catch (error) {
    return { ...LAUNCHER_OFF(canControl), configured: true, error: error instanceof ApiError ? error.message : String(error) };
  }
  if (!res.ok) return { ...LAUNCHER_OFF(canControl), configured: true, error: `Dịch vụ bật ghế trả HTTP ${res.status}` };
  return shapeLauncher((await res.json()) as Record<string, unknown>, canControl);
}

const SEAT_ACCOUNT_RE = /^[\w.-]{1,40}$/;

/** Bật ghế cho một tài khoản (tên thư mục dữ liệu trên máy chủ) — chỉ Quản trị. */
export async function startSeat(config: SeatLauncherConfig, account: string, fetcher: typeof fetch = fetch): Promise<SeatLauncherInfo> {
  const name = account.trim();
  if (!SEAT_ACCOUNT_RE.test(name)) throw new ApiError(422, "invalid_account", "Tên tài khoản chỉ gồm chữ, số, dấu chấm, gạch (tối đa 40)");
  const res = await callLauncher(config, "/start", "POST", { account: name }, fetcher);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status === 409 ? 409 : 502, "seat_start_failed", String(body.error || `Dịch vụ bật ghế trả HTTP ${res.status}`));
  return shapeLauncher(body, true);
}

export async function stopSeat(config: SeatLauncherConfig, fetcher: typeof fetch = fetch): Promise<SeatLauncherInfo> {
  const res = await callLauncher(config, "/stop", "POST", undefined, fetcher);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(502, "seat_stop_failed", String(body.error || `Dịch vụ bật ghế trả HTTP ${res.status}`));
  return shapeLauncher(body, true);
}

/** Nút Đăng xuất ghế ở màn Nhập lịch sử: cổng đăng xuất chính thức (trả suất PC); sync-once thấy ghế về trang QR thì tắt container. */
export async function logoutSeat(gatewayUrl: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!gatewayUrl) throw new ApiError(404, "not_found", "Chưa cấu hình SEAT_GATEWAY_URL");
  let res: Response;
  try {
    res = await fetcher(`${gatewayUrl}/logout`, { method: "POST", signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new ApiError(502, "seat_unreachable", "Không nối được tới cổng ghế");
  }
  const text = await res.text();
  if (!res.ok) throw new ApiError(502, "seat_logout_failed", `Ghế không đăng xuất được: ${text || res.status}`);
  return text;
}

/** `GET /api/imports/results` — mỗi cuộc từng được nhập tin cũ: số tin đang có, mốc cũ nhất / mới nhất, lần nhập cuối. */
export interface ImportResultRow {
  group_id: number;
  thread_type: number;
  zalo_thread_id: string;
  name: string;
  read_messages: boolean;
  messages: number;
  oldest: string | null;
  newest: string | null;
  last_import_at: string | null;
  imports: number;
  /** Tệp đính kèm đã tải về kho (trạng thái Stored) và tổng dung lượng byte. */
  attachments: number;
  attachments_bytes: number;
}

export async function listImportResults(db: Db, limit = 300): Promise<ImportResultRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT g.id, g.thread_type, g.zalo_group_id, COALESCE(NULLIF(g.label, ''), g.name) AS name, g.read_messages,
            (SELECT COUNT(*) FROM message m WHERE m.group_id = g.id) AS messages,
            (SELECT MIN(m.sent_at) FROM message m WHERE m.group_id = g.id) AS oldest,
            (SELECT MAX(m.sent_at) FROM message m WHERE m.group_id = g.id) AS newest,
            (SELECT COUNT(*) FROM attachment t WHERE t.group_id = g.id AND t.status = ${AttachmentStatus.Stored}) AS attachments,
            (SELECT COALESCE(SUM(t.stored_bytes), 0) FROM attachment t WHERE t.group_id = g.id AND t.status = ${AttachmentStatus.Stored}) AS attachments_bytes,
            a.last_import_at, a.imports
     FROM zalo_group g
     JOIN (SELECT entity_id, MAX(created_at) AS last_import_at, COUNT(*) AS imports FROM audit_log
           WHERE entity = 'group' AND action = 'import' GROUP BY entity_id) a ON a.entity_id = g.id
     ORDER BY a.last_import_at DESC LIMIT ?`, [limit]);
  const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null);
  return rows.map((row) => ({
    group_id: Number(row.id), thread_type: Number(row.thread_type), zalo_thread_id: String(row.zalo_group_id), name: String(row.name ?? ""),
    read_messages: Boolean(row.read_messages), messages: Number(row.messages) || 0,
    oldest: iso(row.oldest), newest: iso(row.newest), last_import_at: iso(row.last_import_at), imports: Number(row.imports) || 0,
    attachments: Number(row.attachments) || 0, attachments_bytes: Number(row.attachments_bytes) || 0,
  }));
}

export const importRoutes: ApiRoute[] = [
  // Ghế đồng bộ Zalo PC (phase 14.6): trạng thái + QR lấy qua bot để người quản trị không cần mở cổng ra ngoài
  ["GET", /^\/api\/imports\/seat$/, async ({ response, service, principal }) => {
    const launcherConfig = { url: service.config.seatLauncherUrl, token: service.config.seatLauncherToken };
    const [seat, launcher] = await Promise.all([
      fetchSeatInfo(service.db, service.config.seatGatewayUrl),
      fetchSeatLauncherInfo(launcherConfig, principal.role === UserRole.Admin),
    ]);
    sendOk(response, { ...seat, launcher });
  }],
  // Bật / tắt ghế từ web (phase 14.9): bot gọi dịch vụ seat-launcher trên máy chủ; chỉ Quản trị
  ["POST", /^\/api\/imports\/seat\/start$/, async ({ request, response, service, principal }) => {
    if (principal.role !== UserRole.Admin) throw new ApiError(403, "forbidden", "Chỉ Quản trị được bật ghế");
    const body = await readJson(request);
    const info = await startSeat({ url: service.config.seatLauncherUrl, token: service.config.seatLauncherToken }, String(body.account ?? ""));
    await recordAudit(service.db, { entity: "seat", entityId: 0, action: "start", message: `Bật ghế ${info.account ?? ""}` });
    sendOk(response, info, `Đã bật ghế ${info.account ?? ""}`);
  }],
  ["POST", /^\/api\/imports\/seat\/stop$/, async ({ response, service, principal }) => {
    if (principal.role !== UserRole.Admin) throw new ApiError(403, "forbidden", "Chỉ Quản trị được tắt ghế");
    const info = await stopSeat({ url: service.config.seatLauncherUrl, token: service.config.seatLauncherToken });
    await recordAudit(service.db, { entity: "seat", entityId: 0, action: "stop", message: `Tắt ghế ${info.account ?? ""}` });
    sendOk(response, info, "Đã tắt ghế");
  }],
  ["GET", /^\/api\/imports\/seat\/qr\.png(\?.*)?$/, async ({ response, service }) => {
    if (!service.config.seatGatewayUrl) throw new ApiError(404, "not_found", "Chưa cấu hình SEAT_GATEWAY_URL");
    let upstream: Response;
    try {
      upstream = await fetch(`${service.config.seatGatewayUrl}/qr.png`, { signal: AbortSignal.timeout(SEAT_TIMEOUT_MS) });
    } catch {
      throw new ApiError(502, "seat_unreachable", "Không nối được tới cổng ghế");
    }
    if (!upstream.ok) throw new ApiError(404, "not_found", "Ghế chưa có mã QR");
    response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  }],
  ["POST", /^\/api\/imports\/seat\/logout$/, async ({ response, service }) => {
    const result = await logoutSeat(service.config.seatGatewayUrl);
    sendOk(response, { result }, "Đã đăng xuất ghế");
  }],
  ["GET", /^\/api\/imports\/results$/, async ({ response, service }) => {
    sendOk(response, await listImportResults(service.db));
  }],
  // Nhóm bot đang đọc tin — nhúng vào nút "Xuất tất cả nhóm của bot" để bookmarklet chỉ ghé đúng các nhóm này
  ["GET", /^\/api\/imports\/zalo-web\/targets$/, async ({ response, service }) => {
    const [rows] = await service.db.query<RowDataPacket[]>(
      `SELECT zalo_group_id AS id, COALESCE(NULLIF(label, ''), name) AS name FROM zalo_group
       WHERE thread_type = ${ConversationType.Group} AND read_messages = 1 ORDER BY name`);
    sendOk(response, rows.map((row) => ({ id: String(row.id), name: String(row.name) })));
  }],
  // ?files=none|images_pdf|all — tệp đính kèm của tin nhập (phase 14.8), mặc định images_pdf
  ["POST", /^\/api\/imports\/zalo-web(\?.*)?$/, async ({ request, response, service }) => {
    const query = new URL(request.url ?? "/", "http://local").searchParams;
    const filesParam = query.get("files") ?? "images_pdf";
    if (!IMPORT_FILES_MODES.includes(filesParam as ImportFilesMode)) throw new ApiError(422, "validation_error", "`files` chỉ nhận none | images_pdf | all");
    const body = await readRawBody(request, MAX_IMPORT_BYTES);
    let file: ExportFile;
    try {
      file = JSON.parse(body.toString("utf8")) as ExportFile;
    } catch {
      throw new ApiError(400, "invalid_json", "Tệp không phải JSON hợp lệ");
    }
    if (file.source !== "zalo-web") throw new ApiError(422, "validation_error", "Không phải tệp xuất khuôn zalo-web (thiếu source)");
    if (Number(file.version) < 2) throw new ApiError(422, "validation_error", "Tệp xuất bản cũ (nội dung còn mã hóa) — kéo lại nút xuất mới từ trang này rồi xuất lại");
    const summary = await importZaloWebExport(service.db, file, (id) => service.downloader.enqueue(id), {
      files: filesParam as ImportFilesMode,
      directDefaults: { readMessages: service.config.defaultDirectRead, captureFiles: false },
    });
    if (summary.skipped_unknown_account) {
      sendOk(response, summary, `Bỏ qua: tệp chat riêng của tài khoản Zalo ${file.account_uid ?? "?"} chưa gắn vào bot`);
      return;
    }
    sendOk(response, summary, `Đã nhập ${summary.imported} tin mới${summary.direct ? " (chat riêng)" : ""}` +
      `${summary.enriched ? `, bổ sung ảnh / chữ cho ${summary.enriched} tin đã có` : ""}` +
      ` (${summary.duplicates} trùng${summary.direct ? "" : `, ${summary.skipped_unknown_group} tin của nhóm bot chưa ở`})`);
  }],
];
