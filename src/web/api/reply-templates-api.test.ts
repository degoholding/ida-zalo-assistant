import assert from "node:assert/strict";
import { test } from "node:test";
import type { Principal } from "../../auth/principal.js";
import { ReplyTemplateStatus, UserRole } from "../../constants.js";
import { ReplyTemplateError } from "../../reply-suggestions/reply-template-workflow.js";
import { ApiError } from "./api-http.js";
import { buildTemplateBaseWhere, buildTemplateFlags, mapWorkflowError, REPLY_TEMPLATE_LIST_SPEC } from "./reply-templates-api.js";
import { requiredPermission } from "./route-permissions.js";

const principal = (role: UserRole, userId: number | null = 7): Principal => ({ userId, tenantId: 1, fullName: "A", email: "", role, groupIds: null });

test("ListSpec: đủ cột lọc / sắp xếp / tìm theo plan", () => {
  for (const key of ["status", "tone", "author_user_id", "reviewer_user_id", "updated_at"]) assert.ok(REPLY_TEMPLATE_LIST_SPEC.fields[key], key);
  for (const key of ["updated_at", "name", "status"]) assert.ok(REPLY_TEMPLATE_LIST_SPEC.sorts[key], key);
  assert.deepEqual(REPLY_TEMPLATE_LIST_SPEC.search?.columns, ["r.name", "r.situation", "r.keywords", "r.body"]);
});

test("buildTemplateBaseWhere: ẩn Ngừng dùng trừ khi lọc trạng thái rõ", () => {
  const hidden = buildTemplateBaseWhere(principal(UserRole.Staff), new URLSearchParams());
  assert.deepEqual(hidden.params, [1, ReplyTemplateStatus.Archived]);
  const shown = buildTemplateBaseWhere(principal(UserRole.Staff), new URLSearchParams("status=5"));
  assert.deepEqual(shown, { sql: "r.tenant_id = ?", params: [1] });
});

test("buildTemplateFlags: nhân viên chỉ sửa mẫu của mình, không duyệt; quản lý sửa + duyệt mọi mẫu; mẫu gieo (không tác giả) chỉ người duyệt", () => {
  assert.deepEqual(buildTemplateFlags(principal(UserRole.Staff, 7), 7), { can_edit: true, can_review: false });
  assert.deepEqual(buildTemplateFlags(principal(UserRole.Staff, 7), 8), { can_edit: false, can_review: false });
  assert.deepEqual(buildTemplateFlags(principal(UserRole.Staff, 7), null), { can_edit: false, can_review: false });
  assert.deepEqual(buildTemplateFlags(principal(UserRole.Manager, 9), null), { can_edit: true, can_review: true });
  assert.deepEqual(buildTemplateFlags(principal(UserRole.Admin, 1), 8), { can_edit: true, can_review: true });
});

test("mapWorkflowError: đổi mã lỗi workflow sang 422 / 403 / 404 / 409, lỗi lạ ném nguyên", async () => {
  const cases = [["validation", 422], ["forbidden", 403], ["not_found", 404], ["conflict", 409]] as const;
  for (const [code, status] of cases) {
    await assert.rejects(mapWorkflowError(() => Promise.reject(new ReplyTemplateError(code, "x"))), (error: unknown) => error instanceof ApiError && error.status === status);
  }
  await assert.rejects(mapWorkflowError(() => Promise.reject(new Error("boom"))), /boom/);
  assert.equal(await mapWorkflowError(() => Promise.resolve(5)), 5);
});

test("quyền route: xem = read, ghi (tạo / sửa / hành động) = write", () => {
  assert.deepEqual(requiredPermission("GET", "/api/reply-templates"), { entity: "reply_template", action: "read" });
  for (const [method, path] of [["POST", "/api/reply-templates"], ["PATCH", "/api/reply-templates/3"], ["POST", "/api/reply-templates/3/actions"]] as const) {
    assert.deepEqual(requiredPermission(method, path), { entity: "reply_template", action: "write" }, `${method} ${path}`);
  }
});
