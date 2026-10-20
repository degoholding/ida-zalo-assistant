import assert from "node:assert/strict";
import { test } from "node:test";
import { UserRole } from "../../constants.js";
import type { AskerOrigin } from "../actors/contact-actor.js";
import { buildContactActor } from "../actors/contact-actor.js";
import { buildDataAccessContext } from "../data-access-context.js";
import { fakeDb } from "../data-access-test-support.js";
import { McpCallSource } from "../../constants.js";
import { groupScopePartOf, overseerVisibilityPart, requireTicketActor } from "./ticket-actor-rules.js";

// Phạm vi ticket của sếp: nhóm (hỏi trong nhóm) + nhóm nguồn / Mật theo nguồn danh tính — bảng ca thuần (đối chiếu với `overseerPart` cũ ở test vàng DB).

const { db } = fakeDb();
function setup(origin: AskerOrigin, options: { groupId?: number | null; confidential?: boolean; groupIds?: number[] | null } = {}) {
  const principal = { userId: origin === "web_user" ? 3 : null, tenantId: 1, fullName: "x", email: "", role: UserRole.Manager, groupIds: options.groupIds ?? null, canViewConfidential: options.confidential === true };
  const actor = buildContactActor(db, { contact: { id: 1, uid: "u-1", name: "x", role: 1, kind: 2 }, origin, groupId: options.groupId ?? null });
  return { ctx: buildDataAccessContext({ db, principal, maskPersonal: false, source: McpCallSource.Assistant, contactActor: actor }), actor };
}

test("không có chủ thể liên hệ → forbidden (HTTP không bao giờ có)", () => {
  const { ctx } = setup("derived_role");
  assert.equal(requireTicketActor(ctx).uid, "u-1");
  assert.throws(() => requireTicketActor({ ...ctx, contactActor: undefined }), (error: { code?: string }) => error.code === "forbidden");
});

test("phạm vi nhóm: chỉ khi hỏi trong nhóm", () => {
  assert.equal(groupScopePartOf({ groupId: null }), undefined);
  assert.deepEqual(groupScopePartOf({ groupId: 9 }), { sql: "t.source_thread_id = ?", params: [9] });
});

test("người suy từ vai trò / người nhận: mọi nhóm nhưng KHÔNG nhóm Mật (trừ khi ctx được Mật)", () => {
  const closed = setup("derived_role");
  assert.deepEqual(overseerVisibilityPart(closed.ctx, closed.actor), { sql: "((g.id IS NULL OR g.is_confidential = 0))", params: [] });
  const open = setup("derived_recipient", { confidential: true });
  assert.equal(overseerVisibilityPart(open.ctx, open.actor), undefined);
});

test("tài khoản web / đã tắt: theo luật nhóm + Mật của lõi, cộng nhóm đang hỏi", () => {
  const web = setup("web_user", { groupIds: [4, 5], groupId: 4 });
  const part = overseerVisibilityPart(web.ctx, web.actor)!;
  assert.match(part.sql, /t\.source_thread_id = \?/);
  assert.match(part.sql, /is_confidential = 0/);
  assert.deepEqual(part.params.slice(0, 1), [4]);
  const disabled = setup("disabled_account", { groupIds: [] });
  assert.match(overseerVisibilityPart(disabled.ctx, disabled.actor)!.sql, /is_confidential = 0/);
});
