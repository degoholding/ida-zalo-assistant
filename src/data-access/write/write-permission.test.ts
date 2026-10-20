import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod/v4";
import { McpCallSource, UserRole } from "../../constants.js";
import { buildContactActor } from "../actors/contact-actor.js";
import { DataAccessError } from "../data-access-errors.js";
import { admin, fakeDb, makeCtx, staff } from "../data-access-test-support.js";
import { executeImmediateWrite } from "./immediate-write.js";
import { proposeTool } from "./propose-tool-factory.js";
import { canPropose, eraseAction, type WriteAction } from "./write-action.js";

// Hai loại quyền thao tác ghi: `role` (D3) và `relationship` (cần chủ thể liên hệ) + ghi ngay (không nháp).

const schema = z.object({ title: z.string() }).strict();
const calls: string[] = [];
const base = {
  tool: "demo_write", title: "Demo", description: "Demo", entity: "contact" as const, schema,
  async prepare(_ctx: unknown, payload: { title: string }) {
    calls.push(`prepare:${payload.title}`);
    return { preview: "xem trước", targetEntity: "task", targetId: null, stateToken: "tok-1" };
  },
  async execute(_ctx: unknown, payload: { title: string }, expected: string) {
    calls.push(`execute:${payload.title}:${expected}`);
    return { entity: "task", id: 5, changed: ["Tiêu đề"], message: "Đã tạo việc" };
  },
};
const roleAction = eraseAction(base as unknown as WriteAction<{ title: string }>);
const relationAction = eraseAction({ ...base, permission: "relationship", confirmMode: "immediate" } as unknown as WriteAction<{ title: string }>);

const actor = buildContactActor(fakeDb().db, { contact: { id: 31, uid: "u-31", name: "Lan", role: 0, kind: 2 }, origin: "derived_recipient" });
const assistantCtx = (principal = staff({ userId: null }), withActor = true) =>
  makeCtx(principal, { source: McpCallSource.Assistant, allowWrite: false, ...(withActor ? { contactActor: actor } : {}) });

test("canPropose 'role' giữ luật D3: Quản trị có tài khoản + khóa đọc+ghi được; Nhân viên không; có contactActor cũng không thay được", () => {
  assert.equal(canPropose(makeCtx(admin(), { allowWrite: true }), roleAction), true);
  assert.equal(canPropose(makeCtx(staff(), { allowWrite: true, contactActor: actor }), roleAction), false);
  assert.equal(canPropose(makeCtx(admin(), { allowWrite: false }), roleAction), false);
  assert.equal(canPropose(makeCtx(admin({ userId: null }), { allowWrite: true }), roleAction), false);
});

test("canPropose 'relationship': cần contactActor — kể cả người không tài khoản / Nhân viên; HTTP (không actor) không bao giờ thấy", () => {
  assert.equal(canPropose(assistantCtx(), relationAction), true);
  assert.equal(canPropose(assistantCtx(staff()), relationAction), true, "Nhân viên web có actor → thấy thao tác quan hệ");
  assert.equal(canPropose(assistantCtx(staff({ userId: null }), false), relationAction), false);
  assert.equal(canPropose(makeCtx(admin(), { allowWrite: true }), relationAction), false, "cổng HTTP không có contactActor");
  assert.equal(canPropose(makeCtx(admin({ role: UserRole.Admin }), { allowWrite: true, source: McpCallSource.Http }), relationAction), false);
});

test("proposeTool: thao tác 'relationship' available theo contactActor; confirmMode 'immediate' không dựng được công cụ nháp", () => {
  const draftRelation = eraseAction({ ...base, permission: "relationship" } as unknown as WriteAction<{ title: string }>);
  const tool = proposeTool(draftRelation);
  assert.equal(tool.available(assistantCtx()), true);
  assert.equal(tool.available(makeCtx(admin(), { allowWrite: true })), false);
  assert.throws(() => proposeTool(relationAction), /immediate/);
});

test("executeImmediateWrite: kiểm schema → prepare → execute với dấu trạng thái vừa dựng; không để lại nháp", async () => {
  calls.length = 0;
  const done = await executeImmediateWrite(assistantCtx(), relationAction, { title: "A" });
  assert.equal(done.message, "Đã tạo việc");
  assert.deepEqual(calls, ["prepare:A", "execute:A:tok-1"]);
});

test("executeImmediateWrite: thiếu contactActor → forbidden; thao tác 'draft' → forbidden; tham số sai → invalid_value, không chạm prepare", async () => {
  calls.length = 0;
  const code = async (run: () => Promise<unknown>) => { try { await run(); return "ok"; } catch (error) { return error instanceof DataAccessError ? error.code : String(error); } };
  assert.equal(await code(() => executeImmediateWrite(assistantCtx(staff(), false), relationAction, { title: "A" })), "forbidden");
  assert.equal(await code(() => executeImmediateWrite(makeCtx(admin(), { allowWrite: true }), roleAction, { title: "A" })), "forbidden");
  assert.equal(await code(() => executeImmediateWrite(assistantCtx(), relationAction, { title: 5 })), "invalid_value");
  assert.equal(await code(() => executeImmediateWrite(assistantCtx(), relationAction, { title: "A", extra: 1 })), "invalid_value");
  assert.deepEqual(calls, []);
});
