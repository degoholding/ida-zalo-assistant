import assert from "node:assert/strict";
import { test } from "node:test";
import { FailureWindow, McpRateLimiter } from "./mcp-rate-limiter.js";

test("thùng token: lượt thứ 61 trong một phút bị từ chối, kèm số giây chờ", () => {
  let now = 1_000_000;
  const limiter = new McpRateLimiter({ perMinute: 60, maxConcurrent: 100 }, () => now);
  for (let index = 0; index < 60; index++) {
    const taken = limiter.take(1);
    assert.ok(taken.ok, `lượt ${index + 1}`);
    if (taken.ok) taken.release();
  }
  const rejected = limiter.take(1);
  assert.ok(!rejected.ok && rejected.reason === "rate" && rejected.retryAfterSeconds >= 1);
  now += 1_000; // 1 giây hoàn lại đúng 1 token
  assert.ok(limiter.take(1).ok);
});

test("thùng token: khóa khác không bị ảnh hưởng; đầy lại sau một phút", () => {
  let now = 0;
  const limiter = new McpRateLimiter({ perMinute: 2, maxConcurrent: 100 }, () => now);
  limiter.take(1); limiter.take(1);
  assert.ok(!limiter.take(1).ok);
  assert.ok(limiter.take(2).ok);
  now += 60_000;
  assert.ok(limiter.take(1).ok && limiter.take(1).ok);
});

test("đồng thời: quá trần thì từ chối, release mở chỗ; release hai lần không đếm trừ hai", () => {
  const limiter = new McpRateLimiter({ perMinute: 100, maxConcurrent: 2 });
  const first = limiter.take(1);
  const second = limiter.take(1);
  assert.ok(first.ok && second.ok);
  const blocked = limiter.take(1);
  assert.ok(!blocked.ok && blocked.reason === "concurrent");
  if (first.ok) { first.release(); first.release(); }
  assert.ok(limiter.take(1).ok);
  assert.ok(!limiter.take(1).ok, "release lặp không được mở thêm chỗ");
});

test("FailureWindow: chặn sau đủ số lần sai, hết cửa sổ 60 giây thì mở lại, IP khác không bị chặn", () => {
  let now = 0;
  const failures = new FailureWindow(3, () => now);
  for (let index = 0; index < 3; index++) {
    assert.equal(failures.isBlocked("1.1.1.1"), false);
    failures.recordFailure("1.1.1.1");
  }
  assert.equal(failures.isBlocked("1.1.1.1"), true);
  assert.equal(failures.isBlocked("2.2.2.2"), false);
  now += 60_000;
  assert.equal(failures.isBlocked("1.1.1.1"), false);
});
