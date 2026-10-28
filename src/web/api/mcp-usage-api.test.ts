import assert from "node:assert/strict";
import { test } from "node:test";
import { McpCallSource } from "../../constants.js";
import { parseUsageParams, usageStart } from "./mcp-usage-api.js";

test("tham số thống kê: mặc định 7 ngày / theo khóa / chỉ cổng ngoài; ngoài 1–90, số lẻ, nhóm / nguồn lạ → 422", () => {
  assert.deepEqual(parseUsageParams(new URLSearchParams()), { days: 7, groupBy: "key", sources: [McpCallSource.Http] });
  assert.deepEqual(parseUsageParams(new URLSearchParams("days=90&group=user&source=all")).sources,
    [McpCallSource.Http, McpCallSource.Assistant, McpCallSource.AssistantCommand]);
  for (const query of ["days=0", "days=91", "days=-1", "days=1.5", "days=abc", "group=tool", "source=web", "group=key%27--"]) {
    assert.throws(() => parseUsageParams(new URLSearchParams(query)), (error: { status?: number }) => error.status === 422, query);
  }
});

test("mốc bắt đầu = 00:00 giờ VN của ngày đầu khoảng (đổi về UTC), kể cả lúc UTC còn ngày hôm trước", () => {
  // 28/10 08:00 VN = 28/10 01:00 UTC → 7 ngày = từ 22/10 00:00 VN = 21/10 17:00 UTC
  assert.equal(usageStart(new Date("2026-10-28T01:00:00Z"), 7).toISOString(), "2026-10-21T17:00:00.000Z");
  // 28/10 23:30 VN = 28/10 16:30 UTC; 1 ngày = từ 28/10 00:00 VN
  assert.equal(usageStart(new Date("2026-10-28T16:30:00Z"), 1).toISOString(), "2026-10-27T17:00:00.000Z");
  // 29/10 00:30 VN = 28/10 17:30 UTC → đã sang ngày 29 VN
  assert.equal(usageStart(new Date("2026-10-28T17:30:00Z"), 1).toISOString(), "2026-10-28T17:00:00.000Z");
});
