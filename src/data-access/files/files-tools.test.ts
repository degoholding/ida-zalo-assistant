import assert from "node:assert/strict";
import { test } from "node:test";
import { AttachmentStatus } from "../../constants.js";
import { fakeDb, makeCtx, manager, rejects } from "../data-access-test-support.js";
import type { DataAccessContext } from "../data-access-context.js";
import { fileReadPrepareTool } from "./file-read-prepare-tools.js";
import { fileSendCheckTool } from "./file-send-check-tools.js";
import { fileTextStoreTool } from "./file-text-store-tools.js";
import { linkSharedCheckTool } from "./link-shared-check-tools.js";
import { searchFilesCore } from "../operations/search-files-operation.js";
import { runTool } from "../tool-runner.js";
import { DataAccessError } from "../data-access-errors.js";
import type { ContactActor } from "../actors/contact-actor.js";

// Công cụ họ `files` ở lõi, KHÔNG DB thật: «DB» giả trả dòng theo mẫu câu SQL. Vàng cũ / mới trên MySQL thật nằm ở test/assistant-mcp-files.integration.test.ts.

const actor = { contactId: 4, uid: "u-asker" } as ContactActor;
/** Câu kiểm quyền (assertAttachmentReadable) có `a.id = ?`; bản nới Mật không còn «is_confidential = 0». */
const readableSql = (sql: string) => /FROM attachment a JOIN zalo_group g/.test(sql);
const ctxWith = (reply: (sql: string, params: unknown[]) => unknown[], overrides: Partial<DataAccessContext> = {}) => {
  const rig = fakeDb(reply);
  return { rig, ctx: makeCtx(manager({ groupIds: null }), { contactActor: actor, ...overrides }, rig.db) };
};

test("file_text_store: tệp ngoài phạm vi → not_found và KHÔNG có câu INSERT nào (không dòng attachment_text)", async () => {
  const { rig, ctx } = ctxWith(() => []);
  const result = await runTool(fileTextStoreTool as never, ctx, { attachment_id: 5, method: "text", text: "abc", summary: "s", input_tokens: 0, output_tokens: 0 });
  assert.equal(result.isError, true);
  assert.equal(result.errorCode, "not_found");
  assert.deepEqual(rig.queries.filter((query) => /INSERT/.test(query.sql)), []);
});

test("file_text_store: tệp đọc được → ghi cache; unsupported ghi text NULL, char_count 0", async () => {
  const { rig, ctx } = ctxWith((sql) => (readableSql(sql) ? [{ 1: 1 }] : []));
  const ok = await runTool(fileTextStoreTool as never, ctx, { attachment_id: 5, method: "docx", text: "xin chào", summary: "docx", input_tokens: 3, output_tokens: 4 });
  assert.equal(ok.isError, false);
  const insert = rig.queries.find((query) => /INSERT INTO attachment_text/.test(query.sql))!;
  assert.deepEqual(insert.params, [5, "docx", 8, "docx", "xin chào", 3, 4]);
  await runTool(fileTextStoreTool as never, ctx, { attachment_id: 6, method: "unsupported", text: null, summary: "không đọc được", input_tokens: 0, output_tokens: 0 });
  const second = rig.queries.filter((query) => /INSERT INTO attachment_text/.test(query.sql))[1];
  assert.deepEqual(second.params, [6, "unsupported", 0, "không đọc được", null, 0, 0]);
});

test("file_text_store: chữ quá 200 000 ký tự bị từ chối ở sơ đồ", async () => {
  const { ctx } = ctxWith(() => [{ 1: 1 }]);
  const result = await runTool(fileTextStoreTool as never, ctx, { attachment_id: 5, method: "text", text: "x".repeat(200_001), summary: "", input_tokens: 0, output_tokens: 0 });
  assert.equal(result.errorCode, "invalid_value");
});

test("file_read_prepare: ngoài phạm vi = «Không có tệp này»; Mật chặn = confidential; ngoài nhóm đang hỏi = «Không có tệp này»", async () => {
  const none = ctxWith(() => []);
  assert.equal((await runTool(fileReadPrepareTool as never, none.ctx, { attachment_id: 5 })).errorCode, "not_found");
  // Chỉ bản nới Mật thấy tệp (câu có «is_confidential = 0» là bản chặt) ⇒ bị Mật chặn
  const row = { id: 5, group_id: 9, file_name: "a.xlsx", file_ext: "xlsx", status: 1, storage_key: "k/a", stored_bytes: 10, source_url: "https://zalo/x", method: null, summary: null, text: null, char_count: null };
  const secret = ctxWith((sql) => (readableSql(sql) ? (/is_confidential = 0/.test(sql) ? [] : [{ 1: 1 }]) : [row]), { includeConfidential: false });
  const blocked = await runTool(fileReadPrepareTool as never, secret.ctx, { attachment_id: 5 });
  assert.equal(blocked.errorCode, "confidential");
  assert.match(blocked.text, /chế độ Mật/);
  const other = ctxWith((sql) => (readableSql(sql) ? [{ 1: 1 }] : [row]), { groupScopeId: 77 });
  assert.equal((await runTool(fileReadPrepareTool as never, other.ctx, { attachment_id: 5 })).errorCode, "not_found");
});

test("file_read_prepare: trả dòng tệp + chữ cache + cờ link tải lại được (không lộ link)", async () => {
  const row = { id: 5, group_id: 9, file_name: "a.xlsx", file_ext: "xlsx", status: 1, storage_key: "k/a", stored_bytes: 10, source_url: "https://zalo/x", method: "xlsx", summary: "s", text: "chữ", char_count: 3 };
  const { ctx } = ctxWith((sql) => (readableSql(sql) ? [{ 1: 1 }] : [row]));
  const result = await runTool(fileReadPrepareTool as never, ctx, { attachment_id: 5 });
  assert.equal(result.isError, false);
  const data = result.structured as { source_retryable: boolean; cached: { text: string }; storage_key: string };
  assert.equal(data.source_retryable, true);
  assert.equal(data.cached.text, "chữ");
  assert.doesNotMatch(JSON.stringify(result.structured), /zalo\/x/);
});

test("file_send_check: tệp chưa vào kho → invalid_state; vào kho → effects.filesToSend", async () => {
  const stored = (status: number) => ctxWith((sql) => (readableSql(sql) ? [{ 1: 1 }] : [{ id: 5, file_name: "a.xlsx", status }]));
  const notStored = await runTool(fileSendCheckTool as never, stored(AttachmentStatus.Skipped).ctx, { attachment_id: 5 });
  assert.equal(notStored.errorCode, "invalid_state");
  const ok = await runTool(fileSendCheckTool as never, stored(AttachmentStatus.Stored).ctx, { attachment_id: 5 });
  assert.deepEqual(ok.structured, { queued: true, name: "a.xlsx" });
  assert.deepEqual(ok.effects, { filesToSend: [5] });
});

test("link_shared_check: link hỏng → invalid_value; có tin chứa link trong phạm vi → shared; mẫu LIKE được thoát", async () => {
  const none = ctxWith(() => []);
  assert.equal((await runTool(linkSharedCheckTool as never, none.ctx, { url: "không phải link" })).errorCode, "invalid_value");
  assert.deepEqual((await runTool(linkSharedCheckTool as never, none.ctx, { url: "https://x.com/a_b%c" })).structured, { shared: false });
  assert.deepEqual(none.rig.queries.at(-1)!.params[0], "%x.com/a\\_b\\%c%");
  const hit = ctxWith(() => [{ 1: 1 }], { groupScopeId: 3 });
  assert.deepEqual((await runTool(linkSharedCheckTool as never, hit.ctx, { url: "https://x.com/a" })).structured, { shared: true });
  assert.equal(hit.rig.queries.at(-1)!.params.at(-1), 3, "hỏi trong nhóm: chỉ tin của nhóm");
});

test("search_files lõi: từ khóa AND trên tên + chú thích + chữ đã bóc; không từ khóa = tệp của người hỏi; che bật chặn dò ≥ 9 số (BC2)", async () => {
  const words = ctxWith(() => []);
  await searchFilesCore(words.ctx, { query: "bao gia thanh cong" });
  const sql = words.rig.queries[0].sql;
  assert.equal((sql.match(/a\.file_name LIKE \? OR m\.text LIKE \? OR t\.text LIKE \?/g) ?? []).length, 4);
  assert.match(sql, /LEFT JOIN attachment_text t/);
  const empty = ctxWith(() => []);
  await searchFilesCore(empty.ctx, { query: "" });
  assert.deepEqual(empty.rig.queries[0].params.slice(0, 2), ["u-asker", "u-asker"]);
  const group = ctxWith(() => [], { groupScopeId: 12 });
  await searchFilesCore(group.ctx, { query: "", group_id: 99 });
  assert.match(group.rig.queries[0].sql, /1 = 1/);
  assert.deepEqual(group.rig.queries[0].params.slice(0, 2), [12, 12], "nhóm đang hỏi đè group_id mô hình truyền");
  const masked = ctxWith(() => [], { maskPersonal: true });
  await assert.rejects(searchFilesCore(masked.ctx, { query: "0912345678" }), (error: unknown) => error instanceof DataAccessError && error.code === "invalid_value");
  assert.deepEqual(masked.rig.queries, []);
  rejects(() => { throw new DataAccessError("not_found", "x"); }, "not_found");
});
