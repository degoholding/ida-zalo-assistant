import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as XLSX from "xlsx";
import { extractSheet } from "../assistant/file-reader.js";
import { CpuPool } from "./cpu-pool.js";

function buildWorkbook(rows: (string | number)[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Doanh số");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const pool = new CpuPool(1, 20_000);
after(() => pool.close());

test("a spreadsheet read on the worker thread gives exactly what the main thread would give", async () => {
  const data = buildWorkbook([["Nhân viên", "Doanh số"], ["Duy", 1200], ["Hân", 950]]);
  const result = await pool.run("sheet", data);
  assert.deepEqual(result, extractSheet(data));
  assert.match(result.text, /Duy \| 1200/);
});

test("a corrupt file rejects with a message instead of killing the pool, and the next job still works", async () => {
  await assert.rejects(pool.run("docx", Buffer.from("không phải tệp zip")));
  const data = buildWorkbook([["A"], ["sau lỗi vẫn chạy"]]);
  assert.match((await pool.run("sheet", data)).text, /sau lỗi vẫn chạy/);
});

test("several jobs queued at once on a single thread all finish, in any order", async () => {
  const files = [1, 2, 3, 4].map((n) => buildWorkbook([["Số"], [n * 111]]));
  const results = await Promise.all(files.map((file) => pool.run("sheet", file)));
  assert.deepEqual(results.map((result) => /\d{3}/.exec(result.text)?.[0]), ["111", "222", "333", "444"]);
});

test("a job that runs past the time limit is cut off with a clear message", async () => {
  const slowPool = new CpuPool(1, 1);
  try {
    // 1 ms không đủ để luồng phụ khởi động + bóc — chắc chắn quá giờ
    await assert.rejects(slowPool.run("sheet", buildWorkbook([["x"]])), /quá/);
  } finally {
    await slowPool.close();
  }
});

test("a closed pool refuses new work", async () => {
  const closed = new CpuPool(1);
  await closed.close();
  await assert.rejects(closed.run("sheet", Buffer.alloc(0)), /đã đóng/);
});
