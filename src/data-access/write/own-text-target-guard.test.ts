import assert from "node:assert/strict";
import { test } from "node:test";
import { ContactKind, ContactRole } from "../../constants.js";
import { buildContactActor } from "../actors/contact-actor.js";
import { fakeDb, makeCtx, manager } from "../data-access-test-support.js";
import { McpCallSource } from "../../constants.js";
import { codeNumbersIn, ownTextNamesTarget } from "./own-text-target-guard.js";

// Chốt chặn tiêm lệnh D-A: nhận ra mã đích trong chữ của chính người hỏi (hàm thuần) + điều kiện ngữ cảnh. Ma trận đầy đủ (DB thật): test/assistant-injection-guard-and-web-role.integration.test.ts.

const nums = (text: string, kind: Parameters<typeof codeNumbersIn>[1]) => [...codeNumbersIn(text, kind)].sort((a, b) => a - b);

test("codeNumbersIn việc: V-12 / v12 / V-0012 / việc số 12 / viec 12; không nhận «V-120» là 12, không nhận chữ dính liền", () => {
  assert.deepEqual(nums("hủy V-12 giúp", "task"), [12]);
  assert.deepEqual(nums("xong v12 và V-0013", "task"), [12, 13]);
  assert.deepEqual(nums("hủy việc số 7", "task"), [7]);
  assert.deepEqual(nums("viec 9 xong", "task"), [9]);
  assert.deepEqual(nums("hủy V-120", "task"), [120]);
  assert.deepEqual(nums("DEV-12 và nvv12", "task"), [], "không dính tiền tố khác");
  assert.deepEqual(nums("T-5 là ticket", "task"), []);
});

test("codeNumbersIn ticket / tin: T-n / ticket số n; tin số n / tin #n / #n; không lẫn loại", () => {
  assert.deepEqual(nums("hủy T-5, ticket số 6", "ticket"), [5, 6]);
  assert.deepEqual(nums("V-5", "ticket"), []);
  assert.deepEqual(nums("xong tin số 123 và tin #45", "item"), [45, 123]);
  assert.deepEqual(nums("#88: cần xử lý", "item"), [88]);
  assert.deepEqual(nums("xong 123", "item"), [], "số trần không phải mã tin (lệnh gõ «xong <số>» đi đường lệnh)");
});

function ctxWith(asker: string, previous = "") {
  const actor = buildContactActor(fakeDb().db, { contact: { id: 1, uid: "u-1", name: "Lan", role: ContactRole.None, kind: ContactKind.Staff }, origin: "derived_role", askerText: asker, previousBotReply: previous });
  return makeCtx(manager({ userId: null }), { source: McpCallSource.Assistant, contactActor: actor });
}

test("ownTextNamesTarget: tin của người hỏi HOẶC câu bot liền trước; không có chủ thể Zalo → false", async () => {
  assert.equal(await ownTextNamesTarget(ctxWith("hủy V-12"), { kind: "task", id: 12 }), true);
  assert.equal(await ownTextNamesTarget(ctxWith("hủy cái đầu", "V-12 gửi báo giá"), { kind: "task", id: 12 }), true);
  assert.equal(await ownTextNamesTarget(ctxWith("hủy V-13"), { kind: "task", id: 12 }), false);
  assert.equal(await ownTextNamesTarget(ctxWith("hủy V-12"), { kind: "ticket", id: 12 }), false);
  assert.equal(await ownTextNamesTarget(makeCtx(manager(), {}), { kind: "task", id: 12 }), false);
});
