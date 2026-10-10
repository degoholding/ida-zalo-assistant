import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBriefScope, workScopeSql, type BriefScopeGroup } from "./brief-scope.js";
import type { BriefScope } from "./brief-types.js";

const groups: BriefScopeGroup[] = [
  { id: 1, isConfidential: false, readMessages: true }, // nhóm thường đang đọc
  { id: 2, isConfidential: true, readMessages: true }, // nhóm Mật đang đọc
  { id: 3, isConfidential: false, readMessages: false }, // nhóm thường NGỪNG đọc
  { id: 4, isConfidential: true, readMessages: false }, // nhóm Mật ngừng đọc
];

test("«mọi nhóm»: chỉ nhóm đang đọc và không Mật, includeUngrouped = true", () => {
  const scope = resolveBriefScope({ uid: "u1", allGroups: true, selectedGroupIds: [], groups });
  assert.deepEqual(scope.groupIds, [1]);
  assert.deepEqual(scope.aiGroupIds, [1]);
  assert.equal(scope.includeUngrouped, true);
  assert.equal(scope.uid, "u1");
});

test("giới hạn nhóm: chọn cả nhóm Mật thì groupIds CÓ nhưng aiGroupIds KHÔNG bao giờ có Mật", () => {
  const scope = resolveBriefScope({ uid: "u2", allGroups: false, selectedGroupIds: [1, 2], groups });
  assert.deepEqual(scope.groupIds.sort(), [1, 2]);
  assert.deepEqual(scope.aiGroupIds, [1]);
  assert.equal(scope.includeUngrouped, false);
});

test("giới hạn nhóm chỉ chọn Mật: groupIds có đúng nhóm đó, aiGroupIds rỗng", () => {
  const scope = resolveBriefScope({ uid: "u3", allGroups: false, selectedGroupIds: [2], groups });
  assert.deepEqual(scope.groupIds, [2]);
  assert.deepEqual(scope.aiGroupIds, []);
});

test("giới hạn nhóm, danh sách chọn rỗng → không có gì", () => {
  const scope = resolveBriefScope({ uid: "u4", allGroups: false, selectedGroupIds: [], groups });
  assert.deepEqual(scope.groupIds, []);
  assert.deepEqual(scope.aiGroupIds, []);
  assert.equal(scope.includeUngrouped, false);
});

test("giới hạn nhóm: id đã chọn không còn tồn tại trong hệ thống thì bỏ qua, không lỗi", () => {
  const scope = resolveBriefScope({ uid: "u5", allGroups: false, selectedGroupIds: [999], groups });
  assert.deepEqual(scope.groupIds, []);
});

test("«mọi nhóm» không có nhóm nào đang đọc → rỗng nhưng vẫn includeUngrouped", () => {
  const scope = resolveBriefScope({ uid: "u6", allGroups: true, selectedGroupIds: [], groups: [groups[1], groups[2]] });
  assert.deepEqual(scope.groupIds, []);
  assert.equal(scope.includeUngrouped, true);
});

// workScopeSql — luật phạm vi việc / ticket dùng chung giữa bản tin và báo cáo tuần / tháng (review phase 8, H1).
const scopeOf = (patch: Partial<BriefScope>): BriefScope => ({ uid: "u1", groupIds: [], aiGroupIds: [], includeUngrouped: false, ...patch });

test("workScopeSql: «mọi nhóm» (includeUngrouped) → khớp việc KHÔNG gắn nhóm hoặc tạo trong TIN RIÊNG với bot, không cần tham số", () => {
  const { sql, params } = workScopeSql(scopeOf({ includeUngrouped: true }), { thread: "t.source_thread_id", parties: [] });
  assert.equal(sql, "((t.source_thread_id IS NULL OR t.source_thread_id IN (SELECT id FROM zalo_group WHERE thread_type = 0)))");
  assert.deepEqual(params, []);
});

test("workScopeSql: giới hạn nhóm → khớp nhóm đã chọn (kể cả Mật nếu có trong groupIds)", () => {
  const { sql, params } = workScopeSql(scopeOf({ groupIds: [3, 7] }), { thread: "t.source_thread_id", parties: [] });
  assert.equal(sql, "(t.source_thread_id IN (?))");
  assert.deepEqual(params, [[3, 7]]);
});

test("workScopeSql: chốt 09/10/2026 — việc của CHÍNH người nhận (party = scope.uid) luôn khớp dù ngoài phạm vi nhóm", () => {
  const { sql, params } = workScopeSql(scopeOf({ uid: "u9" }), { thread: "t.source_thread_id", parties: ["t.assignee_uid", "t.assigner_uid"] });
  assert.equal(sql, "(t.assignee_uid = ? OR t.assigner_uid = ?)");
  assert.deepEqual(params, ["u9", "u9"]);
});

test("workScopeSql: gộp cả ba điều kiện bằng OR khi đều có", () => {
  const { sql, params } = workScopeSql(
    scopeOf({ includeUngrouped: true, groupIds: [1], uid: "u2" }),
    { thread: "t.source_thread_id", parties: ["t.requester_uid"] },
  );
  assert.equal(sql, "((t.source_thread_id IS NULL OR t.source_thread_id IN (SELECT id FROM zalo_group WHERE thread_type = 0)) OR t.source_thread_id IN (?) OR t.requester_uid = ?)");
  assert.deepEqual(params, [[1], "u2"]);
});

test("workScopeSql: không có điều kiện nào (giới hạn nhóm, chưa chọn gì, không đảng phái) → không khớp dòng nào", () => {
  const { sql, params } = workScopeSql(scopeOf({}), { thread: "t.source_thread_id", parties: [] });
  assert.equal(sql, "1 = 0");
  assert.deepEqual(params, []);
});
