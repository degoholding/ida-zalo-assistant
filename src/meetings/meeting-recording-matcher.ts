import { isAudioFile } from "../google/drive-client.js";

// Hàm THUẦN khớp tệp ghi âm Drive với cuộc họp bot tạo (phase 3, recap họp tự động). Không gọi mạng / CSDL — nhận dữ
// liệu đã tải sẵn (DriveFileInfo rút gọn, BotMeeting rút gọn) để test bảng dễ, watcher (meeting-recording-watcher.ts)
// mới là nơi gọi Drive / Calendar thật. isAudioFile export lại từ drive-client.ts cho gọn chỗ import ở watcher.

export { isAudioFile };

/** Quét tệp Drive tạo trong ngần này gần đây — ≥ cửa sổ khớp 24h + dư, tránh bật tính năng lần đầu recap lại hàng loạt tệp cũ. */
export const RECORDING_SCAN_LOOKBACK_MS = 48 * 60 * 60_000;
/** Cửa sổ sau khi cuộc họp kết thúc mà tệp tải lên vẫn còn tính là khớp (người họp tải mp3 trễ). Export để watcher dùng
 * lại khi tính mốc gọi Calendar (L10: trước đây định nghĩa lặp ở hai tệp, dễ sửa một chỗ quên chỗ kia). */
export const MATCH_WINDOW_AFTER_END_MS = 24 * 60 * 60_000;
/** Họp dài nhất bot tạo được (create_meeting trần 480 phút) — lùi thêm khi tính mốc gọi Calendar để chắc chắn phủ hết
 * cuộc họp cũ nhất trong lô tệp / tệp đang xét. Dùng chung bởi watcher (quét theo lô) và meeting-recap-ondemand.ts
 * (khớp một tệp theo yêu cầu chat, phase 6). */
export const LONGEST_MEETING_MS = 480 * 60_000;

/** Mốc giờ bắt đầu quét — tệp Drive `createdTime` trước mốc này bị bỏ qua (THUẦN, test được 48h cutoff). */
export function scanCutoff(now: Date): Date {
  return new Date(now.getTime() - RECORDING_SCAN_LOOKBACK_MS);
}

export interface RecordingCandidateMeeting {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  /** Nơi tạo «group-<id>» — rỗng = tin riêng. */
  scopeTag?: string;
  requesterUid?: string;
}

export interface RecordingFile {
  name: string;
  createdAtMs: number;
}

export interface PickMeetingResult {
  meeting: RecordingCandidateMeeting | null;
  /** Mọi ứng viên trong cửa sổ (kể cả khi không được chọn) — để log / điều tra khi khớp nhầm. */
  candidates: RecordingCandidateMeeting[];
}

/** Bỏ dấu + chữ thường, so khớp tên tệp chứa tên cuộc họp (hoặc tên tệp người hỏi gõ, phase 6) không phân biệt dấu /
 * hoa thường. Export cho meeting-recap-ondemand.ts dùng lại (chọn tệp theo tên khi recap qua chat). */
export function normalizeForMatch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Điểm xếp hạng ứng viên tại thời điểm tệp được tải lên: cuộc họp ĐÃ KẾT THÚC trước lúc tải luôn ưu tiên hơn cuộc đang
 * diễn ra (cộng thêm hằng số rất lớn so với mọi mốc epoch ms thực tế) — trong nhóm đã kết thúc so theo `endTime` lớn
 * nhất (kết thúc gần nhất TRƯỚC lúc tải); trong nhóm đang diễn ra so theo `startTime` lớn nhất (bắt đầu muộn nhất).
 */
function rank(meeting: RecordingCandidateMeeting, createdAtMs: number): number {
  const endedBeforeUpload = meeting.endTime <= createdAtMs;
  return endedBeforeUpload ? 1e13 + meeting.endTime : meeting.startTime;
}

/**
 * Ứng viên: `start ≤ createdTime ≤ end + 24h`. Không có ứng viên → `meeting: null` (Unmatched). Nhiều ứng viên → ưu
 * tiên (1) tên tệp chứa tên cuộc họp, (2) cuộc đã kết thúc có `end` lớn nhất, (3) cuộc có `start` lớn nhất.
 */
export function pickMeetingForFile(file: RecordingFile, meetings: RecordingCandidateMeeting[]): PickMeetingResult {
  const candidates = meetings.filter(
    (meeting) => file.createdAtMs >= meeting.startTime && file.createdAtMs <= meeting.endTime + MATCH_WINDOW_AFTER_END_MS,
  );
  if (!candidates.length) return { meeting: null, candidates };
  const fileName = normalizeForMatch(file.name);
  const byTitle = candidates.filter((meeting) => meeting.title.trim() && fileName.includes(normalizeForMatch(meeting.title)));
  const pool = byTitle.length ? byTitle : candidates;
  const [best] = [...pool].sort((a, b) => rank(b, file.createdAtMs) - rank(a, file.createdAtMs));
  return { meeting: best, candidates };
}

export type RecordingDestination =
  | { kind: "group"; targetThreadId: number; requesterUid?: string }
  | { kind: "direct"; requesterUid: string }
  /** Không rõ nơi gửi — cuộc họp riêng tạo trước khi có cột requester, hoặc dữ liệu cũ thiếu cả hai. */
  | { kind: "unresolved" };

/** Đích gửi của một cuộc họp đã khớp (THUẦN): scope=group-<id> → nhóm; không scope mà có requester → riêng; còn lại → không rõ. */
export function resolveDestination(meeting: RecordingCandidateMeeting): RecordingDestination {
  const groupMatch = /^group-(\d+)$/.exec(meeting.scopeTag ?? "");
  if (groupMatch) return { kind: "group", targetThreadId: Number(groupMatch[1]), requesterUid: meeting.requesterUid };
  if (meeting.requesterUid) return { kind: "direct", requesterUid: meeting.requesterUid };
  return { kind: "unresolved" };
}

/** `BotMeeting` (Google Calendar, kiểu đầy đủ ở calendar-meetings.ts) → `RecordingCandidateMeeting` rút gọn cho
 * `pickMeetingForFile` — `endTime` mặc định = `startTime` khi Calendar không trả (never xảy ra với listMeetingsBetween,
 * chỉ để kiểu khớp). Dùng chung bởi watcher (một lô tệp) và meeting-recap-ondemand.ts (một tệp theo yêu cầu chat). */
export function toRecordingCandidate(meeting: { id: string; title: string; startTime: number; endTime?: number; scopeTag?: string; requesterUid?: string }): RecordingCandidateMeeting {
  return { id: meeting.id, title: meeting.title, startTime: meeting.startTime, endTime: meeting.endTime ?? meeting.startTime, scopeTag: meeting.scopeTag, requesterUid: meeting.requesterUid };
}
