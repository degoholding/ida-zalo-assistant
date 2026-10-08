import assert from "node:assert/strict";
import { test } from "node:test";
import { pickRunnable, retryDelayMs } from "./job-queue.js";

const job = (id: number, serialKey: string | null) => ({ id, serialKey });

test("a serial key that is already running elsewhere blocks every queued job with that key", () => {
  const picked = pickRunnable([job(1, "thread:5"), job(2, "thread:5"), job(3, "thread:6")], new Set(["thread:5"]), 10);
  assert.deepEqual(picked.map((item) => item.id), [3]);
});

test("only the oldest job per serial key is taken in one claim, the rest wait their turn", () => {
  const picked = pickRunnable([job(1, "thread:5"), job(2, "thread:5"), job(3, null), job(4, "thread:6"), job(5, "thread:6")], new Set(), 10);
  assert.deepEqual(picked.map((item) => item.id), [1, 3, 4]);
});

test("jobs without a serial key never block each other", () => {
  const picked = pickRunnable([job(1, null), job(2, null), job(3, null)], new Set(), 10);
  assert.deepEqual(picked.map((item) => item.id), [1, 2, 3]);
});

test("the limit caps how many jobs are taken even when more are runnable", () => {
  assert.equal(pickRunnable([job(1, null), job(2, null), job(3, null)], new Set(), 2).length, 2);
  assert.equal(pickRunnable([job(1, null)], new Set(), 0).length, 0);
});

test("an empty candidate list gives nothing", () => {
  assert.deepEqual(pickRunnable([], new Set(["x"]), 5), []);
});

test("retry delay grows with attempts and is capped at ten minutes", () => {
  assert.equal(retryDelayMs(1), 10_000);
  assert.equal(retryDelayMs(2), 40_000);
  assert.equal(retryDelayMs(3), 90_000);
  assert.equal(retryDelayMs(100), 600_000);
  // Số lần thử bất thường (0, âm) không ra khoảng chờ 0 — tránh thử lại dồn dập
  assert.equal(retryDelayMs(0), 10_000);
  assert.equal(retryDelayMs(-3), 10_000);
});
