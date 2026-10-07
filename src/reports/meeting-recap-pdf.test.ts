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

test("bản tóm tắt tài liệu: mã TT-, tên Tom-tat-, kết luận lấy từ conclusions, ra PDF", async () => {
  let captured: import("./meeting-recap-input.js").MeetingRecap | null = null;
  const { runCreateRecapPdf } = await import("../assistant/meeting-recap-tool.js");
  const response = await runCreateRecapPdf(async (recap) => { captured = recap; return { ok: true }; }, {
    title: "Tóm tắt Báo cáo nhân sự 2026", date: "07/10/2026", source: "Google Sheets của Gia Bảo",
    tldr: ["Doanh thu **347,2 tỷ**"], sections: [{ heading: "Kết quả KD", bullets: ["Lãi ròng 18,2 tỷ"] }], conclusions: ["Nợ quá hạn cao"],
  }, NOW, "document");
  assert.deepEqual(response, { ok: true });
  const recap = captured!;
  assert.equal(recap.variant, "document");
  assert.equal(recap.docCode, "TT-BAO-CAO-NHAN-SU-2026-2026.10.07");
  assert.deepEqual(recap.decisions, ["Nợ quá hạn cao"]);
  assert.equal(recap.format, "");
  assert.equal(recapFileName(recap, NOW), "Tom-tat-Bao-cao-nhan-su-2026-2026.10.07-v1.0.pdf");
  const data = await renderRecapPdf(recap);
  assert.equal(data.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("normalizeRecap: tên dài bị cắt không để dư gạch trong mã; tóm tắt tài liệu bắt buộc TL;DR", () => {
  const recap = normalizeRecap({ title: "Báo cáo tổng hợp nhân sự kinh doanh năm 2026 DEGO", tldr: ["x"] }, NOW, "document");
  assert.doesNotMatch(recap.docCode, /--/);
  assert.throws(() => normalizeRecap({ title: "Tài liệu", tasks: [{ task: "Việc" }] }, NOW, "document"), RecapInputError);
});
