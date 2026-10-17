import { z } from "zod/v4";
import { UserRole, McpCallSource } from "../../constants.js";
import { readableEntities } from "../entity-registry.js";
import type { ToolDefinition } from "../tool-definition.js";

// whoami: người đang gọi là ai, thấy được gì — để mô hình biết phạm vi trước khi hỏi dữ liệu.

const ROLE_LABELS: Record<number, string> = { [UserRole.Admin]: "Quản trị", [UserRole.Manager]: "Quản lý", [UserRole.Staff]: "Nhân viên" };

const inputSchema = z.object({});
const outputSchema = z.object({
  user: z.object({ id: z.number().nullable(), name: z.string(), email: z.string(), role: z.number(), role_label: z.string() }),
  scope: z.object({ all_groups: z.boolean(), group_count: z.number().nullable() }),
  access_level: z.enum(["read", "read_write"]),
  confidential_included: z.boolean(),
  mask_personal: z.boolean(),
  can_view_audit: z.boolean(),
  entities: z.array(z.string()),
  via: z.enum(["mcp", "assistant"]),
  notices: z.array(z.string()),
});
type WhoamiOutput = z.infer<typeof outputSchema>;

export const whoamiTool: ToolDefinition<z.infer<typeof inputSchema>, WhoamiOutput> = {
  name: "whoami",
  title: "Tôi là ai",
  description: "Cho biết tài khoản đang dùng (vai trò, phạm vi nhóm), mức khóa (đọc / đọc+ghi), có được xem nhóm Mật không, và các thực thể đọc được.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  available: () => true,
  async handler(ctx) {
    const { principal } = ctx;
    const scope = principal.groupIds === null ? { all_groups: true, group_count: null } : { all_groups: false, group_count: principal.groupIds.length };
    const structured: WhoamiOutput = {
      user: { id: principal.userId, name: principal.fullName, email: principal.email, role: principal.role, role_label: ROLE_LABELS[principal.role] ?? "Không rõ" },
      scope,
      access_level: ctx.allowWrite ? "read_write" : "read",
      confidential_included: ctx.includeConfidential,
      mask_personal: ctx.maskPersonal,
      can_view_audit: principal.canViewAudit === true || principal.role === UserRole.Admin,
      entities: readableEntities(ctx).map((def) => def.name),
      via: ctx.source === McpCallSource.Assistant ? "assistant" : "mcp",
      notices: [],
    };
    const where = scope.all_groups ? "mọi nhóm" : `${scope.group_count} nhóm được gán`;
    return { structured, summary: `${principal.fullName} — ${structured.user.role_label}, phạm vi ${where}.`, rowCount: 1 };
  },
};
