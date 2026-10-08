import type { RowDataPacket } from "mysql2";
import { ConversationType } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { enqueueRecipientMessage } from "../../recipients/recipient-repository.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { diffFields, recordAudit } from "./audit-log.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";

// Người nhận cảnh báo / bản tin (phase 4, chỉ quản trị sửa). Mỗi người: người trên Zalo (kênh nhắn riêng của bot), thứ
// tự ưu tiên, chức danh, nhóm theo dõi, danh sách VIP (IDA câu 5: 20–30 người), giờ bản tin sáng / cuối ngày.

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_GROUPS = 500;
const MAX_VIPS = 50;
const TEST_TEXT = "Dạ đây là tin thử kênh báo của Bot trợ lý — từ giờ cảnh báo tin khẩn, việc đến hạn và bản tin sẽ gửi vào chat này ạ.";

export const RECIPIENT_LIST_SPEC: ListSpec = {
  fields: {
    name: { sql: "r.name", type: "text" },
    title: { sql: "r.title", type: "text" },
    rank_order: { sql: "r.rank_order", type: "number" },
    is_active: { sql: "r.is_active", type: "boolean" },
  },
  sorts: { rank_order: "r.rank_order", name: "r.name" },
  defaultSort: { by: "rank_order", dir: "asc" },
  tieBreaker: "r.id",
  search: { param: "q", columns: ["r.name", "r.title"] },
};

const RECIPIENT_FROM = "FROM recipient r JOIN contact c ON c.id = r.contact_id LEFT JOIN app_user u ON u.id = r.user_id";
const RECIPIENT_COLUMNS = `r.id, r.name, r.title, r.rank_order, r.contact_id, COALESCE(NULLIF(c.display_name, ''), c.zalo_name) AS contact_name,
  r.user_id, u.email AS user_email, r.all_groups, r.morning_brief_at, r.evening_brief_at, r.notify_urgent, r.is_active, r.created_at,
  (SELECT COUNT(*) FROM recipient_group rg WHERE rg.recipient_id = r.id) AS group_count,
  (SELECT COUNT(*) FROM recipient_vip rv WHERE rv.recipient_id = r.id) AS vip_count`;

const FIELD_LABELS = {
  name: "Tên", title: "Chức danh", rank_order: "Thứ tự ưu tiên", contact_id: "Người trên Zalo", user_id: "Tài khoản web",
  all_groups: "Mọi nhóm", morning_brief_at: "Giờ bản tin sáng", evening_brief_at: "Giờ bản tin cuối ngày",
  notify_urgent: "Báo ngay tin khẩn", is_active: "Đang dùng", group_ids: "Nhóm theo dõi", vip_contact_ids: "Người VIP",
};

function decorate(rows: RowDataPacket[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...row, user_id: row.user_id === null ? 0 : Number(row.user_id), all_groups: Boolean(row.all_groups),
    notify_urgent: Boolean(row.notify_urgent), is_active: Boolean(row.is_active),
    group_count: Number(row.group_count), vip_count: Number(row.vip_count),
  }));
}

export async function getRecipientDetail(db: Db, id: number): Promise<Record<string, unknown>> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${RECIPIENT_COLUMNS} ${RECIPIENT_FROM} WHERE r.id = ?`, [id]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có người nhận này");
  const [groups] = await db.query<RowDataPacket[]>("SELECT group_id FROM recipient_group WHERE recipient_id = ? ORDER BY group_id", [id]);
  const [vips] = await db.query<RowDataPacket[]>(
    `SELECT v.contact_id, COALESCE(NULLIF(c.display_name, ''), c.zalo_name) AS name FROM recipient_vip v
     JOIN contact c ON c.id = v.contact_id WHERE v.recipient_id = ? ORDER BY name`, [id]);
  return {
    ...decorate(rows)[0],
    group_ids: groups.map((row) => Number(row.group_id)),
    vip_contact_ids: vips.map((row) => Number(row.contact_id)).sort((a, b) => a - b),
    vips: vips.map((row) => ({ contact_id: Number(row.contact_id), name: String(row.name ?? "") })),
  };
}

const invalid = (message: string) => new ApiError(422, "validation_error", message);

function parseBool(raw: unknown, label: string): boolean {
  if (typeof raw === "boolean") return raw;
  throw invalid(`${label} chỉ nhận bật / tắt`);
}

async function parseIdList(db: Db, raw: unknown, label: string, max: number, table: "zalo_group" | "contact"): Promise<number[]> {
  if (!Array.isArray(raw) || raw.length > max) throw invalid(`${label} phải là danh sách (tối đa ${max})`);
  const ids = [...new Set(raw.map(Number))];
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw invalid(`${label}: mã không hợp lệ`);
  if (ids.length) {
    const sql = table === "zalo_group" ? "SELECT id FROM zalo_group WHERE id IN (?) AND thread_type = ?" : "SELECT id FROM contact WHERE id IN (?)";
    const [rows] = await db.query<RowDataPacket[]>(sql, table === "zalo_group" ? [ids, ConversationType.Group] : [ids]);
    if (rows.length !== ids.length) throw invalid(`${label}: có mục không tồn tại`);
  }
  return ids.sort((a, b) => a - b);
}

interface RecipientInput {
  columns: Record<string, unknown>;
  groupIds?: number[];
  vipIds?: number[];
}

async function parseInput(db: Db, body: Record<string, unknown>, creating: boolean): Promise<RecipientInput> {
  const columns: Record<string, unknown> = {};
  if (body.name !== undefined || creating) {
    const name = String(body.name ?? "").trim();
    if (!name || name.length > 150) throw invalid("Tên bắt buộc, tối đa 150 ký tự");
    columns.name = name;
  }
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (title.length > 100) throw invalid("Chức danh tối đa 100 ký tự");
    columns.title = title;
  }
  if (body.rank_order !== undefined) {
    const rank = Number(body.rank_order);
    if (!Number.isInteger(rank) || rank < 1 || rank > 20) throw invalid("Thứ tự ưu tiên từ 1 đến 20");
    columns.rank_order = rank;
  }
  if (body.contact_id !== undefined || creating) {
    const contactId = Number(body.contact_id);
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM contact WHERE id = ?", [contactId || 0]);
    if (!rows[0]) throw invalid("Chọn người trên Zalo (trong Danh bạ) để bot nhắn riêng");
    columns.contact_id = contactId;
  }
  if (body.user_id !== undefined) {
    const userId = Number(body.user_id);
    if (userId) {
      const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM app_user WHERE id = ?", [userId]);
      if (!rows[0]) throw invalid("Không có tài khoản web này");
    }
    columns.user_id = userId || null;
  }
  for (const [key, label] of [["morning_brief_at", "Giờ bản tin sáng"], ["evening_brief_at", "Giờ bản tin cuối ngày"]] as const) {
    if (body[key] === undefined) continue;
    const value = String(body[key]).trim();
    if (value && !TIME_PATTERN.test(value)) throw invalid(`${label} phải dạng HH:MM (để trống = không gửi)`);
    columns[key] = value;
  }
  for (const [key, label] of [["all_groups", "Mọi nhóm"], ["notify_urgent", "Báo ngay tin khẩn"], ["is_active", "Đang dùng"]] as const) {
    if (body[key] !== undefined) columns[key] = parseBool(body[key], label) ? 1 : 0;
  }
  return {
    columns,
    groupIds: body.group_ids === undefined ? undefined : await parseIdList(db, body.group_ids, "Nhóm theo dõi", MAX_GROUPS, "zalo_group"),
    vipIds: body.vip_contact_ids === undefined ? undefined : await parseIdList(db, body.vip_contact_ids, "Người VIP", MAX_VIPS, "contact"),
  };
}

async function saveLinks(db: Db, id: number, input: RecipientInput): Promise<void> {
  if (input.groupIds) {
    await db.query("DELETE FROM recipient_group WHERE recipient_id = ?", [id]);
    if (input.groupIds.length) await db.query("INSERT INTO recipient_group (recipient_id, group_id) VALUES ?", [input.groupIds.map((groupId) => [id, groupId])]);
  }
  if (input.vipIds) {
    await db.query("DELETE FROM recipient_vip WHERE recipient_id = ?", [id]);
    if (input.vipIds.length) await db.query("INSERT INTO recipient_vip (recipient_id, contact_id) VALUES ?", [input.vipIds.map((contactId) => [id, contactId])]);
  }
}

async function assertContactFree(db: Db, tenantId: number, contactId: unknown, exceptId: number): Promise<void> {
  if (contactId === undefined) return;
  const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM recipient WHERE tenant_id = ? AND contact_id = ? AND id <> ?", [tenantId, contactId, exceptId]);
  if (rows[0]) throw invalid("Người này đã là người nhận rồi");
}

export const recipientRoutes: ApiRoute[] = [
  ["GET", /^\/api\/recipients$/, async ({ response, url, service, principal }) => sendOk(response, await runList(service.db, url.searchParams, RECIPIENT_LIST_SPEC, {
    select: RECIPIENT_COLUMNS, from: RECIPIENT_FROM, baseWhere: { sql: "r.tenant_id = ?", params: [principal.tenantId] }, decorate,
  }))],
  ["GET", /^\/api\/recipients\/(\d+)$/, async ({ response, match, service }) => sendOk(response, await getRecipientDetail(service.db, parseId(match[1])))],
  ["POST", /^\/api\/recipients$/, async ({ request, response, service, principal }) => {
    const db = service.db;
    const input = await parseInput(db, await readJson(request), true);
    await assertContactFree(db, principal.tenantId, input.columns.contact_id, 0);
    const columns = { tenant_id: principal.tenantId, ...input.columns };
    const keys = Object.keys(columns);
    const [result] = await db.query<any>(`INSERT INTO recipient (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, Object.values(columns));
    const id = Number(result.insertId);
    await saveLinks(db, id, input);
    service.alerts.invalidate();
    await recordAudit(db, { entity: "recipient", entityId: id, action: "create", message: `Thêm người nhận ${String(input.columns.name)}` });
    sendOk(response, await getRecipientDetail(db, id), "Đã thêm người nhận", 201);
  }],
  ["PATCH", /^\/api\/recipients\/(\d+)$/, async ({ request, response, match, service, principal }) => {
    const db = service.db;
    const id = parseId(match[1]);
    const before = await getRecipientDetail(db, id);
    const input = await parseInput(db, await readJson(request), false);
    await assertContactFree(db, principal.tenantId, input.columns.contact_id, id);
    const keys = Object.keys(input.columns);
    if (keys.length) await db.query(`UPDATE recipient SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`, [...Object.values(input.columns), id]);
    await saveLinks(db, id, input);
    service.alerts.invalidate();
    const after = await getRecipientDetail(db, id);
    const changed = diffFields(before, after, FIELD_LABELS);
    if (changed.length) await recordAudit(db, { entity: "recipient", entityId: id, action: "update", changedFields: changed });
    sendOk(response, after, changed.length ? "Đã lưu người nhận" : "Không có gì thay đổi");
  }],
  // Gửi thử một tin vào chat riêng của người nhận — kiểm kênh báo trước khi phase sau dùng thật
  ["POST", /^\/api\/recipients\/(\d+)\/test$/, async ({ response, match, service }) => {
    const id = parseId(match[1]);
    await getRecipientDetail(service.db, id);
    await enqueueRecipientMessage(service.db, { recipientId: id, text: TEST_TEXT });
    service.jobs.wake();
    await recordAudit(service.db, { entity: "recipient", entityId: id, action: "test_message", message: "Gửi thử kênh báo" });
    sendOk(response, null, "Đã xếp tin thử vào hàng gửi — người nhận thấy tin trong chat riêng với bot sau vài giây");
  }],
];
