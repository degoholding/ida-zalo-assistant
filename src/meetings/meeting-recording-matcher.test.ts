import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pickMeetingForFile, resolveDestination, scanCutoff, RECORDING_SCAN_LOOKBACK_MS,
  type RecordingCandidateMeeting,
} from "./meeting-recording-matcher.js";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function meeting(id: string, title: string, startTime: number, endTime: number, extra: Partial<RecordingCandidateMeeting> = {}): RecordingCandidateMeeting {
  return { id, title, startTime, endTime, ...extra };
}

test("48h cutoff: scanCutoff trừ đúng RECORDING_SCAN_LOOKBACK_MS (48 giờ)", () => {
  assert.equal(RECORDING_SCAN_LOOKBACK_MS, 48 * HOUR);
  const now = new Date("2026-10-10T10:00:00Z");
  assert.equal(scanCutoff(now).getTime(), now.getTime() - 48 * HOUR);
});

test("window edges: khớp đúng biên start và end + 24h, trượt ra ngoài thì không khớp", () => {
  const m = meeting("ev1", "Giao ban", 0, 60 * 60_000); // họp 0 → 1h

  // Đúng lúc bắt đầu — biên dưới
  assert.equal(pickMeetingForFile({ name: "x.mp3", createdAtMs: 0 }, [m]).meeting?.id, "ev1");
  // Đúng mốc end + 24h — biên trên (bao gồm)
  assert.equal(pickMeetingForFile({ name: "x.mp3", createdAtMs: 60 * 60_000 + DAY }, [m]).meeting?.id, "ev1");
  // Quá biên trên 1ms — Unmatched
  assert.equal(pickMeetingForFile({ name: "x.mp3", createdAtMs: 60 * 60_000 + DAY + 1 }, [m]).meeting, null);
  // Trước lúc họp bắt đầu — Unmatched
  assert.equal(pickMeetingForFile({ name: "x.mp3", createdAtMs: -1 }, [m]).meeting, null);
});

test("no match: không có ứng viên nào trong cửa sổ → meeting null, candidates rỗng", () => {
  const result = pickMeetingForFile({ name: "x.mp3", createdAtMs: 10 * DAY }, [meeting("ev1", "Giao ban", 0, HOUR)]);
  assert.deepEqual(result, { meeting: null, candidates: [] });
});

test("tie-break (1): tên tệp chứa tên cuộc họp thắng dù cuộc đó không phải cuộc gần nhất", () => {
  // Hai cuộc liền nhau: «Giao ban K52» 9h-10h, «Review K53» 10h-11h — tệp tải lúc 11h05 (sau cả hai)
  const meetings = [
    meeting("k52", "Giao ban K52", 9 * HOUR, 10 * HOUR),
    meeting("k53", "Review K53", 10 * HOUR, 11 * HOUR),
  ];
  const uploadedAt = 11 * HOUR + 5 * 60_000;
  // Không có tên trong tệp → theo tie-break (2): end lớn nhất → k53
  assert.equal(pickMeetingForFile({ name: "ghi-am.mp3", createdAtMs: uploadedAt }, meetings).meeting?.id, "k53");
  // Tên tệp chứa "k52" (bỏ dấu, không phân biệt hoa thường) → vẫn chọn k52
  assert.equal(pickMeetingForFile({ name: "Giao Ban K52 - ghi âm.mp3", createdAtMs: uploadedAt }, meetings).meeting?.id, "k52");
});

test("tie-break (2): hai cuộc liền nhau, tệp tải sau khi cả hai đã kết thúc → chọn cuộc kết thúc gần nhất (end lớn nhất)", () => {
  const meetings = [
    meeting("a", "Họp A", 9 * HOUR, 10 * HOUR),
    meeting("b", "Họp B", 10 * HOUR, 11 * HOUR),
  ];
  const result = pickMeetingForFile({ name: "rec.mp3", createdAtMs: 11 * HOUR + 30 * 60_000 }, meetings);
  assert.equal(result.meeting?.id, "b");
  assert.equal(result.candidates.length, 2);
});

test("tệp tải trong lúc họp đang diễn ra → khớp đúng cuộc đó dù không có cuộc nào khác", () => {
  const m = meeting("ongoing", "Họp đang diễn ra", 9 * HOUR, 11 * HOUR);
  assert.equal(pickMeetingForFile({ name: "rec.mp3", createdAtMs: 10 * HOUR }, [m]).meeting?.id, "ongoing");
});

test("tie-break (3): nhiều cuộc đang diễn ra cùng lúc (chưa cuộc nào kết thúc) → chọn cuộc bắt đầu muộn nhất", () => {
  const meetings = [
    meeting("early", "Họp sớm", 8 * HOUR, 12 * HOUR),
    meeting("late", "Họp muộn", 10 * HOUR, 12 * HOUR),
  ];
  const result = pickMeetingForFile({ name: "rec.mp3", createdAtMs: 11 * HOUR }, meetings);
  assert.equal(result.meeting?.id, "late");
});

test("tệp tải sau 24h kể từ lúc họp kết thúc → Unmatched", () => {
  const m = meeting("old", "Họp cũ", 0, HOUR);
  const result = pickMeetingForFile({ name: "rec.mp3", createdAtMs: HOUR + DAY + HOUR }, [m]);
  assert.equal(result.meeting, null);
});

test("resolveDestination: scope=group-<id> → nhóm, dù có requester kèm theo", () => {
  const m = meeting("g1", "Họp nhóm", 0, HOUR, { scopeTag: "group-91", requesterUid: "uid-1" });
  assert.deepEqual(resolveDestination(m), { kind: "group", targetThreadId: 91, requesterUid: "uid-1" });
});

test("resolveDestination: không scope, có requester → gửi riêng người đặt", () => {
  const m = meeting("d1", "Họp riêng", 0, HOUR, { requesterUid: "uid-2" });
  assert.deepEqual(resolveDestination(m), { kind: "direct", requesterUid: "uid-2" });
});

test("resolveDestination: cuộc họp riêng không có requester (tạo trước khi lên bản) → không rõ nơi gửi", () => {
  const m = meeting("d2", "Họp riêng cũ", 0, HOUR);
  assert.deepEqual(resolveDestination(m), { kind: "unresolved" });
});
