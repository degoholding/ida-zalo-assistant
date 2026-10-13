import { parseVnTime } from "../assistant/group-action-tools.js";
import type { MeetingCreator } from "../assistant/meeting-tool.js";
import type { BotMeeting } from "../google/calendar-meetings.js";
import { GoogleSheetsError } from "../google/sheets-error-messages.js";
import type { ProposeSendOutcome } from "./send-command-tool.js";
import { formatMeetingChoices, pickMeeting } from "./send-meeting-pick.js";

// Khâu chung của hai công cụ dựa trên cuộc họp bot đã tạo (propose_meeting_announcement, propose_group_pin): đọc Calendar, chọn ĐÚNG một
// cuộc, hoặc trả sẵn câu hỏi lại / báo lỗi do máy chủ dựng. Mô hình chỉ chỉ định cuộc họp (tiêu đề / giờ), không đưa được nội dung.

const NOT_CONNECTED_REPLY = "Em chưa kết nối được Google Calendar nên chưa tìm được cuộc họp — quản trị vào Cài đặt → Google bấm «Kết nối Google» giúp em nhé.";
const NONE_REPLY = "Em chưa thấy cuộc họp nào bot tạo (sắp tới hoặc đang diễn ra) khớp yêu cầu. Anh/chị cho em tên hoặc giờ cuộc họp, hoặc nhờ em tạo cuộc họp trước nhé.";

/** Giờ cuộc họp mô hình truyền: rỗng = không lọc, sai định dạng = báo lỗi cho mô hình hỏi lại. */
export function parseMeetingStart(args: Record<string, unknown>): { startMs: number | null } | { error: string } {
  const rawStart = typeof args.start_time === "string" ? args.start_time.trim() : "";
  const startMs = rawStart ? parseVnTime(rawStart) : null;
  return rawStart && startMs === null ? { error: "Giờ cuộc họp (start_time) sai định dạng — hỏi lại hoặc bỏ trống." } : { startMs };
}

/**
 * `verb` = việc sẽ làm với cuộc họp («gửi» / «ghim») cho câu hỏi lại khi nhiều cuộc khớp.
 * Trả `meeting` khi chọn được đúng một cuộc; không thì `outcome` đã có sẵn câu trả lời của lượt (`fixedReply`).
 */
export async function pickMeetingForTool(
  meetings: MeetingCreator | undefined, askerUid: string, args: Record<string, unknown>, startMs: number | null, now: Date, verb: string,
): Promise<{ meeting: BotMeeting } | { outcome: ProposeSendOutcome }> {
  if (!meetings?.connected) return { outcome: { response: { error: NOT_CONNECTED_REPLY }, fixedReply: NOT_CONNECTED_REPLY } };
  let pick;
  try {
    pick = pickMeeting(await meetings.listMeetings(), {
      askerUid, title: typeof args.meeting_title === "string" ? args.meeting_title : "", startMs, now: now.getTime(),
    });
  } catch (error) {
    if (!(error instanceof GoogleSheetsError)) throw error;
    return { outcome: { response: { drafted: false, note: "Không đọc được Google Calendar — hệ thống đã báo lý do." }, fixedReply: `Em chưa đọc được Google Calendar: ${error.message}` } };
  }
  if (pick.kind === "found") return { meeting: pick.meeting };
  if (pick.kind === "none") {
    return { outcome: { response: { drafted: false, note: "Không thấy cuộc họp phù hợp — hệ thống đã báo người dùng. Không viết thêm gì." }, fixedReply: NONE_REPLY } };
  }
  const reply = `Em thấy ${pick.meetings.length} cuộc họp khớp, anh/chị muốn ${verb} cuộc nào ạ?\n${formatMeetingChoices(pick.meetings)}\nAnh/chị nhắn lại kèm tên hoặc giờ cuộc họp giúp em.`;
  return { outcome: { response: { drafted: false, note: "Nhiều cuộc họp khớp — hệ thống đã hỏi lại người dùng. Không viết thêm gì." }, fixedReply: reply } };
}
