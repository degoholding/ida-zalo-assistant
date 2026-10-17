import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeDb } from "../data-access/data-access-test-support.js";
import { resolveAskerAccess } from "./asker-access.js";
import { runTool, type ToolContext } from "./tools.js";

// M6 của review: `EXECUTORS[name]` với tên lấy từ mô hình rơi vào prototype của object (`constructor`, `__proto__`…).

async function context(): Promise<ToolContext> {
  const { db } = fakeDb();
  const access = await resolveAskerAccess(db, { id: 1, zalo_uid: "u-1", role: 2 }, { maskPersonal: false });
  return { db, askerUid: "u-1", access, filesToSend: [], now: new Date("2026-10-17T05:00:00Z") };
}

test("tool names that exist only on Object.prototype are rejected like any unknown tool", async () => {
  const ctx = await context();
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "__defineGetter__"]) {
    assert.deepEqual(await runTool(ctx, name, {}), { error: `Không có công cụ ${name}` }, name);
  }
});

test("a real tool name still resolves", async () => {
  const result = await runTool(await context(), "web_search", { query: "x" });
  assert.match(String(result.error), /Tìm web chưa bật/);
});
