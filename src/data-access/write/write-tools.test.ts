import assert from "node:assert/strict";
import { test } from "node:test";
import { McpCallSource } from "../../constants.js";
import { admin, fakeDb, makeCtx, manager, staff } from "../data-access-test-support.js";
import { toolsFor } from "../read-tool-catalog.js";
import { runTool } from "../tool-runner.js";
import { WRITE_ACTIONS, WRITE_TOOLS } from "./write-tool-catalog.js";

// Công cụ ghi không cần DB thật: danh sách theo quyền / khóa, sơ đồ chặn trường cấm, các cổng của confirm_write dừng TRƯỚC khi chạm dữ liệu.

const names = (ctxOptions: Parameters<typeof makeCtx>) => toolsFor(makeCtx(...ctxOptions)).map((tool) => tool.name).filter((name) => /^propose_|^confirm_write$/.test(name));
const write = { allowWrite: true };

test("khóa chỉ đọc: không công cụ ghi nào, kể cả quản trị", () => {
  assert.deepEqual(names([admin()]), []);
  assert.deepEqual(names([manager()]), []);
});

test("khóa đọc+ghi: Quản lý đủ 6 propose + confirm_write; Nhân viên KHÔNG có công cụ ghi nào (D3, kể cả mẫu tin)", () => {
  assert.equal(WRITE_TOOLS.length, 7);
  // `WRITE_ACTIONS` còn gồm thao tác QUAN HỆ chỉ để «đồng ý» tra nháp (D-A) — không có công cụ propose_* ở cổng ngoài
  const proposable = [...WRITE_ACTIONS.values()].filter((action) => action.permission !== "relationship").map((action) => action.tool);
  assert.deepEqual(names([manager(), write]).sort(), [...proposable, "confirm_write"].sort());
  assert.deepEqual([...WRITE_ACTIONS.values()].filter((action) => action.permission === "relationship").map((action) => action.tool).sort(),
    ["alert_item_handled", "task_relationship_update", "ticket_relationship_update"]);
  assert.deepEqual(names([staff(), write]), []);
});

test("confirm_write chỉ có ở cổng MCP; trợ lý không có (D1) và gọi thẳng cũng bị từ chối", async () => {
  const assistant = makeCtx(manager(), { allowWrite: true, source: McpCallSource.Assistant, keyId: null });
  assert.deepEqual(toolsFor(assistant).map((tool) => tool.name).filter((name) => name === "confirm_write"), []);
  const { db, queries } = fakeDb();
  const result = await runTool(WRITE_TOOLS.find((tool) => tool.name === "confirm_write")!, { ...assistant, db }, { code: "K7Q2MX" });
  assert.equal(result.errorCode, "forbidden");
  assert.equal(queries.length, 0, "không chạm DB");
});

test("principal suy ra (không tài khoản web, userId null) không có công cụ ghi dù allowWrite", () => {
  assert.deepEqual(names([manager({ userId: null }), write]), []);
});

test("annotations: propose_* không destructive; confirm_write destructiveHint", () => {
  for (const tool of WRITE_TOOLS) {
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.equal(tool.annotations.destructiveHint, tool.name === "confirm_write", tool.name);
  }
});

const run = (name: string, args: unknown, ctx = makeCtx(manager(), write)) => runTool(WRITE_TOOLS.find((tool) => tool.name === name)!, ctx, args);

test("propose_contact_update: role / phone không có trong sơ đồ → invalid_value (H2: AI không bao giờ đổi vai trò)", async () => {
  for (const extra of [{ role: 2 }, { phone: "0912345678" }]) {
    const result = await run("propose_contact_update", { contact_id: 5, note: "x", ...extra });
    assert.equal(result.isError, true);
    assert.equal(result.errorCode, "invalid_value");
  }
  assert.equal((await run("propose_contact_update", { contact_id: 5 })).errorCode, "invalid_value", "không trường nào để sửa");
});

test("propose_group_update: cờ đọc tin / lấy tệp / Mật / lưu giữ bị chặn bởi sơ đồ", async () => {
  for (const extra of [{ read_messages: true }, { capture_files: true }, { is_confidential: false }, { retention_days: 1 }, { group_kind: 1 }]) {
    const result = await run("propose_group_update", { group_id: 3, label: "x", ...extra });
    assert.equal(result.errorCode, "invalid_value", JSON.stringify(extra));
  }
});

test("propose_task_update: thiếu trường bắt buộc theo action → invalid_value", async () => {
  assert.equal((await run("propose_task_update", { task_id: 1, action: "reschedule" })).errorCode, "invalid_value");
  assert.equal((await run("propose_task_update", { task_id: 1, action: "reassign" })).errorCode, "invalid_value");
  assert.equal((await run("propose_task_update", { task_id: 1, action: "note" })).errorCode, "invalid_value");
  assert.equal((await run("propose_ticket_action", { ticket_id: 1, action: "note" })).errorCode, "invalid_value");
});

test("công cụ ghi bị chặn khi ctx không allowWrite (kể cả gọi thẳng tên)", async () => {
  const result = await run("propose_reply_template_save", { title: "Mẫu thử", body: "Nội dung mẫu đủ dài", tone: 1 }, makeCtx(admin()));
  assert.equal(result.errorCode, "forbidden");
  assert.equal((await run("confirm_write", { code: "K7Q2MX" }, makeCtx(admin()))).errorCode, "forbidden");
});

test("confirm_write: mã không có nháp → invalid_code (một thông báo chung)", async () => {
  const result = await run("confirm_write", { code: "K7Q2MX" });
  assert.equal(result.errorCode, "invalid_code");
});

// H2: bật che dữ liệu cá nhân thì mô hình chỉ thấy «[SĐT ***678]» — chép nó vào nội dung ghi sẽ phá dữ liệu thật ⇒ từ chối TRƯỚC khi chạm DB
test("H2: bật che dữ liệu cá nhân → nội dung ghi chứa chữ che bị từ chối (ghi chú, tiêu đề việc, mẫu tin, tên gọi nhóm, ghi chú ticket)", async () => {
  const masked = makeCtx(manager(), { allowWrite: true, maskPersonal: true });
  const cases: [string, unknown][] = [
    ["propose_contact_update", { contact_id: 5, note: "Gọi anh Sáu [SĐT ***678] chiều nay" }],
    ["propose_contact_update", { contact_id: 5, note_append: "STK [STK ***321]" }],
    ["propose_contact_update", { contact_id: 5, tags: ["[CCCD ***999]"] }],
    ["propose_task_create", { title: "Gọi [SĐT ***678] báo giá" }],
    ["propose_task_update", { task_id: 1, action: "note", note: "số [SĐT ***678]" }],
    ["propose_ticket_action", { ticket_id: 1, action: "note", note: "gọi [SĐT ***678]" }],
    ["propose_group_update", { group_id: 3, label: "Nhóm [SĐT ***678]" }],
    ["propose_reply_template_save", { title: "Mẫu thử", body: "Liên hệ [SĐT ***678] để được hỗ trợ", tone: 1 }],
  ];
  for (const [name, args] of cases) {
    const result = await run(name, args, masked);
    assert.equal(result.errorCode, "invalid_value", `${name} ${JSON.stringify(args)}`);
    assert.match(result.text, /đã che dữ liệu cá nhân/);
  }
});

test("H2: tắt che dữ liệu cá nhân thì chữ «[SĐT ***678]» không bị coi là chữ che (không chặn oan)", async () => {
  const { db } = fakeDb();
  const plain = makeCtx(manager(), { allowWrite: true, maskPersonal: false }, db);
  const result = await run("propose_task_create", { title: "Gọi [SĐT ***678] báo giá" }, plain);
  assert.equal(result.isError, false, result.text);
});

// D2: loại danh bạ (kind) không ghi được qua AI
test("D2: propose_contact_update không nhận kind (strict) — kể cả kind hợp lệ", async () => {
  for (const kind of [0, 1, 2]) assert.equal((await run("propose_contact_update", { contact_id: 5, kind, note: "x" })).errorCode, "invalid_value");
  assert.equal((await run("propose_contact_update", { contact_id: 5, note: "x", note_append: "y" })).errorCode, "invalid_value", "note và note_append loại trừ nhau");
});
