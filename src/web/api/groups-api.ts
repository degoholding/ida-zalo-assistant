import type { RowDataPacket } from "mysql2";
import { ConversationType, GroupKind } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { describeError } from "../../logger.js";
import type { SyncService } from "../../sync-service.js";
import { updateGroupSettings, type GroupSettingsPatch } from "../../sync/group-repository.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { diffFields, recordAudit } from "./audit-log.js";
import { contactAvatarUrl, loadBotUids, parseCompanyId } from "./contacts-api.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";

// API Nhóm Zalo: danh sách, chi tiết (kèm thành viên), sửa cấu hình đọc / lấy file / công ty, lấy tin cũ.

const GROUP = ConversationType.Group;
const RETENTION_MIN = 1;
const RETENTION_MAX = 3650;
const LABEL_MAX = 100;

export const GROUP_LIST_SPEC: ListSpec = {
  fields: {
    group_kind: { sql: "g.group_kind", type: "number" },
    company_id: { sql: "g.company_id", type: "number" },
    read_messages: { sql: "g.read_messages", type: "boolean" },
    capture_files: { sql: "g.capture_files", type: "boolean" },
    name: { sql: "g.name", type: "text" },
    label: { sql: "g.label", type: "text" },
    zalo_group_id: { sql: "g.zalo_group_id", type: "text" },
    member_count: { sql: "g.member_count", type: "number" },
    retention_days: { sql: "g.retention_days", type: "number" },
    last_message_at: { sql: "g.last_message_at", type: "date" },
    message_count: { sql: "g.message_count", type: "number" },
    // Còn tài khoản bot nào đang ở trong nhóm không
    has_bot: {
      type: "boolean",
      build: (_operator, values) => {
        const exists = "EXISTS (SELECT 1 FROM bot_group bg WHERE bg.group_id = g.id AND bg.left_at IS NULL)";
        return { sql: values[0] === "1" || values[0] === "true" ? exists : `NOT ${exists}`, params: [] };
      },
    },
  },
  sorts: {
    name: "COALESCE(NULLIF(g.label, ''), g.name)",
    last_message_at: "g.last_message_at IS NULL, g.last_message_at",
    member_count: "g.member_count",
    message_count: "g.message_count",
  },
  defaultSort: { by: "last_message_at", dir: "desc" },
  tieBreaker: "g.id",
  search: { param: "q", columns: ["g.name", "g.label", "g.zalo_group_id"] },
};

const GROUP_FROM = "FROM zalo_group g LEFT JOIN company co ON co.id = g.company_id";
const GROUP_COLUMNS = `
  g.id, g.zalo_group_id, g.name, g.label, g.group_kind, g.company_id, co.name AS company_name, g.member_count,
  g.read_messages, g.capture_files, g.retention_days, g.first_seen_at, g.members_synced_at,
  IF(g.avatar_key IS NULL, NULL, CONCAT('/avatars/g/', g.id)) AS avatar_url,
  (SELECT COUNT(*) FROM bot_group bg WHERE bg.group_id = g.id AND bg.left_at IS NULL) AS bot_count,
  g.message_count, g.last_message_at,
  (SELECT COUNT(*) FROM attachment a WHERE a.group_id = g.id) AS file_count`;

const FIELD_LABELS = {
  label: "Tên gọi", group_kind: "Loại nhóm", company_id: "Công ty", read_messages: "Đọc tin",
  capture_files: "Lấy file", retention_days: "Số ngày lưu",
};

function decorate(rows: RowDataPacket[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...row,
    company_id: row.company_id === null ? 0 : Number(row.company_id),
    bot_count: Number(row.bot_count),
    message_count: Number(row.message_count),
    file_count: Number(row.file_count),
    read_messages: Boolean(row.read_messages),
    capture_files: Boolean(row.capture_files),
  }));
}

export function listGroups(db: Db, params: URLSearchParams) {
  return runList(db, params, GROUP_LIST_SPEC, {
    select: GROUP_COLUMNS, from: GROUP_FROM, baseWhere: { sql: "g.thread_type = ?", params: [GROUP] }, decorate,
  });
}

async function loadGroup(db: Db, id: number): Promise<Record<string, unknown>> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${GROUP_COLUMNS} ${GROUP_FROM} WHERE g.id = ? AND g.thread_type = ?`, [id, GROUP]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có nhóm này");
  return decorate(rows)[0];
}

/** Thành viên nhóm kèm hồ sơ Danh bạ — dùng cho tab Thành viên và cột phải màn Hội thoại. */
export async function listGroupMembers(db: Db, groupId: number): Promise<Record<string, unknown>[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT gm.zalo_uid, c.id AS contact_id,
            COALESCE(NULLIF(gm.display_name, ''), NULLIF(c.display_name, ''), NULLIF(c.zalo_name, ''), gm.zalo_uid) AS name,
            COALESCE(c.kind, 0) AS kind, COALESCE(c.role, 0) AS role, gm.is_admin, gm.first_seen_at, gm.left_at, c.avatar_key,
            (SELECT d.id FROM zalo_group d WHERE d.thread_type = ${ConversationType.Direct} AND d.zalo_group_id = gm.zalo_uid LIMIT 1) AS direct_thread_id
     FROM group_member gm LEFT JOIN contact c ON c.zalo_uid = gm.zalo_uid
     WHERE gm.group_id = ? ORDER BY gm.left_at IS NOT NULL, gm.is_admin DESC, name LIMIT 1000`, [groupId]);
  const bots = await loadBotUids(db);
  return rows.map((row) => {
    const { avatar_key: avatarKey, ...rest } = row;
    return { ...rest, avatar_url: contactAvatarUrl(row.zalo_uid, avatarKey), is_bot: bots.has(String(row.zalo_uid)), is_admin: Boolean(row.is_admin) };
  });
}

export async function getGroupDetail(db: Db, id: number): Promise<Record<string, unknown>> {
  const group = await loadGroup(db, id);
  const [bots] = await db.query<RowDataPacket[]>(
    `SELECT b.id, b.label, b.display_name, bg.joined_at, bg.left_at FROM bot_group bg JOIN bot_account b ON b.id = bg.bot_account_id
     WHERE bg.group_id = ? ORDER BY bg.left_at IS NOT NULL, b.label`, [id]);
  return { ...group, members: await listGroupMembers(db, id), bots };
}

function parseFlag(raw: unknown, label: string): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === 1 || raw === 0 || raw === "1" || raw === "0" || raw === "true" || raw === "false") return raw === 1 || raw === "1" || raw === "true";
  throw new ApiError(422, "validation_error", `${label} chỉ nhận bật / tắt`);
}

/** Sửa cấu hình nhóm. Trả lời kèm câu nhắc khi vừa BẬT đọc (có lấy được tin cũ hay không). */
export async function patchGroup(service: SyncService, id: number, body: Record<string, unknown>): Promise<string> {
  const db = service.db;
  const before = await loadGroup(db, id);
  const patch: GroupSettingsPatch = {};
  if (body.label !== undefined) {
    if (typeof body.label !== "string") throw new ApiError(422, "validation_error", "Tên gọi phải là chữ");
    if (body.label.trim().length > LABEL_MAX) throw new ApiError(422, "validation_error", `Tên gọi tối đa ${LABEL_MAX} ký tự`);
    patch.label = body.label.trim();
  }
  if (body.group_kind !== undefined) {
    if (!Object.values(GroupKind).includes(Number(body.group_kind))) throw new ApiError(422, "validation_error", "Loại nhóm không hợp lệ");
    patch.groupKind = Number(body.group_kind);
  }
  if (body.company_id !== undefined) patch.companyId = await parseCompanyId(db, body.company_id);
  if (body.read_messages !== undefined) patch.readMessages = parseFlag(body.read_messages, "Đọc tin");
  if (body.capture_files !== undefined) patch.captureFiles = parseFlag(body.capture_files, "Lấy file");
  if (body.retention_days !== undefined) {
    const days = Number(body.retention_days);
    if (!Number.isInteger(days) || days < RETENTION_MIN || days > RETENTION_MAX) {
      throw new ApiError(422, "validation_error", `Số ngày lưu phải từ ${RETENTION_MIN} đến ${RETENTION_MAX}`);
    }
    patch.retentionDays = days;
  }
  await updateGroupSettings(db, id, patch);
  const after = {
    label: patch.label ?? before.label, group_kind: patch.groupKind ?? before.group_kind,
    company_id: patch.companyId === undefined ? before.company_id : (patch.companyId ?? 0),
    read_messages: patch.readMessages ?? before.read_messages, capture_files: patch.captureFiles ?? before.capture_files,
    retention_days: patch.retentionDays ?? before.retention_days,
  };
  await recordAudit(db, { entity: "group", entityId: id, action: "update", changedFields: diffFields(before, after, FIELD_LABELS) });

  // Vừa bật đọc: lấy luôn tin gần nhất, khỏi chờ có tin mới mới thấy nhóm có nội dung
  if (patch.readMessages && !before.read_messages) {
    try {
      const result = await service.backfillGroup(id);
      return result.fetched
        ? `Đã lưu và bật đọc; lấy được ${result.stored} tin gần nhất.`
        : "Đã lưu và bật đọc. Zalo không cho lấy tin cũ của nhóm (đường lịch sử nhóm đã đóng) — bot lưu từ bây giờ trở đi.";
    } catch (error) {
      return `Đã lưu và bật đọc; lấy tin cũ không được: ${describeError(error)}`;
    }
  }
  return "Đã lưu cấu hình nhóm";
}

export async function backfillGroup(service: SyncService, id: number): Promise<string> {
  await loadGroup(service.db, id);
  let message: string;
  try {
    const result = await service.backfillGroup(id);
    message = result.fetched === 0
      ? "Zalo không trả tin cũ nào cho nhóm này: Zalo đã đóng đường lấy lịch sử nhóm từ khoảng 06/2026 " +
        "(thư viện zca-js chưa có cách thay). Bot chỉ lưu được tin từ lúc bật «Đọc tin» trở đi."
      : `Cách lấy: ${result.method}. Zalo trả ${result.fetched} tin của nhóm, đang có trong kho ${result.stored} tin trong số đó.`;
  } catch (error) {
    throw new ApiError(502, "backfill_failed", `Lấy tin cũ không được: ${describeError(error)}`);
  }
  await recordAudit(service.db, { entity: "group", entityId: id, action: "backfill", message });
  return message;
}

export const groupRoutes: ApiRoute[] = [
  ["GET", /^\/api\/groups$/, async ({ response, url, service }) => sendOk(response, await listGroups(service.db, url.searchParams))],
  ["GET", /^\/api\/groups\/(\d+)$/, async ({ response, match, service }) => sendOk(response, await getGroupDetail(service.db, parseId(match[1])))],
  ["PATCH", /^\/api\/groups\/(\d+)$/, async ({ request, response, match, service }) => {
    const id = parseId(match[1]);
    const message = await patchGroup(service, id, await readJson(request));
    sendOk(response, await getGroupDetail(service.db, id), message);
  }],
  ["POST", /^\/api\/groups\/(\d+)\/backfill$/, async ({ response, match, service }) => {
    const id = parseId(match[1]);
    const message = await backfillGroup(service, id);
    sendOk(response, await getGroupDetail(service.db, id), message);
  }],
];
