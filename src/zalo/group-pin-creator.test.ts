import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BoardType, type API } from "zca-js";
import { BotHaltedError } from "../messaging/bot-halted-error.js";
import { createGroupPin } from "./group-pin-creator.js";
import { ZaloSender } from "./zalo-sender.js";

const CONTENT = "Cuộc họp: Họp team\nLúc: 15:00 T2 12/10\nLink Google Meet: https://meet.google.com/abc-defg-hij";

function fakeApi(existing: { id: string; title: string; type?: BoardType }[] = []) {
  const created: unknown[] = [];
  const api = {
    createNote: async (input: unknown, groupId: unknown) => { created.push({ input, groupId }); return { id: "n-new" }; },
    getListBoard: async () => ({ items: existing.map((item) => ({ boardType: item.type ?? BoardType.Note, data: { id: item.id, params: { title: item.title } } })) }),
  } as unknown as API;
  return { api, created };
}

describe("createGroupPin", () => {
  test("lượt đầu: ghim thẳng một ghi chú (pinAct) qua hàng gửi, không liệt kê trước", async () => {
    const { api, created } = fakeApi([{ id: "n-old", title: CONTENT }]);
    assert.equal(await createGroupPin(api, new ZaloSender(0), "zg-1", CONTENT, false), "n-new");
    assert.deepEqual(created, [{ input: { title: CONTENT, pinAct: true }, groupId: "zg-1" }]);
  });

  test("lượt thử lại: nhóm đã có ghi chú cùng nội dung (kể cả khác xuống dòng / khoảng trắng đầu cuối) thì không ghim trùng", async () => {
    const { api, created } = fakeApi([{ id: "n-old", title: ` ${CONTENT.replace(/\n/g, "\r\n")} ` }]);
    assert.equal(await createGroupPin(api, new ZaloSender(0), "zg-1", CONTENT, true), "n-old");
    assert.equal(created.length, 0);
  });

  test("lượt thử lại: ghi chú khác nội dung, hoặc không phải ghi chú (bình chọn) thì vẫn ghim", async () => {
    const { api, created } = fakeApi([{ id: "n-x", title: "Khác" }, { id: "p-1", title: CONTENT, type: BoardType.Poll }]);
    assert.equal(await createGroupPin(api, new ZaloSender(0), "zg-1", CONTENT, true), "n-new");
    assert.equal(created.length, 1);
  });

  test("nội dung trống: ném lỗi, không gọi Zalo; bot tắt khẩn: hàng gửi từ chối", async () => {
    const { api, created } = fakeApi();
    await assert.rejects(createGroupPin(api, new ZaloSender(0), "zg-1", "  ", false), /trống/);
    await assert.rejects(createGroupPin(api, new ZaloSender(0, () => true), "zg-1", CONTENT, false), BotHaltedError);
    assert.equal(created.length, 0);
  });
});
