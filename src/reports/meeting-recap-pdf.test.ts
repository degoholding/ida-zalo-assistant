import assert from "node:assert/strict";
import { test } from "node:test";
import { RecapInputError, normalizePriority, normalizeRecap } from "./meeting-recap-input.js";
import { renderRecapPdf } from "./meeting-recap-pdf.js";
import { toTextRuns } from "./pdf-text-runs.js";
import { recapFileName, reportFileExtension } from "./report-exporter.js";

const NOW = new Date("2026-10-06T03:00:00Z");

const ARGS = {
  title: "Recap họp giao ban dự án K52",
  meeting_date: "6/10/2026",
  tldr: ["Chốt **giá bán lẻ** trước 10/10", "Đẩy mạnh kênh Shopee"],
  tasks: [
    { task: "Gửi báo giá", owner: "Gia Bảo", due: "08/10/2026", priority: "high" },
    { task: "", owner: "An" },
    { task: "Kiểm kho", priority: "thấp" },
  ],
  decisions: ["Giữ nhà cung cấp cũ ✓"],
  sections: [{ heading: "Kênh bán", bullets: ["Shopee ↔ TikTok"], table: { columns: ["Kênh", "Doanh thu"], rows: [["Shopee", "120tr"]] } }],
};

test("normalizeRecap: chuẩn hóa việc, ưu tiên, mã văn bản", () => {
  const recap = normalizeRecap(ARGS, NOW);
  assert.equal(recap.docCode, "RECAP-GIAO-BAN-DU-AN-K52-2026.10.06");
  assert.deepEqual(recap.tasks, [
    { task: "Gửi báo giá", owner: "Gia Bảo", due: "08/10/2026", priority: "Cao" },
    { task: "Kiểm kho", owner: "(chưa rõ)", due: "", priority: "Thấp" },
  ]);
  assert.equal(recap.format, "Google Meet");
  assert.equal(normalizePriority("whatever"), "TB");
});

test("normalizeRecap: thiếu tiêu đề hoặc nội dung thì báo lỗi cho mô hình", () => {
  assert.throws(() => normalizeRecap({ tldr: ["x"] }, NOW), RecapInputError);
  assert.throws(() => normalizeRecap({ title: "Họp" }, NOW), RecapInputError);
});

test("toTextRuns: tô màu cụm **…** và đổi font cho ký hiệu thiếu nét", () => {
  const coverage = { fontFor: (char: string) => (char === "✓" ? "Symbols" : "Main") };
  assert.deepEqual(toTextRuns("Chốt **giá** ✓", coverage, "#123", "Main"), [
    { text: "Chốt " }, { text: "giá", color: "#123" }, { text: " " }, { text: "✓", font: "Symbols" },
  ]);
});

test("recapFileName: bỏ dấu, bỏ chữ «Recap họp» lặp, kèm ngày + phiên bản", () => {
  const recap = normalizeRecap(ARGS, NOW);
  assert.equal(recapFileName(recap, NOW), "Meeting-Recap-giao-ban-du-an-K52-2026.10.06-v1.0.pdf");
  assert.equal(reportFileExtension("a.b.PDF"), "pdf");
});

test("renderRecapPdf: ra tệp PDF thật", async () => {
  const data = await renderRecapPdf(normalizeRecap(ARGS, NOW));
  assert.equal(data.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(data.length > 10_000);
});
