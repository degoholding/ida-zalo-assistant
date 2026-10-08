import { SYSTEM_PRINCIPAL, type Principal } from "../../auth/principal.js";
import { assertContactVisible, contactScopeSql } from "./scope.js";
import type { RowDataPacket } from "mysql2";
import { ContactKind, ContactKindSource, ContactRole, ConversationType } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { listCompanies } from "../../sync/company-repository.js";
import { getContactTags, parseTags, setContactTags, updateContact } from "../../sync/contact-repository.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { diffFields, recordAudit } from "./audit-log.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";

// API Danh bạ cho giao diện `web/` — danh sách qua `runList`, chi tiết + sửa hồ sơ, thẻ nổi.

const DIRECT = ConversationType.Direct;

/** Ô «Loại» của biểu mẫu: "auto" = theo nhóm, còn lại là mã loại chỉnh tay. */
export const KIND_MODE_AUTO = "auto";

export const CONTACT_LIST_SPEC: ListSpec = {
  fields: {
    kind: { sql: "c.kind", type: "number" },
    role: { sql: "c.role", type: "number" },
    kind_source: { sql: "c.kind_source", type: "number" },
    company_id: { sql: "c.company_id", type: "number" },
    display_name: { sql: "c.display_name", type: "text" },
    zalo_uid: { sql: "c.zalo_uid", type: "text" },
    note: { sql: "c.note", type: "text" },
    dm_count: { sql: "c.dm_count", type: "number" },
    last_dm_at: { sql: "c.last_dm_at", type: "date" },
    first_seen_at: { sql: "c.first_seen_at", type: "date" },
    // Đã từng nhắn riêng bot (lọc nhanh «chỉ người nhắn riêng»)
    direct: {
      type: "boolean",
      build: (_operator, values) => ({ sql: values[0] === "1" || values[0] === "true" ? "c.last_dm_at IS NOT NULL" : "c.last_dm_at IS NULL", params: [] }),
    },
    group_id: {
      type: "number",
      build: (operator, values) => {
        const ids = values.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
        if (!ids.length) return null;
        const exists = "EXISTS (SELECT 1 FROM group_member gm WHERE gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL AND gm.group_id IN (?))";
        return { sql: operator === "ne" || operator === "not_in" ? `NOT ${exists}` : exists, params: [ids] };
      },
    },
    tag: {
      type: "text",
      build: (operator, values) => {
        if (!values.length) return null;
        if (operator === "contains") {
          return { sql: "EXISTS (SELECT 1 FROM contact_tag t WHERE t.contact_id = c.id AND t.tag LIKE ?)", params: [`%${values[0]}%`] };
        }
        const exists = "EXISTS (SELECT 1 FROM contact_tag t WHERE t.contact_id = c.id AND t.tag IN (?))";
        return { sql: operator === "ne" || operator === "not_in" ? `NOT ${exists}` : exists, params: [values] };
      },
    },
  },
  sorts: {
    name: "COALESCE(NULLIF(c.display_name, ''), c.zalo_name)",
    last_dm_at: "c.last_dm_at IS NULL, c.last_dm_at",
    dm_count: "c.dm_count",
    group_count: "group_count",
    first_seen_at: "c.first_seen_at",
  },
  defaultSort: { by: "last_dm_at", dir: "desc" },
  tieBreaker: "c.id",
  search: { param: "q", columns: ["c.display_name", "c.zalo_name", "c.zalo_uid", "c.note"] },
};

const CONTACT_FROM = "FROM contact c LEFT JOIN company co ON co.id = c.company_id";
const CONTACT_COLUMNS = `
  c.id, c.zalo_uid, c.global_id, c.display_name, c.zalo_name, c.avatar_key, c.kind, c.kind_source, c.role,
  c.company_id, co.name AS company_name, c.note, c.first_seen_at, c.last_dm_at, c.dm_count,
  (SELECT COUNT(*) FROM group_member gm WHERE gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL) AS group_count,
  (SELECT g.id FROM zalo_group g WHERE g.thread_type = ${DIRECT} AND g.zalo_group_id = c.zalo_uid ORDER BY g.id LIMIT 1) AS direct_thread_id`;

/** Nhãn ô cho nhật ký thay đổi. */
const FIELD_LABELS = { kind_mode: "Loại", role: "Vai trò với bot", company_id: "Công ty", note: "Ghi chú", tags: "Thẻ" };

export function contactAvatarUrl(uid: unknown, key: unknown): string | null {
  return key ? `/avatars/c/${encodeURIComponent(String(uid))}` : null;
}

export async function loadBotUids(db: Db): Promise<Set<string>> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT zalo_uid FROM bot_account WHERE zalo_uid IS NOT NULL");
  return new Set(rows.map((row) => String(row.zalo_uid)));
}

/** Gắn thẻ, ảnh, cờ bot, `kind_mode` cho các dòng — một truy vấn cho cả trang, không N+1. */
async function decorate(db: Db, rows: RowDataPacket[]): Promise<Record<string, unknown>[]> {
  const tags = await getContactTags(db, rows.map((row) => row.id as number));
  const bots = await loadBotUids(db);
  return rows.map((row) => {
    const { avatar_key: avatarKey, ...rest } = row;
    return {
      ...rest,
      avatar_url: contactAvatarUrl(row.zalo_uid, avatarKey),
      tags: tags.get(row.id as number) ?? [],
      is_bot: bots.has(String(row.zalo_uid)),
      group_count: Number(row.group_count),
      // Giá trị CHƯA gán công ty là 0 chứ không null — ô chọn của biểu mẫu không biểu diễn được null
      company_id: row.company_id === null ? 0 : Number(row.company_id),
      kind_mode: row.kind_source === ContactKindSource.Auto ? KIND_MODE_AUTO : String(row.kind),
    };
  });
}

export function listContacts(db: Db, params: URLSearchParams, principal: Principal = SYSTEM_PRINCIPAL) {
  return runList(db, params, CONTACT_LIST_SPEC, {
    select: CONTACT_COLUMNS, from: CONTACT_FROM, baseWhere: contactScopeSql(principal) ?? undefined, decorate: (rows) => decorate(db, rows),
  });
}

async function loadContact(db: Db, whereSql: string, value: unknown): Promise<Record<string, unknown>> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${CONTACT_COLUMNS} ${CONTACT_FROM} WHERE ${whereSql}`, [value]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có người này trong Danh bạ");
  const [contact] = await decorate(db, rows);
  return contact;
}

export async function getContactDetail(db: Db, id: number): Promise<Record<string, unknown>> {
  const contact = await loadContact(db, "c.id = ?", id);
  const uid = String(contact.zalo_uid);
  const [groups] = await db.query<RowDataPacket[]>(
    `SELECT g.id, COALESCE(NULLIF(g.label, ''), g.name) AS name, g.group_kind, gm.is_admin, g.member_count, gm.left_at,
            IF(g.avatar_key IS NULL, NULL, CONCAT('/avatars/g/', g.id)) AS avatar_url
     FROM group_member gm JOIN zalo_group g ON g.id = gm.group_id
     WHERE gm.zalo_uid = ? AND g.thread_type = ${ConversationType.Group} ORDER BY gm.left_at IS NOT NULL, name`, [uid]);
  const [recent] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.group_id AS thread_id, g.thread_type, COALESCE(NULLIF(g.label, ''), g.name) AS thread_name,
            m.text, a.file_name, m.sent_at
     FROM message m JOIN zalo_group g ON g.id = m.group_id LEFT JOIN attachment a ON a.message_id = m.id
     WHERE m.sender_uid = ? AND m.recalled_at IS NULL ORDER BY m.sent_at DESC LIMIT 20`, [uid]);
  const [files] = await db.query<RowDataPacket[]>(
    `SELECT a.id, a.file_name, COALESCE(NULLIF(g.label, ''), g.name) AS thread_name, m.sent_at, a.stored_bytes, a.status
     FROM attachment a JOIN message m ON m.id = a.message_id JOIN zalo_group g ON g.id = a.group_id
     WHERE m.sender_uid = ? ORDER BY m.sent_at DESC LIMIT 20`, [uid]);
  const [turns] = await db.query<RowDataPacket[]>(
    `SELECT t.id, t.created_at, t.status, q.text AS question, t.input_tokens, t.output_tokens
     FROM assistant_turn t LEFT JOIN message q ON q.id = t.question_msg_id
     WHERE t.contact_id = ? ORDER BY t.id DESC LIMIT 20`, [id]);
  const [totals] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM message WHERE sender_uid = ?", [uid]);
  return { ...contact, groups, recent, files, turns, message_total: Number(totals[0].n) };
}

/** Thẻ hồ sơ nổi (bấm ảnh) — tra theo mã Zalo vì bong bóng chat chỉ biết mã người gửi. */
export async function getContactCardByUid(db: Db, uid: string): Promise<Record<string, unknown>> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(uid)) throw new ApiError(404, "not_found", "Không có người này trong Danh bạ");
  return loadContact(db, "c.zalo_uid = ?", uid);
}

/** `company_id`: 0 / "" / null đều là «chưa gán»; số khác phải là công ty có thật. */
export async function parseCompanyId(db: Db, raw: unknown): Promise<number | null> {
  if (raw === null || raw === "" || raw === undefined || Number(raw) === 0) return null;
  const companyId = Number(raw);
  const companies = await listCompanies(db);
  if (!companies.some((company) => company.id === companyId)) throw new ApiError(422, "validation_error", "Công ty không tồn tại");
  return companyId;
}

/**
 * Sửa hồ sơ. `kind_mode`: "auto" = theo nhóm, số = chỉnh tay (vẫn nhận `kind` cũ). Chỉ nhận đúng các
 * ô cho sửa; ô lạ bỏ qua. Ô nào KHÔNG gửi thì giữ nguyên giá trị cũ (PATCH, không phải PUT).
 */
export async function patchContact(db: Db, id: number, body: Record<string, unknown>): Promise<void> {
  const before = await loadContact(db, "c.id = ?", id);

  let kind: number | "auto" = before.kind_mode === KIND_MODE_AUTO ? "auto" : Number(before.kind);
  const rawKind = body.kind_mode ?? body.kind;
  if (rawKind !== undefined) {
    if (rawKind === KIND_MODE_AUTO) kind = "auto";
    else if (Object.values(ContactKind).includes(Number(rawKind))) kind = Number(rawKind);
    else throw new ApiError(422, "validation_error", "Loại không hợp lệ");
  }
  let role = Number(before.role);
  if (body.role !== undefined) {
    if (!Object.values(ContactRole).includes(Number(body.role))) throw new ApiError(422, "validation_error", "Vai trò với bot không hợp lệ");
    role = Number(body.role);
  }
  const companyId = body.company_id === undefined ? (Number(before.company_id) || null) : await parseCompanyId(db, body.company_id);
  let note = String(before.note ?? "");
  if (body.note !== undefined) {
    if (typeof body.note !== "string") throw new ApiError(422, "validation_error", "Ghi chú phải là chữ");
    if (body.note.length > 5000) throw new ApiError(422, "validation_error", "Ghi chú tối đa 5000 ký tự");
    note = body.note;
  }
  await updateContact(db, id, { kind, role, companyId, note });
  let tags = before.tags as string[];
  if (body.tags !== undefined) {
    tags = parseTags(Array.isArray(body.tags) ? body.tags.map(String).join(",") : String(body.tags));
    await setContactTags(db, id, tags);
  }
  const after = { kind_mode: kind === "auto" ? KIND_MODE_AUTO : String(kind), role, company_id: companyId ?? 0, note, tags };
  await recordAudit(db, { entity: "contact", entityId: id, action: "update", changedFields: diffFields(before, after, FIELD_LABELS) });
}

export const contactRoutes: ApiRoute[] = [
  ["GET", /^\/api\/contacts$/, async ({ response, url, service, principal }) => sendOk(response, await listContacts(service.db, url.searchParams, principal))],
  ["GET", /^\/api\/contacts\/(\d+)$/, async ({ response, match, service, principal }) => {
    const id = parseId(match[1]);
    await assertContactVisible(service.db, principal, { id });
    sendOk(response, await getContactDetail(service.db, id));
  }],
  ["PATCH", /^\/api\/contacts\/(\d+)$/, async ({ request, response, match, service, principal }) => {
    const id = parseId(match[1]);
    await assertContactVisible(service.db, principal, { id });
    await patchContact(service.db, id, await readJson(request));
    sendOk(response, await getContactDetail(service.db, id), "Đã lưu hồ sơ");
  }],
  ["GET", /^\/api\/contact-cards\/([A-Za-z0-9_-]{1,40})$/, async ({ response, match, service, principal }) => {
    await assertContactVisible(service.db, principal, { uid: match[1] });
    sendOk(response, await getContactCardByUid(service.db, match[1]));
  }],
];
