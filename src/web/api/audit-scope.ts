import { can, groupScopeSql, type Principal } from "../../auth/principal.js";
import { UserRole } from "../../constants.js";
import type { SqlPart } from "./list-query.js";
import { commandScopeWhere } from "./send-commands-api.js";
import { contactScopeSql } from "./scope.js";

// Phạm vi dòng của "Lịch sử thao tác" (bảng audit_log, alias `a`). Quyền xem nhật ký là quyền CẤP ĐƯỢC (`app_user.can_view_audit`),
// nên người không phải quản trị chỉ thấy dòng của bản ghi họ đang được phép xem: nhóm / tệp / việc / ticket trong phạm vi nhóm,
// Danh bạ ở ≥ 1 nhóm được gán, lệnh gửi của chính mình, mẫu tin / công ty (ai cũng đọc được), Danh mục / nguồn số liệu khi có
// quyền đọc, khóa MCP của chính mình. Người dùng / người nhận / cài đặt / tài khoản bot: chỉ quản trị.
// `includeConfidential` = false thì loại thêm dòng của bản ghi gắn nhóm Mật (đường AI / MCP; web người thật truyền true).

type Branch = { entity: string; visible?: SqlPart; confidential?: string };

const ALL: SqlPart = { sql: "1 = 1", params: [] };

function inGroups(principal: Principal, column: string): SqlPart | null {
  return groupScopeSql(principal, column);
}

function threadBranch(principal: Principal, entity: string, table: string, alias: string): Branch {
  const scope = inGroups(principal, `${alias}.source_thread_id`);
  return {
    entity,
    visible: scope ? { sql: `EXISTS (SELECT 1 FROM ${table} ${alias} WHERE ${alias}.id = a.entity_id AND ${scope.sql})`, params: scope.params } : undefined,
    confidential: `EXISTS (SELECT 1 FROM ${table} ${alias} JOIN zalo_group zg ON zg.id = ${alias}.source_thread_id WHERE ${alias}.id = a.entity_id AND zg.is_confidential = 1)`,
  };
}

function buildBranches(principal: Principal): Branch[] {
  const isAdmin = principal.role === UserRole.Admin;
  const groupScope = inGroups(principal, "a.entity_id");
  const fileScope = inGroups(principal, "at.group_id");
  const contactScope = contactScopeSql(principal);
  const command = commandScopeWhere(principal);
  const branches: Branch[] = [
    {
      entity: "group", visible: groupScope ?? undefined,
      confidential: "EXISTS (SELECT 1 FROM zalo_group zg WHERE zg.id = a.entity_id AND zg.is_confidential = 1)",
    },
    {
      entity: "file",
      visible: fileScope ? { sql: `EXISTS (SELECT 1 FROM attachment at WHERE at.id = a.entity_id AND ${fileScope.sql})`, params: fileScope.params } : undefined,
      confidential: "EXISTS (SELECT 1 FROM attachment at JOIN zalo_group zg ON zg.id = at.group_id WHERE at.id = a.entity_id AND zg.is_confidential = 1)",
    },
    {
      entity: "contact",
      visible: contactScope ? { sql: `EXISTS (SELECT 1 FROM contact c WHERE c.id = a.entity_id AND ${contactScope.sql})`, params: contactScope.params } : undefined,
    },
    threadBranch(principal, "task", "task", "t"),
    threadBranch(principal, "ticket", "ticket", "t"),
    {
      entity: "send_command",
      visible: { sql: `EXISTS (SELECT 1 FROM send_command c WHERE c.id = a.entity_id AND ${command.sql})`, params: command.params },
      confidential: "EXISTS (SELECT 1 FROM send_command_target tg JOIN zalo_group zg ON zg.id = tg.thread_id WHERE tg.command_id = a.entity_id AND zg.is_confidential = 1)",
    },
    { entity: "company" },
    { entity: "reply_template" },
  ];
  if (can(principal, "catalog", "read")) branches.push({ entity: "catalog" });
  if (can(principal, "metric", "read")) branches.push({ entity: "metric_source" });
  if (isAdmin) {
    for (const entity of ["user", "recipient", "setting", "bot_account", "mcp_key"]) branches.push({ entity });
  } else {
    branches.push({
      entity: "mcp_key",
      visible: { sql: "EXISTS (SELECT 1 FROM mcp_api_key k WHERE k.id = a.entity_id AND k.user_id = ?)", params: [principal.userId ?? 0] },
    });
  }
  return branches;
}

/**
 * Điều kiện SQL (không có chữ WHERE) giới hạn dòng audit_log người này được xem; null = không giới hạn (quản trị + Mật bật).
 * Mỗi nhánh là `(a.entity = ? AND <điều kiện thấy> AND NOT <thuộc nhóm Mật>)`, ghép bằng OR; mọi EXISTS đều tham số hóa.
 */
export function auditScopeSql(principal: Principal, includeConfidential: boolean): SqlPart | null {
  if (principal.role === UserRole.Admin && includeConfidential) return null;
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const branch of buildBranches(principal)) {
    const visible = branch.visible ?? ALL;
    const hidden = !includeConfidential && branch.confidential ? ` AND NOT ${branch.confidential}` : "";
    parts.push(`(a.entity = ? AND ${visible.sql}${hidden})`);
    params.push(branch.entity, ...visible.params);
  }
  return { sql: parts.join(" OR "), params };
}
