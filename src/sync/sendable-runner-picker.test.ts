import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../db/pool.js";
import { JobSkippedError } from "../jobs/job-skipped-error.js";
import { noSendableRunnerError, pickSendableRunner } from "./sendable-runner-picker.js";

const assistant = (name: string) => ({ name, isCollectOnly: false });
const normal = (name: string) => ({ name, isCollectOnly: true });

test("chọn runner Trợ lý đầu tiên trong danh sách ưu tiên, bỏ qua runner Normal và chỗ trống", () => {
  const picked = pickSendableRunner([undefined, normal("n1"), assistant("a1"), assistant("a2")]);
  assert.equal(picked?.name, "a1");
});

test("không lùi về «runner đầu tiên» khi nó là tài khoản Normal: ưu tiên rỗng thì lấy runner Trợ lý đầu tiên của cả hệ thống", () => {
  const picked = pickSendableRunner([normal("n1")], [normal("n1"), normal("n2"), assistant("a9")]);
  assert.equal(picked?.name, "a9");
});

test("chỉ có runner Normal: không chọn ai (null)", () => {
  assert.equal(pickSendableRunner([normal("n1")], [normal("n1"), normal("n2")]), null);
  assert.equal(pickSendableRunner([], []), null);
});

test("hết runner gửi được: DB không còn bot Trợ lý dùng được → bỏ việc (JobSkippedError); còn → lỗi thường để thử lại", async () => {
  const dbWith = (usable: number) => ({ query: async () => [[{ n: usable }]] }) as unknown as Db;
  const skipped = await noSendableRunnerError(dbWith(0), "nhắn người nhận");
  assert.ok(skipped instanceof JobSkippedError);
  assert.match(skipped.message, /chỉ thu thập dữ liệu/);
  const transient = await noSendableRunnerError(dbWith(2), "nhắn người nhận");
  assert.ok(!(transient instanceof JobSkippedError));
});
