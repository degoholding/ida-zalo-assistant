import type { RowDataPacket } from "mysql2";
import { ContactRole } from "../../constants.js";
import { actorFactMemo } from "../actors/contact-actor.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";

// Sự thật «người hỏi có dùng được công cụ cảnh báo không, và là người nhận nào» (phase 10) — chép đúng `resolveAlertAsker` cũ nhưng hỏi qua chủ thể
// liên hệ Zalo (`ctx.contactActor`) và nhớ trong lượt. Chỉ tin RIÊNG (hỏi trong nhóm không có công cụ cảnh báo); tài khoản web đã tắt hết thì không
// suy đặc quyền từ vai trò / người nhận.

export interface AlertAsker {
  uid: string;
  name: string;
  role: ContactRole;
  /** id người nhận nếu người hỏi là người nhận đang bật */
  recipientId: number | null;
  /**
   * Đổi được cấu hình CHUNG (từ khóa, số phút chờ): vai trò Danh bạ Quản lý / Trưởng phòng VÀ (D-B) — nếu có tài khoản web đang bật — tài khoản đó là Quản trị /
   * Quản lý. `roleDeniedByWeb` = vai trò Danh bạ đủ nhưng tài khoản web chỉ là Nhân viên (để câu từ chối nói đúng lý do).
   */
  mayChangeGlobal: boolean;
  roleDeniedByWeb: boolean;
}

/** Cài đặt cảnh báo đang chạy (từ `AppConfig.alerts` + giờ làm việc) — lõi không có `config`, nên nơi dựng ngữ cảnh đưa vào. */
export interface AlertSettingsSnapshot {
  enabled: boolean;
  aiEnabled: boolean;
  urgentKeywords: string;
  importantKeywords: string;
  strictKeywords: string;
  replyWaitMinutes: number;
  vipWaitMinutes: number;
  dailyReminderCap: number;
  urgentMergeSeconds: number;
  workHours: string;
  quietHours: string;
}

/** Móc chạy của họ `alerts`: đọc cài đặt đang hiệu lực + báo dịch vụ cảnh báo nạp lại người nhận / VIP. */
export interface AlertRuntime {
  settings(): AlertSettingsSnapshot;
  invalidate(): void;
}

/** Thiếu `alertRuntime` trên ngữ cảnh ⇒ công cụ của họ tự ẩn và trợ lý chạy đường cũ. */
export const alertRuntimeOf = (ctx: DataAccessContext): AlertRuntime | undefined => ctx.alertRuntime;

export const ALERT_ASKER_REQUIRED = "Công cụ cảnh báo chỉ dành cho quản lý / người nhận báo, trong tin riêng.";

/** Công cụ ĐỌC / ghi tin cần xử lý lên danh sách khi: có chủ thể Zalo, hỏi ở tin riêng, tài khoản không bị tắt, nơi dựng ctx đã bật họ (`alertRuntime`). */
export function alertToolsAvailable(ctx: DataAccessContext): boolean {
  const actor = ctx.contactActor;
  // `ownDirectUid` rỗng = «Hỏi trợ lý» mô phỏng từ web (L5): không công cụ cảnh báo, không nháp cấu hình / «xong tin» gắn vào người được mô phỏng
  return Boolean(actor && actor.groupId === null && actor.origin !== "disabled_account" && ctx.ownDirectUid === actor.uid && alertRuntimeOf(ctx));
}

/** Công cụ ĐỔI cấu hình cần thêm khả năng lưu cài đặt (`ctx.saveSettings`). */
export const alertConfigAvailable = (ctx: DataAccessContext): boolean => alertToolsAvailable(ctx) && ctx.saveSettings !== undefined;

/** Người hỏi cảnh báo của lượt; null = không dùng được (không vai trò và không là người nhận, tài khoản tắt, hỏi trong nhóm). */
export function alertAskerOf(ctx: DataAccessContext): Promise<AlertAsker | null> {
  const actor = ctx.contactActor;
  if (!actor || actor.groupId !== null || actor.origin === "disabled_account") return Promise.resolve(null);
  return actorFactMemo(ctx, "alert_asker", async () => {
    const [rows] = await ctx.db.query<RowDataPacket[]>(
      "SELECT r.id FROM recipient r JOIN contact c ON c.id = r.contact_id WHERE c.zalo_uid = ? AND r.is_active = 1 LIMIT 1", [actor.uid]);
    const recipientId = rows[0] ? Number(rows[0].id) : null;
    const role = Number(actor.contactRole) as ContactRole;
    if (role === ContactRole.None && !recipientId) return null;
    const contactRoleOk = role === ContactRole.Manager || role === ContactRole.DepartmentHead;
    const webRoleOk = await actor.facts.webRoleAllowsOversight();
    return { uid: actor.uid, name: actor.name, role, recipientId, mayChangeGlobal: contactRoleOk && webRoleOk, roleDeniedByWeb: contactRoleOk && !webRoleOk };
  });
}

/** Người hỏi cảnh báo, hoặc `forbidden` (câu cũ). */
export async function requireAlertAsker(ctx: DataAccessContext): Promise<AlertAsker> {
  const asker = await alertAskerOf(ctx);
  if (!asker) throw new DataAccessError("forbidden", ALERT_ASKER_REQUIRED);
  return asker;
}

/** Nhóm người nhận được gán (màn Người nhận); null = mọi nhóm (người không phải người nhận, hoặc người nhận «tất cả nhóm»). */
export async function askerGroupIds(ctx: DataAccessContext, asker: AlertAsker): Promise<number[] | null> {
  if (!asker.recipientId) return null;
  const [rows] = await ctx.db.query<RowDataPacket[]>("SELECT all_groups FROM recipient WHERE id = ?", [asker.recipientId]);
  if (rows[0]?.all_groups) return null;
  const [groups] = await ctx.db.query<RowDataPacket[]>("SELECT group_id FROM recipient_group WHERE recipient_id = ?", [asker.recipientId]);
  return groups.map((row) => Number(row.group_id));
}

export const canChangeGlobal = (asker: AlertAsker): boolean => asker.mayChangeGlobal;

/** Câu từ chối đổi cấu hình chung: nói đúng lý do (vai trò Danh bạ, hay tài khoản web chỉ là Nhân viên — D-B). */
export const globalChangeDeniedMessage = (asker: AlertAsker, what: string): string =>
  asker.roleDeniedByWeb
    ? `Đổi ${what} áp dụng cho cả công ty — tài khoản web của anh/chị cần vai trò Quản trị / Quản lý.`
    : `Đổi ${what} áp dụng cho cả công ty — cần vai trò Quản lý / Trưởng phòng.`;
