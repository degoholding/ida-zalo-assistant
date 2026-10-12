import assert from "node:assert/strict";
import { test } from "node:test";
import { JobKind, JobStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { skipJob } from "../jobs/job-queue.js";
import { assertNotHalted, BotHaltControl, isBotHalted, OUTBOUND_JOB_KINDS } from "./bot-halt.js";
import { BotHaltedError } from "./bot-halted-error.js";
import { normalizeBotHaltState, type BotHaltState } from "./bot-halt-state.js";

interface Captured { sql: string; params: unknown[] }

/** Db giả chỉ ghi lại câu lệnh; trả affectedRows cố định cho câu UPDATE job. */
function fakeDb(captured: Captured[]): Db {
  return { query: async (sql: string, params: unknown[] = []) => { captured.push({ sql, params }); return [{ affectedRows: 4 }, []]; } } as unknown as Db;
}

function setup() {
  const captured: Captured[] = [];
  const config = { botHalt: { halted: false, since: null, by: "", via: "" } as BotHaltState };
  const saved: { key: string; value: unknown }[] = [];
  // Giống SettingsStore.saveInternal: ghi xong thì cập nhật config
  const settings = { saveInternal: async (key: string, value: unknown) => { saved.push({ key, value }); config.botHalt = normalizeBotHaltState(value); } };
  return { captured, config, saved, control: new BotHaltControl(fakeDb(captured), config, settings as never) };
}

test("tắt bot: lưu cờ, quét việc đến hạn của đúng các loại gửi tin, ghi nhật ký; tắt lần hai không làm gì thêm", async () => {
  const { captured, config, saved, control } = setup();
  const state = await control.halt("Minh", "zalo");
  assert.equal(state.halted, true);
  assert.equal(isBotHalted(config), true);
  assert.equal(saved[0].key, "bot_halt");
  const sweep = captured.find((query) => query.sql.startsWith("UPDATE job"));
  assert.ok(sweep && /status = \?/.test(sweep.sql) && /run_after <= NOW\(3\)/.test(sweep.sql));
  assert.deepEqual(sweep.params, [JobStatus.Expired, "bot tắt khẩn — bỏ", JobStatus.Pending, [...OUTBOUND_JOB_KINDS]]);
  const audit = captured.find((query) => query.sql.includes("audit_log"));
  assert.ok(audit && audit.params.includes("bot_halt"));
  const before = captured.length;
  await control.halt("Lan", "web");
  assert.equal(captured.length, before);
  assert.equal(saved.length, 1);
});

test("bật lại: xóa cờ, ghi nhật ký bot_resume; bật khi đang bật không làm gì", async () => {
  const { captured, config, saved, control } = setup();
  await control.resume("Minh", "zalo");
  assert.equal(saved.length, 0);
  await control.halt("Minh", "zalo");
  await control.resume("Lan", "web");
  assert.equal(isBotHalted(config), false);
  assert.ok(captured.some((query) => query.sql.includes("audit_log") && query.params.includes("bot_resume")));
});

test("assertNotHalted ném BotHaltedError (là JobSkippedError) khi đang tắt", () => {
  assert.doesNotThrow(() => assertNotHalted({ botHalt: { halted: false, since: null, by: "", via: "" } }));
  assert.throws(() => assertNotHalted({ botHalt: { halted: true, since: "2026-10-12T02:30:00.000Z", by: "", via: "web" } }), BotHaltedError);
});

test("việc gửi tin: mọi loại app xử lý đều nằm trong danh sách quét", () => {
  assert.deepEqual([...OUTBOUND_JOB_KINDS].sort(), Object.values(JobKind).filter((value) => typeof value === "number").sort());
});

test("giá trị cờ hỏng hoặc thiếu coi như bot đang bật", () => {
  for (const raw of [null, undefined, "x", 5, {}, { halted: "yes" }]) assert.equal(normalizeBotHaltState(raw).halted, false);
  assert.equal(normalizeBotHaltState({ halted: true, since: "2026-10-12T02:30:00.000Z", by: "A", via: "zalo" }).via, "zalo");
});

test("skipJob đánh Expired kèm lý do, không đụng tới số lần thử", async () => {
  const captured: Captured[] = [];
  await skipJob(fakeDb(captured), 7, "bot tắt khẩn");
  assert.ok(!captured[0].sql.includes("attempts"));
  assert.deepEqual(captured[0].params, [JobStatus.Expired, "bot tắt khẩn", 7]);
});
