import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../db/pool.js";
import { attachedImageNote, questionWithAttachedImage } from "./attached-image-question.js";

const fakeDb = (rows: unknown[]) => ({ query: async () => [rows] }) as unknown as Db;

test("ảnh kèm chú thích: câu hỏi + dòng chỉ đúng mã ảnh để read_file", async () => {
  const question = await questionWithAttachedImage(fakeDb([{ id: 23 }]), 1444, "đọc cái hình này cho anh nha đệ");
  assert.equal(question, `đọc cái hình này cho anh nha đệ\n\n${attachedImageNote(23)}`);
  assert.match(question, /attachment_id = 23/);
});

test("không phải tin ảnh / chưa có mã tin: giữ nguyên câu hỏi", async () => {
  assert.equal(await questionWithAttachedImage(fakeDb([]), 1, "chào em"), "chào em");
  assert.equal(await questionWithAttachedImage(fakeDb([{ id: 5 }]), null, "chào em"), "chào em");
});
