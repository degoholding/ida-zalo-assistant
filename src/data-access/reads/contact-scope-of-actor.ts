import type { SqlPart } from "../../web/api/list-query.js";
import { contactScopeSql } from "../../web/api/scope.js";
import type { DataAccessContext } from "../data-access-context.js";

/**
 * Phạm vi Danh bạ của người gọi (bí danh bảng `c`). Người có vai trò Danh bạ mà chưa có tài khoản web (`derived_role`) thấy cả Danh bạ như
 * trước; còn lại theo nhóm trong phạm vi (người bị khoanh nhóm chỉ thấy người ở nhóm của mình). Cổng HTTP không có `contactActor` nên luôn
 * theo phạm vi của principal. null = cả Danh bạ.
 */
export function contactScopeOf(ctx: DataAccessContext): SqlPart | null {
  return ctx.contactActor?.origin === "derived_role" ? null : contactScopeSql(ctx.principal);
}
