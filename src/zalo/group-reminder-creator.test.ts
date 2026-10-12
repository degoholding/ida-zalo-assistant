import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { API } from "zca-js";
import { createGroupReminder } from "./group-reminder-creator.js";
import { BotHaltedError } from "../messaging/bot-halted-error.js";
import { ZaloSender } from "./zalo-sender.js";

const REQUEST = { title: "Họp giao ban", startTime: 1_800_000_000_000, repeat: 2 as const };

function fakeApi(existing: { id: string; startTime: number; params: { title: string } }[] = []) {
  const created: unknown[] = [];
  const api = {
    createReminder: async (input: unknown) => { created.push(input); return { id: "r-new" }; },
    getListReminder: async () => existing,
  } as unknown as API;
  return { api, created };
}

describe("createGroupReminder", () => {
  test("lượt đầu: tạo thẳng một nhắc hẹn qua hàng gửi, không liệt kê trước", async () => {
    const { api, created } = fakeApi();
    const id = await createGroupReminder(api, new ZaloSender(0), "zg-1", REQUEST, false);
    assert.equal(id, "r-new");
    assert.deepEqual(created, [REQUEST]);
  });

  test("lượt thử lại: nhóm đã có nhắc hẹn cùng tiêu đề + giờ thì không tạo trùng", async () => {
    const { api, created } = fakeApi([{ id: "r-old", startTime: REQUEST.startTime, params: { title: REQUEST.title } }]);
    assert.equal(await createGroupReminder(api, new ZaloSender(0), "zg-1", REQUEST, true), "r-old");
    assert.equal(created.length, 0);
  });

  test("lượt thử lại: khác giờ hoặc khác tiêu đề thì vẫn tạo", async () => {
    const { api, created } = fakeApi([{ id: "r-x", startTime: REQUEST.startTime + 60_000, params: { title: REQUEST.title } }, { id: "r-y", startTime: REQUEST.startTime, params: { title: "Khác" } }]);
    assert.equal(await createGroupReminder(api, new ZaloSender(0), "zg-1", REQUEST, true), "r-new");
    assert.equal(created.length, 1);
  });

  test("bot tắt khẩn: hàng gửi từ chối, KHÔNG gọi Zalo", async () => {
    const { api, created } = fakeApi();
    await assert.rejects(createGroupReminder(api, new ZaloSender(0, () => true), "zg-1", REQUEST, false), BotHaltedError);
    assert.equal(created.length, 0);
  });
});
