import assert from "node:assert/strict";
import { test } from "node:test";
import { ACK_DELAY_MS } from "./assistant-ack.js";
import { AckTracker } from "./reply-jobs.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a question still waiting in the queue after the ack delay gets exactly one ack", async () => {
  const tracker = new AckTracker();
  let sent = 0;
  tracker.watchQueued(1, async () => { sent += 1; });
  await wait(ACK_DELAY_MS + 100);
  assert.equal(sent, 1);
  // Việc chạy sau đó: trạng thái báo đã nhắn để đường «trả lời lâu» không nhắn lần hai
  assert.equal(tracker.begin(1).acked, true);
  tracker.end(1);
});

test("a queued ack can see that the job has since been answered, so it never lands after the answer", async () => {
  const tracker = new AckTracker();
  let isAnswered: (() => boolean) | null = null;
  tracker.watchQueued(4, async (check) => { isAnswered = check; });
  await wait(ACK_DELAY_MS + 100);
  assert.ok(isAnswered);
  assert.equal(isAnswered!(), false);
  // Tin chờ còn xếp trong hàng gửi; việc chạy và trả lời xong — tới lượt tin chờ phải thấy «đã trả lời» để bỏ
  tracker.begin(4).answered = true;
  tracker.end(4);
  assert.equal(isAnswered!(), true);
});

test("a question picked up before the ack delay is not acked from the queue side", async () => {
  const tracker = new AckTracker();
  let sent = 0;
  tracker.watchQueued(2, async () => { sent += 1; });
  const state = tracker.begin(2);
  await wait(ACK_DELAY_MS + 100);
  assert.equal(sent, 0);
  assert.equal(state.acked, false);
  tracker.end(2);
});

test("a job that starts without having been watched (retry after restart) gets a fresh state", () => {
  const tracker = new AckTracker();
  const state = tracker.begin(99);
  assert.deepEqual({ acked: state.acked, started: state.started }, { acked: false, started: true });
  tracker.end(99);
});

test("a failing ack sender does not throw out of the timer", async () => {
  const tracker = new AckTracker();
  tracker.watchQueued(3, async () => { throw new Error("Zalo lỗi"); });
  await wait(ACK_DELAY_MS + 100);
  tracker.end(3);
});
