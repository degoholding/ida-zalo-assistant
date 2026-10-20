import assert from "node:assert/strict";
import { test } from "node:test";
import { runPlainConfirmCancel, type PendingStoreProvider } from "./chat-confirm-router.js";
import type { ChatCommandContext } from "./chat-commands.js";

// Bộ chọn kho «đồng ý / hủy» trơn: kho mới nhất thắng, hòa thì kho đứng trước trong mảng thắng, không kho nào = null (câu thường).

const chat = { db: {}, asker: null, inGroup: false, now: new Date() } as unknown as ChatCommandContext;
const provider = (name: string, at: number | null, calls: string[]): PendingStoreProvider => ({
  latest: async () => (at === null ? null : { at, confirm: async () => { calls.push(`${name}:confirm`); return `${name} xong`; }, cancel: async () => { calls.push(`${name}:cancel`); return `${name} hủy`; } }),
});

test("ba kho cùng chờ: kho tạo SAU CÙNG thắng, kho khác không bị đụng", async () => {
  const calls: string[] = [];
  const providers = [provider("send", 100, calls), provider("alert", 300, calls), provider("write", 200, calls)];
  assert.equal(await runPlainConfirmCancel(chat, "confirm", providers), "alert xong");
  assert.equal(await runPlainConfirmCancel(chat, "cancel", providers), "alert hủy");
  assert.deepEqual(calls, ["alert:confirm", "alert:cancel"]);
});

test("hòa giờ: kho đứng trước trong mảng thắng (gửi tin > cảnh báo > nháp ghi)", async () => {
  const calls: string[] = [];
  assert.equal(await runPlainConfirmCancel(chat, "confirm", [provider("send", 5, calls), provider("alert", 5, calls), provider("write", 5, calls)]), "send xong");
});

test("không kho nào chờ: null để AI trả lời như câu thường; kho null bị bỏ qua", async () => {
  const calls: string[] = [];
  assert.equal(await runPlainConfirmCancel(chat, "confirm", [provider("send", null, calls), provider("write", null, calls)]), null);
  assert.equal(await runPlainConfirmCancel(chat, "cancel", [provider("send", null, calls), provider("write", 1, calls)]), "write hủy");
});
