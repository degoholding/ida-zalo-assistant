import assert from "node:assert/strict";
import { test } from "node:test";
import { admin, makeCtx, manager, staff } from "./data-access-test-support.js";
import { SAFE_KEY, permittedColumns } from "./entity-definition.js";
import { ENTITY_DEFINITIONS, findEntity, readableEntities } from "./entity-registry.js";
import { listFilterFields } from "./filter-fields.js";
import { compileQuery } from "./query-compiler.js";

const adminCtx = makeCtx(admin());
const managerCtx = makeCtx(manager());
const staffCtx = makeCtx(staff());
const names = (ctx: ReturnType<typeof makeCtx>) => readableEntities(ctx).map((def) => def.name);

test("13 thực thể, tên duy nhất, không có bảng bí mật / nội bộ", () => {
  const all = ENTITY_DEFINITIONS.map((def) => def.name);
  assert.deepEqual(all, ["groups", "conversations", "messages", "contacts", "files", "links", "tasks", "tickets", "send_commands", "reply_templates", "metrics", "catalog", "audit_log"]);
  assert.equal(new Set(all).size, all.length);
  for (const banned of ["app_user", "users", "web_session", "app_setting", "settings", "ai_key", "bot_account", "recipients", "mcp_api_key", "mcp_call_log", "job", "assistant_turn", "brief_log"]) {
    assert.equal(findEntity(banned), undefined, banned);
  }
  assert.equal(findEntity("__proto__"), undefined);
  assert.equal(findEntity("constructor"), undefined);
});

test("quyền đọc theo vai trò: Quản trị đủ 13; Quản lý bỏ audit_log; Nhân viên bỏ metrics / catalog / audit_log", () => {
  assert.equal(names(adminCtx).length, 13);
  assert.deepEqual(names(managerCtx), ["groups", "conversations", "messages", "contacts", "files", "links", "tasks", "tickets", "send_commands", "reply_templates", "metrics", "catalog"]);
  assert.deepEqual(names(staffCtx), ["groups", "conversations", "messages", "contacts", "files", "links", "tasks", "tickets", "send_commands", "reply_templates"]);
});

test("audit_log chỉ hiện với quản trị hoặc người được cấp cờ xem nhật ký", () => {
  assert.ok(!names(makeCtx(staff())).includes("audit_log"));
  assert.ok(names(makeCtx(staff({ canViewAudit: true }))).includes("audit_log"));
  assert.ok(names(makeCtx(manager({ canViewAudit: true }))).includes("audit_log"));
  assert.ok(names(adminCtx).includes("audit_log"));
});

test("khóa cột / khóa lọc / khóa sắp xếp an toàn để ghép làm bí danh; mặc định + gộp nhóm đều là cột có thật", () => {
  for (const def of ENTITY_DEFINITIONS) {
    const columns = Object.keys(def.columns);
    for (const key of columns) {
      assert.match(key, SAFE_KEY, `${def.name}.${key}`);
      assert.doesNotMatch(def.columns[key].sql, /;|--|\/\*/, `${def.name}.${key}`);
    }
    for (const key of def.defaultFields) assert.ok(columns.includes(key), `${def.name} mặc định ${key}`);
    for (const key of [...(def.aggregate?.groupBy ?? []), ...(def.aggregate?.sum ?? [])]) assert.ok(columns.includes(key), `${def.name} gộp ${key}`);
    for (const key of def.requiredFilter?.anyOf ?? []) assert.ok(key in def.spec(adminCtx).fields, `${def.name} bắt buộc ${key}`);
    for (const ctx of [adminCtx, managerCtx, staffCtx]) {
      for (const key of Object.keys(listFilterFields(def, ctx))) assert.match(key, SAFE_KEY, `${def.name} lọc ${key}`);
      for (const key of Object.keys(def.spec(ctx).sorts)) assert.match(key, SAFE_KEY, `${def.name} sắp ${key}`);
    }
  }
});

// Spec của web đổi tên trường thì hợp đồng MCP đổi theo — cố ý để test này đỏ để người sửa biết và cập nhật có chủ đích.
test("chụp danh sách trường lọc từng thực thể (đổi ListSpec web là test đỏ)", () => {
  const snapshot = Object.fromEntries(ENTITY_DEFINITIONS.map((def) => [def.name, Object.keys(listFilterFields(def, managerCtx)).sort()]));
  assert.deepEqual(snapshot, {
    groups: ["account_id", "capture_files", "company_id", "file_retention_days", "group_kind", "has_bot", "is_confidential", "label", "last_message_at", "member_count", "message_count", "name", "read_messages", "retention_days", "zalo_group_id"],
    conversations: ["account_id", "company_id", "name", "thread_type"],
    messages: ["account_id", "kind", "sender_name", "sender_uid", "sent_at", "text", "thread_id", "thread_type"],
    contacts: ["catalog_kind", "company_id", "direct", "display_name", "dm_count", "first_seen_at", "group_id", "kind", "kind_source", "last_dm_at", "note", "phone", "region", "role", "sales_zone", "tag", "zalo_uid"],
    files: ["account_id", "file_ext", "file_name", "group_id", "has_text", "sender_name", "sender_uid", "sent_at", "size", "status", "thread_type"],
    links: ["account_id", "group_id", "host", "kind", "sender_name", "sender_uid", "sent_at", "thread_type", "title", "url"],
    tasks: ["assignee_contact_id", "due_at", "missing_assignee", "missing_due", "overdue", "priority", "source", "source_thread_id", "status"],
    tickets: ["created_at", "handler_name", "requester_name", "status"],
    send_commands: ["action_kind", "created_at", "reminder_at", "requester_uid", "scheduled_at", "source", "status"],
    reply_templates: ["author_user_id", "reviewer_user_id", "status", "tone", "updated_at"],
    metrics: ["area_key", "catalog_entry_id", "flags", "metric_code", "metric_date", "source_id"],
    catalog: ["is_active", "kind", "match_status", "owner_entry_id", "region", "sales_zone"],
    audit_log: ["action", "actor", "created_at", "entity", "entity_id"],
  });
  // Nhân viên không có `phone` ở Danh bạ
  assert.ok(!Object.keys(listFilterFields(findEntity("contacts")!, staffCtx)).includes("phone"));
});

test("cột cần quyền riêng: phone của Danh bạ chỉ khi có catalog.read", () => {
  const contacts = findEntity("contacts")!;
  assert.ok(!permittedColumns(contacts, staffCtx).includes("phone"));
  assert.ok(permittedColumns(contacts, managerCtx).includes("phone"));
  assert.ok(permittedColumns(contacts, adminCtx).includes("phone"));
});

test("ctx không Mật → mọi thực thể gắn nhóm có điều kiện is_confidential = 0; có Mật → không còn", () => {
  const tied = ["groups", "conversations", "messages", "files", "links", "tasks", "tickets", "send_commands", "audit_log"];
  const noMat = makeCtx(admin({ canViewAudit: true }));
  const mat = makeCtx(admin({ canViewConfidential: true }));
  for (const name of tied) {
    const def = findEntity(name)!;
    assert.match(def.baseWhere(noMat)?.sql ?? "", /is_confidential = 0|is_confidential = 1/, `${name} không Mật`);
    // audit_log của quản trị + Mật không có điều kiện nào; các thực thể khác không còn điều kiện Mật
    assert.doesNotMatch(def.baseWhere(mat)?.sql ?? "", /is_confidential = [01]/, `${name} có Mật`);
  }
  // Danh bạ / danh mục / mẫu tin / số liệu không gắn nhóm Mật
  for (const name of ["contacts", "catalog", "reply_templates", "metrics"]) assert.doesNotMatch(findEntity(name)!.baseWhere(noMat)?.sql ?? "", /is_confidential/);
});

test("mọi thực thể biên dịch được truy vấn mặc định + sắp xếp từng khóa (alias khớp spec) cho vai trò đọc được", () => {
  for (const ctx of [adminCtx, managerCtx, staffCtx]) {
    for (const def of readableEntities(ctx)) {
      const filters = def.requiredFilter ? [{ field: "thread_id", op: "eq" as const, value: 1 }] : [];
      compileQuery(def, ctx, { entity: def.name, filters });
      for (const key of Object.keys(def.spec(ctx).sorts)) compileQuery(def, ctx, { entity: def.name, filters, sort: { field: key } });
    }
  }
});
