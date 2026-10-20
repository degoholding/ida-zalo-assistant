import assert from "node:assert/strict";
import { test } from "node:test";
import { AttachmentTextDeniedError } from "../storage/attachment-text-sql-cache.js";
import { mcpAttachmentTextStore, recordFromPrepare, type FilesCommand } from "./attachment-text-mcp-cache.js";

const prepared = { attachment_id: 5, group_id: 2, file_name: "a.xlsx", file_ext: "xlsx", status: 1, storage_key: "k/5", stored_bytes: 10, source_retryable: false,
  cached: { method: "xlsx", summary: "s", text: "chữ", char_count: 3 } };

test("recordFromPrepare: snake_case → bản ghi store, không cache khi cached null", () => {
  assert.deepEqual(recordFromPrepare(prepared), { attachmentId: 5, fileName: "a.xlsx", fileExt: "xlsx", status: 1, storageKey: "k/5", storedBytes: 10,
    cached: { method: "xlsx", summary: "s", text: "chữ", charCount: 3 } });
  assert.equal(recordFromPrepare({ ...prepared, cached: null, storage_key: null, stored_bytes: null }).cached, null);
});

test("load: lần đầu dùng bản đã chuẩn bị (không gọi công cụ), lần sau gọi lại file_read_prepare; công cụ báo lỗi → null", async () => {
  const calls: string[] = [];
  const call: FilesCommand = async (name) => { calls.push(name); return name === "file_read_prepare" ? { ...prepared, cached: null } : {}; };
  const store = mcpAttachmentTextStore(call, recordFromPrepare(prepared));
  assert.equal((await store.load(5))!.cached!.text, "chữ");
  assert.deepEqual(calls, []);
  assert.equal((await store.load(5))!.cached, null);
  assert.deepEqual(calls, ["file_read_prepare"]);
  assert.equal(await mcpAttachmentTextStore(async () => ({ error: "Không có tệp này." })).load(5), null);
});

test("save: gọi file_text_store đúng tham số; lõi từ chối → AttachmentTextDeniedError (không nuốt lặng)", async () => {
  const sent: Record<string, unknown>[] = [];
  const store = mcpAttachmentTextStore(async (_name, args) => { sent.push(args); return { stored: true, char_count: 3 }; });
  await store.save(5, { method: "text", text: "abc", summary: "s", inputTokens: 1, outputTokens: 2 });
  assert.deepEqual(sent[0], { attachment_id: 5, method: "text", text: "abc", summary: "s", input_tokens: 1, output_tokens: 2 });
  const denied = mcpAttachmentTextStore(async () => ({ error: "Không có tệp này." }));
  await assert.rejects(denied.save(5, { method: "text", text: "abc", summary: "", inputTokens: 0, outputTokens: 0 }), (error: unknown) => error instanceof AttachmentTextDeniedError && /Không có tệp này/.test(error.message));
});
