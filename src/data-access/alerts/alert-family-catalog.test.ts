import assert from "node:assert/strict";
import { test } from "node:test";
import { ALERT_TOOL_DECLARATIONS, alertToolDeclarations, alertRuntimeFromDeps, type AlertToolsDeps } from "../../assistant/alert-tools.js";
import { McpCallSource } from "../../constants.js";
import { buildContactActor } from "../actors/contact-actor.js";
import { alertsFamilyCatalog } from "../catalog/alerts-family-tools.js";
import { fakeDb, makeCtx, manager } from "../data-access-test-support.js";
import type { DataAccessContext } from "../data-access-context.js";
import type { AlertRuntime } from "./alert-asker-facts.js";
import { ALERT_CONFIG_CHANGE_TOOL, alertConfigChangeAction, alertItemHandledAction } from "./alert-write-actions.js";

// Mặt công cụ của họ `alerts`: chỉ trợ lý (không bao giờ `mcp_http`), công cụ lệnh gõ mô hình không thấy, `confirm_alert_change` không có ở lõi,
// điều kiện hiện công cụ (chủ thể Zalo + tin riêng + tài khoản không tắt + móc `alertRuntime`) — không cần DB.

const runtime: AlertRuntime = {
  settings: () => ({ enabled: true, aiEnabled: false, urgentKeywords: "gấp", importantKeywords: "báo giá", strictKeywords: "", replyWaitMinutes: 120, vipWaitMinutes: 30,
    dailyReminderCap: 3, urgentMergeSeconds: 30, workHours: "08:00-17:30", quietHours: "21:00-06:00" }),
  invalidate: () => undefined,
};
type CtxExtra = DataAccessContext & { alertRuntime?: AlertRuntime };

function ctxOf(options: { actor?: boolean; groupId?: number | null; origin?: "web_user" | "derived_role" | "derived_recipient" | "disabled_account"; runtime?: boolean; save?: boolean; simulated?: boolean } = {}): DataAccessContext {
  const { db } = fakeDb();
  const contactActor = options.actor === false ? undefined
    : buildContactActor(db, { contact: { id: 5, uid: "u-5", name: "Hà", role: 1, kind: 2 }, origin: options.origin ?? "derived_role", groupId: options.groupId ?? null });
  const ctx: CtxExtra = {
    ...makeCtx(manager({ userId: null }), { source: McpCallSource.Assistant, contactActor, saveSettings: options.save === false ? undefined : async () => [] }),
    // Tin riêng thật: cuộc riêng của chính người hỏi; «Hỏi trợ lý» mô phỏng từ web không có (L5)
    ownDirectThreadsOnly: true, ownDirectUid: options.simulated ? null : "u-5",
  };
  if (options.runtime !== false) ctx.alertRuntime = runtime;
  return ctx;
}

const byName = (name: string) => alertsFamilyCatalog.tools.find((tool) => tool.name === name)!;

test("họ alerts: mọi công cụ chỉ ở mặt trợ lý, không có mặt mcp_http", () => {
  assert.ok(alertsFamilyCatalog.tools.length >= 9);
  for (const tool of alertsFamilyCatalog.tools) {
    assert.ok(tool.surfaces && tool.surfaces.length === 1, `${tool.name}: đúng một mặt`);
    assert.ok(!tool.surfaces.includes("mcp_http"), `${tool.name}: không ra cổng ngoài`);
    assert.equal(tool.family, "alerts");
  }
});

test("mặt mô hình: đúng ba công cụ giữ tên cũ; không có confirm_alert_change; lệnh gõ mô hình không thấy", () => {
  const model = alertsFamilyCatalog.tools.filter((tool) => tool.surfaces?.[0] === "assistant_model").map((tool) => tool.name).sort();
  assert.deepEqual(model, ["list_pending_items", "mark_item_handled", "propose_alert_change"]);
  assert.equal(alertsFamilyCatalog.tools.some((tool) => tool.name === "confirm_alert_change"), false);
  const command = alertsFamilyCatalog.tools.filter((tool) => tool.surfaces?.[0] === "assistant_command").map((tool) => tool.name).sort();
  assert.deepEqual(command, ["alert_config_cancel", "alert_config_confirm", "alert_config_pending", "alert_config_propose", "alert_config_view", "alert_item_mark_handled", "alert_pending_list"]);
});

test("thao tác ghi theo quan hệ: xong tin ghi NGAY; đổi cấu hình qua nháp 15 phút; không đăng ký vào danh mục ghi chung (xác nhận bằng công cụ của họ)", () => {
  assert.equal(alertItemHandledAction.permission, "relationship");
  assert.equal(alertItemHandledAction.confirmMode, "immediate");
  assert.equal(alertConfigChangeAction.permission, "relationship");
  assert.notEqual(alertConfigChangeAction.confirmMode, "immediate");
  assert.equal(alertConfigChangeAction.ttlMs, 15 * 60_000);
  assert.deepEqual(alertsFamilyCatalog.actions, []);
  assert.equal(alertConfigChangeAction.tool, ALERT_CONFIG_CHANGE_TOOL);
});

test("điều kiện hiện công cụ: cần chủ thể Zalo + tin riêng + tài khoản không tắt + móc alertRuntime; đổi cấu hình cần thêm saveSettings", () => {
  const read = byName("list_pending_items");
  const config = byName("propose_alert_change");
  assert.equal(read.available(ctxOf()), true);
  assert.equal(config.available(ctxOf()), true);
  assert.equal(read.available(ctxOf({ actor: false })), false, "cổng HTTP không có chủ thể");
  assert.equal(read.available(ctxOf({ groupId: 12 })), false, "hỏi trong nhóm không có công cụ cảnh báo");
  assert.equal(read.available(ctxOf({ origin: "disabled_account" })), false);
  assert.equal(read.available(ctxOf({ runtime: false })), false, "chưa gắn alertRuntime ⇒ ẩn, trợ lý chạy đường cũ");
  assert.equal(read.available(ctxOf({ simulated: true })), false, "L5: «Hỏi trợ lý» mô phỏng từ web không có công cụ cảnh báo (không nháp gắn vào người được mô phỏng)");
  assert.equal(config.available(ctxOf({ simulated: true })), false);
  assert.equal(read.available(ctxOf({ save: false })), true);
  assert.equal(config.available(ctxOf({ save: false })), false);
  assert.equal(byName("alert_config_confirm").available(ctxOf({ save: false })), false);
});

test("khai báo cũ: có confirm_alert_change; họ bật thì bỏ nó, giữ ba công cụ còn lại", () => {
  assert.ok(ALERT_TOOL_DECLARATIONS.some((tool) => tool.name === "confirm_alert_change"));
  assert.deepEqual(alertToolDeclarations(true).map((tool) => tool.name), ["list_pending_items", "mark_item_handled", "propose_alert_change"]);
  assert.equal(alertToolDeclarations(false), ALERT_TOOL_DECLARATIONS);
});

test("alertRuntimeFromDeps: cài đặt lấy từ config đang chạy (đọc lại mỗi lần), invalidate chuyển tiếp", () => {
  let invalidated = 0;
  const config = { alerts: { enabled: true, aiEnabled: true, urgentKeywords: "a", importantKeywords: "b", strictKeywords: "c", replyWaitMinutes: 10, vipWaitMinutes: 5, dailyReminderCap: 1, urgentMergeSeconds: 2, telegramBotToken: "x", telegramChatId: "y" },
    calendar: { workHours: "08:00-17:00", quietHours: "22:00-06:00" } };
  const deps = { db: fakeDb().db, config, saveSettings: async () => [], invalidate: () => { invalidated += 1; } } as unknown as AlertToolsDeps;
  const live = alertRuntimeFromDeps(deps);
  assert.equal(live.settings().urgentKeywords, "a");
  config.alerts.urgentKeywords = "z";
  assert.equal(live.settings().urgentKeywords, "z");
  assert.equal(live.settings().workHours, "08:00-17:00");
  live.invalidate();
  assert.equal(invalidated, 1);
});
