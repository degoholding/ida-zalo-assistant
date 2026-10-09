import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./api-http.js";
import { buildDueAtCondition, parseTaskDueInput, TASK_LIST_SPEC } from "./tasks-api.js";

const NOW = new Date("2026-10-09T10:00:00+07:00");

test("buildDueAtCondition: đúng ngày / ≤ / < / trong khoảng lấy trọn ngày theo giờ Việt Nam, rác thì bỏ lọc", () => {
  const start = new Date("2026-10-04T17:00:00Z");
  const next = new Date("2026-10-05T17:00:00Z");
  assert.deepEqual(buildDueAtCondition("eq", ["2026-10-05"]), { sql: "(t.due_at >= ? AND t.due_at < ?)", params: [start, next] });
  assert.deepEqual(buildDueAtCondition("lte", ["2026-10-05"]), { sql: "t.due_at < ?", params: [next] });
  assert.deepEqual(buildDueAtCondition("gt", ["2026-10-05"]), { sql: "t.due_at >= ?", params: [next] });
  assert.deepEqual(buildDueAtCondition("between", ["2026-10-01", "2026-10-05"]),
    { sql: "(t.due_at >= ? AND t.due_at < ?)", params: [new Date("2026-09-30T17:00:00Z"), next] });
  assert.equal(buildDueAtCondition("between", ["2026-10-01"]), null);
  assert.equal(buildDueAtCondition("eq", ["rác"]), null);
  assert.equal(buildDueAtCondition("isnull", ["1"]), null);
});

test("ListSpec overdue: eq=1 lọc đúng trạng thái Đang làm + hạn đã qua; ne / eq=0 đảo lại; giá trị lạ bỏ lọc", () => {
  const field = TASK_LIST_SPEC.fields.overdue;
  const eqTrue = field.build!("eq", ["1"]);
  assert.match(eqTrue!.sql, /^\(t\.status = \? AND t\.due_at IS NOT NULL/);
  assert.equal(eqTrue!.params[0], 2 /* TaskStatus.Open */);
  assert.ok(eqTrue!.params[1] instanceof Date);

  const eqFalse = field.build!("eq", ["0"]);
  assert.match(eqFalse!.sql, /^NOT \(/);

  const ne = field.build!("ne", ["1"]);
  assert.match(ne!.sql, /^NOT \(/);

  assert.equal(field.build!("gt", ["1"]), null);
});

test("ListSpec missing_assignee / missing_due: không tham số, đảo đúng theo eq/ne, giá trị rỗng = false", () => {
  const assigneeField = TASK_LIST_SPEC.fields.missing_assignee;
  const dueField = TASK_LIST_SPEC.fields.missing_due;

  const missingTrue = assigneeField.build!("eq", ["1"]);
  assert.deepEqual(missingTrue, { sql: "(t.assignee_contact_id IS NULL AND (t.assignee_uid IS NULL OR t.assignee_uid = '') AND (t.assignee_name IS NULL OR t.assignee_name = ''))", params: [] });

  const missingFalse = assigneeField.build!("eq", ["0"]);
  assert.equal(missingFalse!.sql.startsWith("NOT ("), true);

  const dueMissing = dueField.build!("eq", ["true"]);
  assert.deepEqual(dueMissing, { sql: "(t.due_at IS NULL)", params: [] });

  assert.equal(assigneeField.build!("in", ["1"]), null);
});

test("parseTaskDueInput: cả hai trống → null; chỉ ngày → 00:00 giờ VN, không giờ; ngày + giờ → đúng mốc, có giờ", () => {
  assert.equal(parseTaskDueInput(undefined, undefined, NOW), null);
  assert.equal(parseTaskDueInput("", "", NOW), null);

  const dateOnly = parseTaskDueInput("2026-10-18", undefined, NOW);
  assert.deepEqual(dateOnly, { at: new Date("2026-10-17T17:00:00.000Z"), hasTime: false });

  const dateTime = parseTaskDueInput("2026-10-18", "17:30", NOW);
  assert.deepEqual(dateTime, { at: new Date("2026-10-18T10:30:00.000Z"), hasTime: true });
});

test("parseTaskDueInput: biên giờ hợp lệ 00:00 và 23:59; biên ngoài khoảng bị chặn", () => {
  assert.deepEqual(parseTaskDueInput("2026-10-18", "00:00", NOW), { at: new Date("2026-10-17T17:00:00.000Z"), hasTime: true });
  assert.deepEqual(parseTaskDueInput("2026-10-18", "23:59", NOW), { at: new Date("2026-10-18T16:59:00.000Z"), hasTime: true });
  assert.throws(() => parseTaskDueInput("2026-10-18", "24:00", NOW), ApiError);
  assert.throws(() => parseTaskDueInput("2026-10-18", "9:30", NOW), ApiError); // thiếu số 0 đệm — không đoán bừa
});

test("parseTaskDueInput: có giờ mà chưa chọn ngày, ngày sai dạng, hoặc ngày không tồn tại → ApiError 422", () => {
  assert.throws(() => parseTaskDueInput("", "08:00", NOW), (error: unknown) => error instanceof ApiError && error.status === 422);
  assert.throws(() => parseTaskDueInput("18/10/2026", undefined, NOW), (error: unknown) => error instanceof ApiError && error.status === 422);
  assert.throws(() => parseTaskDueInput("2026-02-30", undefined, NOW), (error: unknown) => error instanceof ApiError && error.status === 422);
});
