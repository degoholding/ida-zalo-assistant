import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../db/pool.js";
import { SEARCH_MESSAGES_DECLARATION, runSearchMessages } from "./search-messages-tool.js";

// CSDL giả: ném lỗi nếu bị gọi — chứng minh nhánh kiểm tham số trả lời trước khi chạm DB
const untouchableDb = { query: () => { throw new Error("không được chạm CSDL"); } } as unknown as Db;

test("search_messages: không query và không mentions_me → báo thiếu, không chạm CSDL", async () => {
  const result = await runSearchMessages({ db: untouchableDb, askerUid: "u1" }, {});
  assert.match(String(result.error), /mentions_me/);
});

test("search_messages: khai mentions_me cho «ai nhắc tới tôi», query không còn bắt buộc", () => {
  const parameters = SEARCH_MESSAGES_DECLARATION.parameters as { properties: Record<string, unknown>; required: string[] };
  assert.ok(parameters.properties.mentions_me);
  assert.deepEqual(parameters.required, []);
});
