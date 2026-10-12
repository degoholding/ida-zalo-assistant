import type { BotMeeting } from "../google/calendar-meetings.js";
import { formatSendTime } from "./send-command-preview.js";
import { foldName } from "./send-target-matcher.js";

// Chọn cuộc họp BOT đã tạo để gửi lời mời vào nhóm + dựng nội dung lời mời (propose_meeting_announcement). Hàm thuần.
// Nội dung lời mời do MÁY CHỦ dựng từ dữ liệu Calendar — không bao giờ lấy từ chữ mô hình truyền vào.

/** «Cuộc họp mới tạo» = tạo trong ngần này gần đây. */
const RECENT_CREATED_MS = 2 * 3_600_000;
/** Cuộc họp không có giờ kết thúc: coi như kéo dài ngần này. */
const DEFAULT_DURATION_MS = 60 * 60_000;
const MAX_TITLE_CHARS = 200;

export interface MeetingPickQuery {
  /** Mã Zalo người hỏi — ưu tiên cuộc họp do chính họ đặt */
  askerUid: string;
  /** Tiêu đề người hỏi nói (khớp bỏ dấu / hoa thường); rỗng = không chỉ rõ */
  title: string;
  /** Giờ bắt đầu người hỏi nói (ms, đã cắt về phút); null = không chỉ rõ */
  startMs: number | null;
  now: number;
}

export type MeetingPick =
  | { kind: "found"; meeting: BotMeeting }
  | { kind: "many"; meetings: BotMeeting[] }
  | { kind: "none" };

const sameMinute = (left: number, right: number): boolean => Math.floor(left / 60_000) === Math.floor(right / 60_000);

/** Tiêu đề người hỏi nói nằm trong tiêu đề cuộc họp, hoặc ngược lại (bỏ dấu, hoa thường). */
function titleMatches(meetingTitle: string, wanted: string): boolean {
  const folded = foldName(meetingTitle);
  const query = foldName(wanted);
  return Boolean(query) && (folded.includes(query) || query.includes(folded));
}

export function pickMeeting(list: BotMeeting[], query: MeetingPickQuery): MeetingPick {
  // Chỉ cuộc họp còn dùng được: có link, chưa kết thúc (sắp tới hoặc đang diễn ra)
  const usable = list.filter((item) => item.meetLink.startsWith("http") && item.startTime > 0
    && (item.endTime || item.startTime + DEFAULT_DURATION_MS) > query.now);
  const mine = usable.filter((item) => item.requesterUid === query.askerUid);
  const specified = Boolean(query.title.trim()) || query.startMs !== null;

  if (specified) {
    const matched = usable.filter((item) => (!query.title.trim() || titleMatches(item.title, query.title))
      && (query.startMs === null || sameMinute(item.startTime, query.startMs)));
    // Có cuộc do chính người hỏi đặt thì chỉ xét các cuộc đó
    const mineMatched = matched.filter((item) => item.requesterUid === query.askerUid);
    const pool = mineMatched.length ? mineMatched : matched;
    if (pool.length === 1) return { kind: "found", meeting: pool[0] };
    return pool.length ? { kind: "many", meetings: pool.sort((a, b) => a.startTime - b.startTime) } : { kind: "none" };
  }

  // Không chỉ rõ: cuộc người hỏi vừa tạo trong 2 giờ qua; Calendar không trả giờ tạo thì cuộc sắp tới gần nhất của họ
  if (mine.some((item) => item.createdAt !== undefined)) {
    const recent = mine.filter((item) => item.createdAt !== undefined && item.createdAt >= query.now - RECENT_CREATED_MS);
    recent.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return recent.length ? { kind: "found", meeting: recent[0] } : { kind: "none" };
  }
  const upcoming = [...mine].sort((a, b) => a.startTime - b.startTime);
  return upcoming.length ? { kind: "found", meeting: upcoming[0] } : { kind: "none" };
}

/** Nội dung lời mời họp gửi vào nhóm — máy chủ dựng. */
export function buildAnnouncementBody(meeting: BotMeeting): string {
  const title = meeting.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS) || "Cuộc họp";
  return [`Mời họp: ${title}`, `Lúc: ${formatSendTime(new Date(meeting.startTime))}`, `Link Google Meet: ${meeting.meetLink}`].join("\n");
}

/** Danh sách cuộc họp để hỏi lại khi nhiều cuộc cùng khớp. */
export function formatMeetingChoices(meetings: BotMeeting[]): string {
  return meetings.slice(0, 5).map((item, index) => `${index + 1}. ${item.title || "Cuộc họp"} — ${formatSendTime(new Date(item.startTime))}`).join("\n");
}
