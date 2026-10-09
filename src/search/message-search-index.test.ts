import assert from "node:assert/strict";
import { test } from "node:test";
import { nextBackfillRange } from "./message-search-index.js";
import { relevantIndexedFrom } from "./message-search.js";

test("nextBackfillRange: lô đi từ mốc xuống, không bao giờ dưới id 1, lô cuối ngắn hơn", () => {
  assert.deepEqual(nextBackfillRange(12_000, 5000), { low: 7001, high: 12_000 });
  assert.deepEqual(nextBackfillRange(7000, 5000), { low: 2001, high: 7000 });
  assert.deepEqual(nextBackfillRange(2000, 5000), { low: 1, high: 2000 });
  assert.deepEqual(nextBackfillRange(1, 5000), { low: 1, high: 1 });
});

test("relevantIndexedFrom: chỉ báo «đang chép tin cũ» khi lần tìm có xét tới tin cũ hơn mốc đã chép", () => {
  const indexed = new Date("2026-08-01T00:00:00Z");
  assert.equal(relevantIndexedFrom(null, undefined), null);
  assert.equal(relevantIndexedFrom(indexed, undefined), indexed);
  assert.equal(relevantIndexedFrom(indexed, new Date("2026-01-01T00:00:00Z")), indexed);
  // Người tìm chỉ xét từ sau mốc — kết quả đã đủ, không báo
  assert.equal(relevantIndexedFrom(indexed, new Date("2026-09-01T00:00:00Z")), null);
  assert.equal(relevantIndexedFrom(indexed, indexed), null);
});
