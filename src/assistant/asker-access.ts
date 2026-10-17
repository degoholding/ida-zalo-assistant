import type { RowDataPacket } from "mysql2";
import { loadUserPrincipal, type Principal } from "../auth/principal.js";
import { ContactRole, ConversationType, McpCallSource, UserRole } from "../constants.js";
import { sourceThreadVisibilitySql } from "../data-access/visibility-guards.js";
import { buildDataAccessContext, type DataAccessContext } from "../data-access/data-access-context.js";
import type { Db } from "../db/pool.js";
import { createLogger } from "../logger.js";
import { contactScopeSql } from "../web/api/scope.js";
import type { SqlPart } from "../web/api/list-query.js";

// Phase 6: người hỏi trợ lý → MỘT DataAccessContext cho cả lượt. Mọi công cụ đọc của trợ lý lọc qua `threadVisibilitySql` /
// `assert*Readable` của lõi truy cập dữ liệu với ngữ cảnh này (vá H1: không còn «người có vai trò đọc mọi cuộc riêng»).
//
// - Có tài khoản web (app_user.contact_id, đang bật, đúng MỘT dòng): principal của tài khoản (vai trò, phạm vi nhóm, cờ Mật).
// - Không có: principal SUY RA hạn chế — người có vai trò Danh bạ đọc mọi nhóm bot đang đọc; người chỉ là người nhận thì theo
//   recipient_group (quyết định 6); không Mật, không ghi qua lõi.
// - Mọi người hỏi: chỉ đọc cuộc nhắn riêng CỦA CHÍNH MÌNH (câu bot trả lời trong đó có thể chứa nội dung Mật — H2 / L7).
// - Hỏi trong nhóm: chỉ nhóm đó. Nhóm Mật chỉ mở khi người hỏi có tài khoản + cờ «Xem nhóm Mật» (quyết định 7).

const log = createLogger("assistant");

/** `disabled_account`: có tài khoản web gắn với liên hệ nhưng không còn dòng nào đang bật — KHÔNG suy quyền từ vai trò Danh bạ. */
export type AskerOrigin = "web_user" | "derived_role" | "derived_recipient" | "disabled_account";

/** Ngữ cảnh truy cập của lượt hỏi kèm nguồn gốc danh tính (để soát log + quyết định phạm vi Danh bạ). */
export interface AskerAccess extends DataAccessContext {
  origin: AskerOrigin;
}

export interface AskerContact {
  id: number;
  zalo_uid: string;
  role: number;
  display_name?: string;
  zalo_name?: string;
}

export interface ResolveAskerOptions {
  /** Hỏi trong nhóm: chỉ nhóm này. */
  groupScopeId?: number;
  maskPersonal: boolean;
  now?: Date;
  /**
   * Hỏi từ web «Hỏi trợ lý» (quản trị mô phỏng một người): giữ PHẠM VI NHÓM của người được chọn, nhưng Mật = cờ người được chọn VÀ cờ của
   * quản trị đang đăng nhập; không đọc cuộc nhắn riêng của người được chọn (ownDirectUid = null, bỏ cuộc riêng khỏi phạm vi).
   */
  webViewer?: { canViewConfidential: boolean };
  /** Tắt dòng log «lượt hỏi» (lần dò chỉ để kiểm cổng, không phải lượt hỏi thật). */
  quiet?: boolean;
}

/** Câu báo khi mô hình chạm dữ liệu nhóm Mật mà người hỏi chưa được cấp cờ. */
export const CONFIDENTIAL_ERROR = "Nhóm này để chế độ Mật — anh/chị chưa được cấp quyền xem nhóm Mật qua bot. Báo người hỏi xem trực tiếp trong nhóm, hoặc nhờ quản trị cấp quyền «Xem nhóm Mật».";

/** Bản sao cho phép Mật — chỉ để PHÂN BIỆT «bị Mật chặn» với «ngoài phạm vi» (vẫn trong phạm vi nhóm của người hỏi). */
export function relaxConfidential<T extends DataAccessContext>(access: T): T {
  return { ...access, includeConfidential: true };
}

/** Phạm vi Danh bạ: người có vai trò chưa có tài khoản thấy cả Danh bạ như trước; còn lại theo nhóm trong phạm vi. */
export function askerContactScope(access: AskerAccess): SqlPart | null {
  return access.origin === "derived_role" ? null : contactScopeSql(access.principal);
}

/**
 * Điều kiện «bản ghi gắn nhóm nguồn này người hỏi thấy được» cho việc / ticket của NGƯỜI KHÁC (LEFT JOIN zalo_group bí danh `groupAlias`).
 * Tài khoản web (và tài khoản đã tắt) đi qua luật nhóm + Mật của lõi truy cập dữ liệu; người chỉ suy từ vai trò / người nhận giữ phạm vi
 * «mọi nhóm» như trước nhưng KHÔNG thấy bản ghi của nhóm Mật.
 */
export function askerSourceVisibility(access: AskerAccess, threadColumn: string, groupAlias: string): SqlPart | undefined {
  if (access.origin === "web_user" || access.origin === "disabled_account") return sourceThreadVisibilitySql(access, threadColumn, groupAlias);
  return access.includeConfidential ? undefined : { sql: `(${groupAlias}.id IS NULL OR ${groupAlias}.is_confidential = 0)`, params: [] };
}

async function readableGroupIds(db: Db): Promise<number[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM zalo_group WHERE thread_type = ? AND read_messages = 1", [ConversationType.Group]);
  return rows.map((row) => Number(row.id));
}

/** Id các cuộc nhắn riêng của chính người hỏi (mỗi tài khoản bot một cuộc) — để người bị khoanh nhóm vẫn đọc được cuộc của mình. */
async function ownDirectThreadIdsOf(db: Db, uid: string): Promise<number[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM zalo_group WHERE thread_type = ? AND zalo_group_id = ?", [ConversationType.Direct, uid]);
  return rows.map((row) => Number(row.id));
}

/** Nhóm của người nhận (recipient) gắn với liên hệ; null = không phải người nhận đang bật. */
async function recipientGroupIds(db: Db, uid: string): Promise<number[] | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT r.id, r.all_groups FROM recipient r JOIN contact c ON c.id = r.contact_id WHERE c.zalo_uid = ? AND r.is_active = 1 LIMIT 1", [uid]);
  if (!rows[0]) return null;
  if (rows[0].all_groups) return readableGroupIds(db);
  const [groups] = await db.query<RowDataPacket[]>("SELECT group_id FROM recipient_group WHERE recipient_id = ?", [rows[0].id]);
  return groups.map((row) => Number(row.group_id));
}

type LinkedAccount = { kind: "none" } | { kind: "disabled" } | { kind: "active"; principal: Principal };

/** Gộp nhiều tài khoản cùng gắn một liên hệ: lấy PHẠM VI HẸP NHẤT (giao nhóm, Mật chỉ khi mọi tài khoản cho phép, vai trò thấp nhất). */
function narrowestPrincipal(principals: Principal[]): Principal {
  const [first, ...rest] = principals;
  let merged: Principal = { ...first };
  for (const next of rest) {
    const groupIds = merged.groupIds === null ? next.groupIds
      : next.groupIds === null ? merged.groupIds : merged.groupIds.filter((id) => next.groupIds!.includes(id));
    merged = {
      ...merged, groupIds, role: Math.max(merged.role, next.role) as UserRole,
      canViewConfidential: merged.canViewConfidential === true && next.canViewConfidential === true,
      canViewAudit: merged.canViewAudit === true && next.canViewAudit === true,
    };
  }
  return merged;
}

/**
 * Tài khoản web gắn với liên hệ. Không dòng nào = `none` (suy từ vai trò Danh bạ); có dòng nhưng không dòng nào đang bật = `disabled`
 * (không dữ liệu, không đặc quyền); nhiều dòng đang bật = log.warn + phạm vi hẹp nhất.
 */
async function linkedAccount(db: Db, contactId: number): Promise<LinkedAccount> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id, is_active FROM app_user WHERE contact_id = ? LIMIT 5", [contactId]);
  if (!rows.length) return { kind: "none" };
  const activeIds = rows.filter((row) => Number(row.is_active) === 1).map((row) => Number(row.id));
  if (!activeIds.length) return { kind: "disabled" };
  if (activeIds.length > 1) log.warn(`liên hệ #${contactId} gắn với ${activeIds.length} tài khoản đang bật (#${activeIds.join(", #")}) — dùng phạm vi hẹp nhất`);
  const principals = (await Promise.all(activeIds.map((id) => loadUserPrincipal(db, id)))).filter((item): item is Principal => item !== null);
  // Tài khoản vừa bị tắt giữa hai truy vấn: coi như đã tắt
  return principals.length ? { kind: "active", principal: narrowestPrincipal(principals) } : { kind: "disabled" };
}

/** Trạng thái tài khoản web gắn với liên hệ (theo mã Zalo): không có / có ít nhất một đang bật / có nhưng đã tắt hết. */
export async function linkedAccountStatus(db: Db, zaloUid: string): Promise<"none" | "active" | "disabled"> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total, COALESCE(SUM(u.is_active = 1), 0) AS active FROM app_user u JOIN contact c ON c.id = u.contact_id WHERE c.zalo_uid = ?", [zaloUid]);
  if (Number(rows[0]?.total ?? 0) === 0) return "none";
  return Number(rows[0]?.active ?? 0) > 0 ? "active" : "disabled";
}

/** Liên hệ có tài khoản web gắn nhưng không cái nào đang bật — không được hưởng đặc quyền suy từ vai trò / người nhận. */
export async function hasOnlyDisabledAccount(db: Db, zaloUid: string): Promise<boolean> {
  return (await linkedAccountStatus(db, zaloUid)) === "disabled";
}

function derivedPrincipal(contact: AskerContact, groupIds: number[]): Principal {
  const name = contact.display_name || contact.zalo_name || contact.zalo_uid;
  // Vai trò quyền đọc như Quản lý (giữ số liệu / Danh bạ như hôm nay); người chỉ là người nhận chỉ xem như Nhân viên
  const role = contact.role === ContactRole.None ? UserRole.Staff : UserRole.Manager;
  return { userId: null, tenantId: 1, fullName: name, email: "", role, groupIds, canViewConfidential: false };
}

/** Dựng ngữ cảnh truy cập của người hỏi — một truy vấn danh tính + 1–2 truy vấn danh sách nhóm mỗi lượt. */
export async function resolveAskerAccess(db: Db, contact: AskerContact, options: ResolveAskerOptions): Promise<AskerAccess> {
  const inGroup = options.groupScopeId !== undefined;
  // Mô phỏng từ web: không mang cuộc nhắn riêng của người được chọn vào phạm vi
  const ownDirectThreadIds = async (database: Db, uid: string) => (options.webViewer ? [] : await ownDirectThreadIdsOf(database, uid));
  let origin: AskerOrigin;
  const linked = await linkedAccount(db, contact.id);
  let principal: Principal;
  if (linked.kind === "active") {
    origin = "web_user";
    principal = linked.principal;
    if (!inGroup && principal.groupIds !== null) principal = { ...principal, groupIds: [...principal.groupIds, ...await ownDirectThreadIds(db, contact.zalo_uid)] };
  } else if (linked.kind === "disabled") {
    // Tài khoản đã tắt: không nhóm nào, không Mật; chỉ cuộc riêng của chính mình (kể cả khi hỏi trong nhóm)
    origin = "disabled_account";
    principal = derivedPrincipal({ ...contact, role: ContactRole.None }, inGroup ? [] : await ownDirectThreadIds(db, contact.zalo_uid));
  } else if (contact.role !== ContactRole.None) {
    origin = "derived_role";
    principal = derivedPrincipal(contact, inGroup ? [] : [...await readableGroupIds(db), ...await ownDirectThreadIds(db, contact.zalo_uid)]);
  } else {
    origin = "derived_recipient";
    const recipientGroups = inGroup ? [] : await recipientGroupIds(db, contact.zalo_uid) ?? [];
    principal = derivedPrincipal(contact, inGroup ? [] : [...recipientGroups, ...await ownDirectThreadIds(db, contact.zalo_uid)]);
  }
  // Hỏi trong nhóm: chỉ nhóm đó (thành viên nhóm vốn thấy nhóm) — kể cả người «mọi nhóm»; tài khoản đã tắt thì không
  if (inGroup && origin !== "disabled_account") principal = { ...principal, groupIds: [options.groupScopeId!] };
  if (options.webViewer) principal = { ...principal, canViewConfidential: principal.canViewConfidential === true && options.webViewer.canViewConfidential };
  const access = buildDataAccessContext({
    db, principal, allowWrite: false, maskPersonal: options.maskPersonal, source: McpCallSource.Assistant, now: options.now,
    ownDirectThreadsOnly: true, ownDirectUid: options.webViewer ? null : contact.zalo_uid,
  });
  if (!options.quiet) log.info(`lượt hỏi: người hỏi #${contact.id} · nguồn ${origin}${principal.userId ? ` · tài khoản #${principal.userId}` : ""} · Mật ${access.includeConfidential ? "bật" : "tắt"}`);
  return { ...access, origin };
}

/** Người hỏi này được dùng nhóm Mật `groupId` qua trợ lý không (cổng nhóm Mật của bộ trả lời trong nhóm). */
export async function mayAskInConfidentialGroup(db: Db, contact: AskerContact, groupId: number): Promise<boolean> {
  const access = await resolveAskerAccess(db, contact, { groupScopeId: groupId, maskPersonal: false, quiet: true });
  return access.includeConfidential;
}
