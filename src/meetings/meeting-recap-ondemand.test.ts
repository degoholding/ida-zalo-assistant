import assert from "node:assert/strict";
import { test } from "node:test";
import type { DriveFileInfo } from "../google/drive-client.js";
import { buildOndemandDestination, pickAudioFile, titleFromFileName } from "./meeting-recap-ondemand.js";

// Hàm THUẦN của recap theo yêu cầu chat (phase 6) — chọn tệp + dựng đích gửi. Phần đụng DB / Drive thật
// (`runOndemandRecap`) kiểm bằng smoke test trên MySQL (xem test/meeting-recap-ondemand.integration.test.ts).

function file(id: string, name: string, createdTime: string, size = 1_000_000): DriveFileInfo {
  return { id, name, mimeType: "audio/mpeg", size, createdTime };
}

test("pickAudioFile: thư mục rỗng → empty", () => {
  assert.deepEqual(pickAudioFile([]), { kind: "empty" });
});

test("pickAudioFile: không nói tên → tệp MỚI NHẤT (theo createdTime, không theo thứ tự mảng đưa vào)", () => {
  const files = [
    file("old", "a.mp3", "2026-10-01T00:00:00Z"),
    file("new", "b.mp3", "2026-10-09T00:00:00Z"),
    file("mid", "c.mp3", "2026-10-05T00:00:00Z"),
  ];
  const result = pickAudioFile(files);
  assert.equal(result.kind, "single");
  assert.equal((result as { file: DriveFileInfo }).file.id, "new");
});

test("pickAudioFile: có tên, khớp đúng một tệp (bỏ dấu, không phân biệt hoa thường)", () => {
  const files = [file("a", "Giao ban K52.mp3", "2026-10-09T00:00:00Z"), file("b", "Review K53.mp3", "2026-10-08T00:00:00Z")];
  const result = pickAudioFile(files, "giao ban");
  assert.equal(result.kind, "single");
  assert.equal((result as { file: DriveFileInfo }).file.id, "a");
});

test("pickAudioFile: vài tệp tên gần giống → ambiguous, kèm đủ danh sách ứng viên", () => {
  const files = [file("a", "Giao ban K52 - phan 1.mp3", "2026-10-09T00:00:00Z"), file("b", "Giao ban K52 - phan 2.mp3", "2026-10-08T00:00:00Z")];
  const result = pickAudioFile(files, "giao ban k52");
  assert.equal(result.kind, "ambiguous");
  assert.equal((result as { files: DriveFileInfo[] }).files.length, 2);
});

test("pickAudioFile: tên tệp nối bằng gạch ngang / gạch dưới vẫn khớp câu gõ cách nhau bằng khoảng trắng", () => {
  const files = [file("a", "giao-ban_k52.mp3", "2026-10-09T00:00:00Z")];
  const result = pickAudioFile(files, "giao ban k52");
  assert.equal(result.kind, "single");
  assert.equal((result as { file: DriveFileInfo }).file.id, "a");
});

test("pickAudioFile: có tên nhưng không tệp nào khớp → not-found kèm đúng câu đã gõ", () => {
  const files = [file("a", "Giao ban K52.mp3", "2026-10-09T00:00:00Z")];
  const result = pickAudioFile(files, "review k53");
  assert.deepEqual(result, { kind: "not-found", query: "review k53" });
});

test("buildOndemandDestination: hỏi trong nhóm → đích là nhóm đó, người hỏi vẫn là requesterUid", () => {
  assert.deepEqual(buildOndemandDestination(91, "uid-1"), { targetThreadId: 91, requesterUid: "uid-1" });
});

test("buildOndemandDestination: hỏi tin riêng (không có scopeGroupId) → đích là chính người hỏi", () => {
  assert.deepEqual(buildOndemandDestination(undefined, "uid-1"), { targetThreadId: null, requesterUid: "uid-1" });
});

test("titleFromFileName: bỏ đuôi tệp, đổi gạch dưới / gạch ngang thành khoảng trắng", () => {
  assert.equal(titleFromFileName("giao-ban_k52.mp3"), "giao ban k52");
  assert.equal(titleFromFileName("ghi-am"), "ghi am");
  assert.equal(titleFromFileName(".mp3"), ".mp3"); // không có tên trước đuôi — giữ nguyên, không trả rỗng
});
