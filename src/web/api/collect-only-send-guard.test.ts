import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../../db/pool.js";
import { COLLECT_ONLY_MESSAGE, CollectOnlyAccountError } from "../../zalo/collect-only-account-error.js";
import { ApiError } from "./api-http.js";
import { assertThreadSendable, mapCollectOnlyError } from "./collect-only-send-guard.js";

const dbReturning = (collectOnly: number | null): Db =>
  ({ query: async () => [collectOnly === null ? [] : [{ collect_only: collectOnly }]] }) as unknown as Db;

test("ô soạn: cuộc chỉ lưu bị từ chối 409 kèm câu «Bot này chỉ thu thập dữ liệu, không gửi được»", async () => {
  await assert.rejects(assertThreadSendable(dbReturning(1), 7), (error) =>
    error instanceof ApiError && error.status === 409 && error.code === "collect_only" && error.message === COLLECT_ONLY_MESSAGE);
});

test("ô soạn: cuộc có bot Trợ lý (hoặc không tồn tại) không bị chặn ở bước kiểm này", async () => {
  await assertThreadSendable(dbReturning(0), 7);
  await assertThreadSendable(dbReturning(null), 7);
});

test("lỗi chặn gửi của tài khoản Normal đổi thành 409; lỗi khác để nguyên", () => {
  const mapped = mapCollectOnlyError(new CollectOnlyAccountError());
  assert.equal(mapped?.status, 409);
  assert.equal(mapped?.message, COLLECT_ONLY_MESSAGE);
  assert.equal(mapCollectOnlyError(new Error("Zalo từ chối")), null);
});
