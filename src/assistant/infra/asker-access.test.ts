import assert from "node:assert/strict";
import { test } from "node:test";
import { ContactRole, McpCallSource, UserRole } from "../../constants.js";
import { buildDataAccessContext } from "../../data-access/data-access-context.js";
import { fakeDb } from "../../data-access/data-access-test-support.js";
import { askerContactScope, mayAskInConfidentialGroup, relaxConfidential, resolveAskerAccess, type AskerContact } from "./asker-access.js";

// Phân giải người hỏi → ngữ cảnh truy cập (không DB thật): «DB» giả trả dòng theo câu SQL.

const MANAGER: AskerContact = { id: 5, zalo_uid: "u-5", role: ContactRole.Manager, display_name: "Anh Năm" };
const NO_ROLE: AskerContact = { id: 6, zalo_uid: "u-6", role: ContactRole.None, display_name: "Chị Sáu" };

interface World {
  linked?: number[]; // id app_user gắn với liên hệ (đang bật)
  disabledLinked?: number[]; // id app_user gắn với liên hệ nhưng đã tắt
  user?: Record<string, unknown> | null; // dòng app_user khi nạp theo id
  scope?: number[]; // user_group_scope
  readable?: number[]; // nhóm đang đọc
  ownDirect?: number[]; // cuộc riêng của người hỏi
  recipient?: { id: number; all_groups: number } | null;
  recipientGroups?: number[];
}

function world(w: World) {
  return fakeDb((sql) => {
    if (/FROM app_user WHERE contact_id/.test(sql)) return [...(w.linked ?? []).map((id) => ({ id, is_active: 1 })), ...(w.disabledLinked ?? []).map((id) => ({ id, is_active: 0 }))];
    if (/FROM app_user WHERE id/.test(sql)) return w.user ? [w.user] : [];
    if (/FROM user_group_scope/.test(sql)) return (w.scope ?? []).map((group_id) => ({ group_id }));
    if (/read_messages = 1/.test(sql)) return (w.readable ?? []).map((id) => ({ id }));
    if (/zalo_group_id = \?/.test(sql)) return (w.ownDirect ?? []).map((id) => ({ id }));
    if (/FROM recipient_group/.test(sql)) return (w.recipientGroups ?? []).map((group_id) => ({ group_id }));
    if (/FROM recipient r/.test(sql)) return w.recipient ? [w.recipient] : [];
    return [];
  });
}

const user = (overrides: Record<string, unknown> = {}) => ({
  id: 9, tenant_id: 1, email: "n@ida.vn", username: "n", full_name: "Năm", role: UserRole.Manager, all_groups: 0,
  can_view_confidential: 0, can_view_audit: 0, is_active: 1, ...overrides,
});

const resolve = (db: ReturnType<typeof world>, contact: AskerContact, groupScopeId?: number) =>
  resolveAskerAccess(db.db, contact, { groupScopeId, maskPersonal: true });

test("linked web user: principal comes from the account, own DM only, assistant source, never write", async () => {
  const access = await resolve(world({ linked: [9], user: user({ all_groups: 1 }) }), MANAGER);
  assert.equal(access.origin, "web_user");
  assert.equal(access.principal.userId, 9);
  assert.equal(access.principal.groupIds, null);
  assert.equal(access.includeConfidential, false);
  assert.equal(access.ownDirectThreadsOnly, true);
  assert.equal(access.ownDirectUid, "u-5");
  assert.equal(access.allowWrite, false);
  assert.equal(access.source, McpCallSource.Assistant);
  assert.equal(access.maskPersonal, true);
});

test("linked web user with the confidential flag gets includeConfidential; without it never", async () => {
  const on = await resolve(world({ linked: [9], user: user({ can_view_confidential: 1, all_groups: 1 }) }), MANAGER);
  const off = await resolve(world({ linked: [9], user: user({ can_view_confidential: 0, all_groups: 1 }) }), MANAGER);
  assert.equal(on.includeConfidential, true);
  assert.equal(off.includeConfidential, false);
});

test("linked web user with a scoped group list keeps the scope and adds only their own DM threads", async () => {
  const access = await resolve(world({ linked: [9], user: user(), scope: [3, 4], ownDirect: [90] }), MANAGER);
  assert.deepEqual(access.principal.groupIds, [3, 4, 90]);
});

test("asking inside a group narrows every origin to that group", async () => {
  const web = await resolve(world({ linked: [9], user: user({ all_groups: 1, can_view_confidential: 1 }) }), MANAGER, 7);
  assert.deepEqual(web.principal.groupIds, [7]);
  assert.equal(web.includeConfidential, true, "người có cờ gọi bot trong nhóm Mật → xử lý bình thường");
  const derived = await resolve(world({}), MANAGER, 7);
  assert.deepEqual(derived.principal.groupIds, [7]);
  assert.equal(derived.includeConfidential, false);
});

test("contact with a ContactRole but no account: derived principal = readable groups + own DM, no confidential", async () => {
  const access = await resolve(world({ readable: [1, 2], ownDirect: [90] }), MANAGER);
  assert.equal(access.origin, "derived_role");
  assert.equal(access.principal.userId, null);
  assert.equal(access.principal.role, UserRole.Manager);
  assert.deepEqual(access.principal.groupIds, [1, 2, 90]);
  assert.equal(access.includeConfidential, false);
  assert.equal(askerContactScope(access), null, "người có vai trò chưa có tài khoản vẫn thấy cả Danh bạ như trước");
});

test("no account row at all falls back to the derived role principal", async () => {
  assert.equal((await resolve(world({ linked: [], readable: [1] }), MANAGER)).origin, "derived_role");
});

test("disabled account (rows exist, none active) gets NO data: no groups, no confidential, own DM only — not the role fallback", async () => {
  const access = await resolve(world({ disabledLinked: [9], readable: [1, 2], ownDirect: [90] }), MANAGER);
  assert.equal(access.origin, "disabled_account");
  assert.deepEqual(access.principal.groupIds, [90]);
  assert.equal(access.includeConfidential, false);
  assert.equal(access.principal.role, UserRole.Staff);
  // Hỏi trong nhóm: cũng không thấy dữ liệu nhóm
  const inGroup = await resolve(world({ disabledLinked: [9], readable: [1, 2], ownDirect: [90] }), MANAGER, 7);
  assert.deepEqual(inGroup.principal.groupIds, []);
  assert.equal(inGroup.includeConfidential, false);
});

test("account that turns inactive between the two queries is treated as disabled", async () => {
  const access = await resolve(world({ linked: [9], user: user({ is_active: 0 }), readable: [1] }), MANAGER);
  assert.equal(access.origin, "disabled_account");
});

test("two active accounts on one contact: narrowest scope (group intersection, confidential only if both, lowest role)", async () => {
  const db = fakeDb((sql, params) => {
    if (/FROM app_user WHERE contact_id/.test(sql)) return [{ id: 9, is_active: 1 }, { id: 10, is_active: 1 }];
    if (/FROM app_user WHERE id/.test(sql)) {
      return params[0] === 9
        ? [user({ id: 9, role: UserRole.Manager, can_view_confidential: 1 })]
        : [user({ id: 10, role: UserRole.Staff, can_view_confidential: 0, all_groups: 0 })];
    }
    if (/FROM user_group_scope/.test(sql)) return (params[0] === 9 ? [3, 4, 5] : [4, 5, 6]).map((group_id) => ({ group_id }));
    return [];
  });
  const access = await resolveAskerAccess(db.db, MANAGER, { maskPersonal: false });
  assert.equal(access.origin, "web_user");
  assert.deepEqual(access.principal.groupIds, [4, 5]);
  assert.equal(access.includeConfidential, false);
  assert.equal(access.principal.role, UserRole.Staff);
});

test("recipient without role or account: scope follows recipient_group (decision 6) + own DM", async () => {
  const access = await resolve(world({ recipient: { id: 3, all_groups: 0 }, recipientGroups: [8, 9], ownDirect: [91], readable: [1, 2, 8, 9] }), NO_ROLE);
  assert.equal(access.origin, "derived_recipient");
  assert.deepEqual(access.principal.groupIds, [8, 9, 91]);
  assert.equal(access.principal.role, UserRole.Staff);
  assert.equal(access.includeConfidential, false);
  assert.notEqual(askerContactScope(access), null);
});

test("recipient with all_groups follows the readable groups; nobody (no role, no recipient) only gets their own DM", async () => {
  const all = await resolve(world({ recipient: { id: 3, all_groups: 1 }, readable: [1, 2] }), NO_ROLE);
  assert.deepEqual(all.principal.groupIds, [1, 2]);
  const nobody = await resolve(world({ ownDirect: [92] }), NO_ROLE);
  assert.deepEqual(nobody.principal.groupIds, [92]);
});

test("relaxConfidential only flips the confidential switch", async () => {
  const access = await resolve(world({ linked: [9], user: user({ all_groups: 1 }) }), MANAGER);
  const relaxed = relaxConfidential(access);
  assert.equal(relaxed.includeConfidential, true);
  assert.equal(access.includeConfidential, false);
  assert.equal(relaxed.principal, access.principal);
});

test("mayAskInConfidentialGroup: flag holder with an account yes; derived or unflagged no", async () => {
  assert.equal(await mayAskInConfidentialGroup(world({ linked: [9], user: user({ can_view_confidential: 1 }) }).db, MANAGER, 7), true);
  assert.equal(await mayAskInConfidentialGroup(world({ linked: [9], user: user({ can_view_confidential: 0 }) }).db, MANAGER, 7), false);
  assert.equal(await mayAskInConfidentialGroup(world({}).db, MANAGER, 7), false);
});

test("contactActor: có cho MỌI người hỏi (tài khoản / vai trò / người nhận / đã tắt), mang cuộc + tin của lượt; danh tính từ liên hệ, không từ tham số", async () => {
  const turn = { threadId: 4, messageId: 40, botAccountId: 2 };
  const cases: [string, ReturnType<typeof world>, AskerContact, string][] = [
    ["web_user", world({ linked: [9], user: user({ all_groups: 1 }) }), MANAGER, "web_user"],
    ["derived_role", world({}), MANAGER, "derived_role"],
    ["derived_recipient", world({}), NO_ROLE, "derived_recipient"],
    ["disabled_account", world({ disabledLinked: [9] }), MANAGER, "disabled_account"],
  ];
  for (const [label, sim, contact, origin] of cases) {
    const access = await resolveAskerAccess(sim.db, contact, { maskPersonal: false, turn });
    const actor = access.contactActor!;
    assert.ok(actor, label);
    assert.deepEqual([actor.contactId, actor.uid, actor.origin, actor.threadId, actor.messageId, actor.botAccountId, actor.groupId], [contact.id, contact.zalo_uid, origin, 4, 40, 2, null], label);
    assert.equal(actor.name, contact.display_name);
  }
  const inGroup = await resolveAskerAccess(world({}).db, MANAGER, { groupScopeId: 7, maskPersonal: false });
  assert.equal(inGroup.contactActor!.groupId, 7);
  assert.equal(inGroup.contactActor!.threadId, null);
});

test("móc ctx trợ lý: wakeJobs / saveSettings truyền vào ctx; cổng HTTP (buildDataAccessContext không đặt) không có contactActor / saveSettings", async () => {
  const wake = () => undefined;
  const save = async () => ["k"];
  const access = await resolveAskerAccess(world({}).db, MANAGER, { maskPersonal: false, wakeJobs: wake, saveSettings: save });
  assert.equal(access.wakeJobs, wake);
  assert.equal(access.saveSettings, save);
  const http = buildDataAccessContext({ db: world({}).db, principal: access.principal, maskPersonal: false, source: McpCallSource.Http });
  assert.equal(http.contactActor, undefined);
  assert.equal(http.saveSettings, undefined);
});
