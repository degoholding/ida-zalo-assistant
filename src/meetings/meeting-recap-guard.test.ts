import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRecordingGuards, estimateRecapTokens, exceedsDailyCap, type GuardInput } from "./meeting-recap-guard.js";

const ROW: GuardInput = { fileName: "x.mp3", meetingTitle: "Giao ban K52", sizeBytes: 50 * 1024 * 1024, requesterUid: "uid-1" };
const BASE_CONFIG = { isConfidentialGroup: false, maxBytes: 150 * 1024 * 1024, hasAudioModel: true };

test("guard: nhóm Mật → Skipped kèm tin RIÊNG người đặt, không gửi vào nhóm", () => {
  const result = checkRecordingGuards(ROW, { ...BASE_CONFIG, isConfidentialGroup: true });
  assert.equal(result?.reason, "confidential");
  assert.equal(result?.notifyRequesterOnly, true);
  assert.ok(result?.notice?.includes("Mật"));
});

test("guard: nhóm Mật nhưng cuộc họp cũ không có requester → chỉ ghi log, không có tin gửi", () => {
  const result = checkRecordingGuards({ ...ROW, requesterUid: null }, { ...BASE_CONFIG, isConfidentialGroup: true });
  assert.equal(result?.reason, "confidential");
  assert.equal(result?.notice, null);
});

test("guard: quá cỡ tệp → Skipped kèm tin nói rõ dung lượng", () => {
  const result = checkRecordingGuards({ ...ROW, sizeBytes: 230 * 1024 * 1024 }, { ...BASE_CONFIG, maxBytes: 150 * 1024 * 1024 });
  assert.equal(result?.reason, "too_large");
  assert.equal(result?.notice, "Ghi âm 230 MB, quá mức 150 MB — cắt nhỏ hoặc nâng trần ở Cài đặt.");
  assert.equal(result?.notifyRequesterOnly, false);
});

test("guard: chưa có khóa AI nghe ghi âm dài → Skipped", () => {
  const result = checkRecordingGuards(ROW, { ...BASE_CONFIG, hasAudioModel: false });
  assert.equal(result?.reason, "no_ai_key");
});

test("guard: qua hết điều kiện → null (xử lý tiếp)", () => {
  assert.equal(checkRecordingGuards(ROW, BASE_CONFIG), null);
});

test("guard: thứ tự kiểm — Mật đứng trước cỡ tệp dù tệp cũng quá cỡ", () => {
  const result = checkRecordingGuards({ ...ROW, sizeBytes: 999 * 1024 * 1024 }, { ...BASE_CONFIG, isConfidentialGroup: true, maxBytes: 1 });
  assert.equal(result?.reason, "confidential");
});

test("estimateRecapTokens: họp 60 phút ≈ 115 nghìn token nghe + hệ số an toàn 1,5 + phí cố định 20 nghìn", () => {
  // 60 phút * 60 giây * 32 token/giây = 115.200 (chốt phase-04) * 1,5 + 20.000 = 192.800
  assert.equal(estimateRecapTokens(60), 192_800);
});

test("estimateRecapTokens: tối thiểu tính như họp 30 phút dù lịch ghi ngắn hơn / 0 phút", () => {
  assert.equal(estimateRecapTokens(5), estimateRecapTokens(30));
  assert.equal(estimateRecapTokens(0), estimateRecapTokens(30));
});

// H1 (review 10/10/2026): họp đặt lịch ngắn nhưng ghi âm thật dài hơn nhiều (vd ghép nhiều đoạn) — ước theo CỠ TỆP phải
// thắng để không bị ước thiếu 3–5 lần.
test("estimateRecapTokens: ghi âm 150 MB (ước ~2,5 giờ ở 16 KB/s) thắng ước theo lịch 30 phút", () => {
  const bySchedule = estimateRecapTokens(30, 0);
  const bySize = estimateRecapTokens(30, 150 * 1024 * 1024);
  assert.ok(bySize > bySchedule, `${bySize} phải > ${bySchedule}`);
  // 150 MB / 16 KB/s = 9600 giây ≈ 160 phút — khớp công thức ước theo phút
  assert.equal(bySize, estimateRecapTokens(160));
});

test("estimateRecapTokens: tệp nhỏ hơn mức ước theo lịch thì vẫn lấy số theo lịch (không ước THIẾU so với lịch)", () => {
  assert.equal(estimateRecapTokens(60, 1024), estimateRecapTokens(60));
});

test("estimateRecapTokens: sizeBytes bỏ trống / 0 coi như cũ (không đổi hành vi khi nơi gọi chưa truyền)", () => {
  assert.equal(estimateRecapTokens(45), estimateRecapTokens(45, 0));
});

test("exceedsDailyCap: vượt phần còn lại của trần ngày thì true; trần 0 = không giới hạn", () => {
  assert.equal(exceedsDailyCap(100_000, 2_950_000, 3_000_000), true);
  assert.equal(exceedsDailyCap(50_000, 2_900_000, 3_000_000), false);
  assert.equal(exceedsDailyCap(1_000_000_000, 0, 0), false);
});
