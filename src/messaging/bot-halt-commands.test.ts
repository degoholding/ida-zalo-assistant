import assert from "node:assert/strict";
import { test } from "node:test";
import { describeBotStatus, formatHaltTime, haltedReply, handleHaltGate, pausedReply, RESUME_DENIED_REPLY, RESUMED_REPLY, type HaltGateContext } from "./bot-halt-commands.js";
import type { BotHaltState } from "./bot-halt-state.js";

// 12/10/2026 09:30 giờ VN = 02:30 UTC
const SINCE = "2026-10-12T02:30:00.000Z";

test("giờ tắt hiển thị theo giờ Việt Nam", () => {
  assert.equal(formatHaltTime(SINCE), "09:30");
  assert.equal(formatHaltTime(null), "");
});

test("câu tình trạng: đang bật / đang tắt kèm giờ, ngày, người tắt, kênh", () => {
  assert.match(describeBotStatus({ halted: false, since: null, by: "", via: "" }), /đang BẬT/);
  const off = describeBotStatus({ halted: true, since: SINCE, by: "Minh", via: "zalo" });
  assert.match(off, /đang TẮT từ 09:30 12\/10/);
  assert.match(off, /bởi Minh qua Zalo/);
  assert.match(describeBotStatus({ halted: true, since: SINCE, by: "Lan", via: "web" }), /bởi Lan qua web/);
});

test("câu báo tắt và câu tạm dừng có giờ tắt", () => {
  const state = { halted: true, since: SINCE, by: "Minh", via: "zalo" as const };
  assert.match(haltedReply(state), /Đã TẮT bot lúc 09:30/);
  assert.match(pausedReply(state), /tạm dừng gửi tin từ 09:30/);
});

// Cổng lệnh với DB giả: recipientRows = kết quả truy vấn «người nhận đang bật» của người hỏi
function gateSetup(halted: boolean, isRecipient: boolean) {
  const calls: string[] = [];
  let state: BotHaltState = halted ? { halted: true, since: SINCE, by: "Minh", via: "zalo" } : { halted: false, since: null, by: "", via: "" };
  const control = {
    status: () => state,
    halt: async (actor: string) => { calls.push(`halt:${actor}`); state = { halted: true, since: SINCE, by: actor, via: "zalo" }; return state; },
    resume: async (actor: string) => { calls.push(`resume:${actor}`); state = { halted: false, since: null, by: actor, via: "zalo" }; return state; },
  };
  const db = { query: async () => [isRecipient ? [{ id: 3 }] : [], []] };
  return { calls, ctx: { db, control } as unknown as HaltGateContext };
}
const contact = (uid: string, role: number) => ({ id: 1, zalo_uid: uid, display_name: `Tên ${uid}`, zalo_name: "", kind: 1, role, company_id: null });

test("cổng: bot đang bật + câu thường → đi tiếp luồng thường, không tốn truy vấn", async () => {
  const { ctx } = gateSetup(false, false);
  assert.deepEqual(await handleHaltGate(ctx, contact("u1", 2), "tóm tắt nhóm Kho giúp anh"), { reply: null, consumed: false });
});

test("cổng: người có vai trò «tắt bot» → tắt ngay; người lạ gõ cùng câu thì im lặng", async () => {
  const manager = gateSetup(false, false);
  const result = await handleHaltGate(manager.ctx, contact("u1", 2), "tắt bot");
  assert.equal(result.consumed, true);
  assert.match(result.reply ?? "", /Đã TẮT bot lúc 09:30/);
  assert.deepEqual(manager.calls, ["halt:Tên u1"]);

  const stranger = gateSetup(false, false);
  assert.deepEqual(await handleHaltGate(stranger.ctx, contact("u9", 0), "tắt bot"), { reply: null, consumed: false });
  assert.deepEqual(stranger.calls, []);
});

test("cổng: bật lại chỉ người nhận; người chỉ có vai trò bị từ chối", async () => {
  const roleOnly = gateSetup(true, false);
  const denied = await handleHaltGate(roleOnly.ctx, contact("u1", 2), "bật bot");
  assert.equal(denied.reply, RESUME_DENIED_REPLY);
  assert.deepEqual(roleOnly.calls, []);

  const recipient = gateSetup(true, true);
  const ok = await handleHaltGate(recipient.ctx, contact("u2", 2), "bật bot");
  assert.equal(ok.reply, RESUMED_REPLY);
  assert.deepEqual(recipient.calls, ["resume:Tên u2"]);
});

test("cổng: đang tắt → câu thường chỉ nhận MỘT câu «tạm dừng» mỗi người, người lạ im lặng, luôn consumed", async () => {
  const { ctx } = gateSetup(true, false);
  const first = await handleHaltGate(ctx, contact("u5", 3), "gửi báo cáo tuần");
  assert.match(first.reply ?? "", /tạm dừng/);
  assert.equal(first.consumed, true);
  assert.deepEqual(await handleHaltGate(ctx, contact("u5", 3), "alo"), { reply: null, consumed: true });
  assert.deepEqual(await handleHaltGate(ctx, contact("u6", 0), "alo"), { reply: null, consumed: true });
  assert.match((await handleHaltGate(ctx, contact("u5", 3), "tình trạng bot")).reply ?? "", /đang TẮT/);
});
