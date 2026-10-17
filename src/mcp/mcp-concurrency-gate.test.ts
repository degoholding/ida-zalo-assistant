import assert from "node:assert/strict";
import { test } from "node:test";
import { ConcurrencyGate } from "./mcp-concurrency-gate.js";

test("trong trần thì vào ngay; vượt trần thì xếp hàng rồi nhận chỗ khi có người nhả (theo thứ tự)", async () => {
  const gate = new ConcurrencyGate(2, 1000);
  const first = await gate.acquire();
  const second = await gate.acquire();
  assert.ok(first.ok && second.ok);
  assert.equal(gate.inFlight, 2);
  const order: string[] = [];
  const thirdPending = gate.acquire().then((result) => { order.push("third"); return result; });
  const fourthPending = gate.acquire().then((result) => { order.push("fourth"); return result; });
  assert.equal(gate.waiting, 2);
  if (first.ok) first.release();
  const third = await thirdPending;
  assert.ok(third.ok);
  assert.equal(gate.inFlight, 2, "chỗ chuyển thẳng cho người chờ, không tụt xuống");
  if (second.ok) second.release();
  const fourth = await fourthPending;
  assert.ok(fourth.ok);
  assert.deepEqual(order, ["third", "fourth"]);
  if (third.ok) third.release();
  if (fourth.ok) fourth.release();
  assert.equal(gate.inFlight, 0);
});

test("chờ quá hạn → ok:false và rời hàng; chỗ nhả sau đó không bị mất", async () => {
  const gate = new ConcurrencyGate(1, 20);
  const holder = await gate.acquire();
  assert.ok(holder.ok);
  const timedOut = await gate.acquire();
  assert.equal(timedOut.ok, false);
  assert.equal(gate.waiting, 0);
  if (holder.ok) holder.release();
  assert.equal(gate.inFlight, 0);
  assert.ok((await gate.acquire()).ok);
});

test("release gọi lặp không nhả quá số chỗ", async () => {
  const gate = new ConcurrencyGate(1, 20);
  const first = await gate.acquire();
  assert.ok(first.ok);
  if (first.ok) { first.release(); first.release(); }
  const second = await gate.acquire();
  assert.ok(second.ok);
  assert.equal((await gate.acquire()).ok, false, "chỉ có 1 chỗ");
});
