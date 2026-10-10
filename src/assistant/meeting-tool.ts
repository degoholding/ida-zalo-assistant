import type { BotMeeting, CreatedMeeting, MeetingInput } from "../google/calendar-meetings.js";
import { GoogleSheetsError } from "../google/sheets-error-messages.js";
import type { FunctionDeclaration } from "./gemini-client.js";
import { MAX_ACTIONS_PER_TURN, formatVnTime, parseVnTime } from "./group-action-tools.js";

// Công cụ create_meeting (06/10/2026): «bot tạo cuộc họp Google Meet 9h mai» → sự kiện Google Calendar kèm link Meet
// trên tài khoản đã «Kết nối Google» ở màn Cài đặt; bot gửi link vào khung chat. Có ở cả tin riêng lẫn nhóm. Chỉ có khi
// đã kết nối Google (MeetingScheduler.connected). Tính chung trần số việc mỗi lần hỏi với nhắc hẹn / ghim.

export interface MeetingCreator {
  readonly connected: boolean;
  createMeeting(input: MeetingInput): Promise<CreatedMeeting>;
  listMeetings(scopeTag?: string): Promise<BotMeeting[]>;
  cancelMeeting(eventId: string, scopeTag?: string): Promise<void>;
}

/** Nơi tạo cuộc họp: trong nhóm chỉ thấy / hủy cuộc họp của nhóm đó; tin riêng thấy mọi cuộc họp bot tạo. */
export function meetingScopeTag(scopeGroupId: number | undefined): string | undefined {
  return scopeGroupId ? `group-${scopeGroupId}` : undefined;
}

export const MEETING_MANAGE_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "list_meetings",
    description: "Liệt kê cuộc họp Google Meet SẮP TỚI do bot đã tạo (id, tên, giờ, link) — gọi trước khi hủy cuộc họp.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "cancel_meeting",
    description: "HỦY (xóa khỏi Google Calendar) một cuộc họp bot đã tạo — id lấy từ list_meetings. Nhiều cuộc mà người hỏi không nói rõ thì hỏi lại.",
    parameters: { type: "object", properties: { meeting_id: { type: "string" } }, required: ["meeting_id"] },
  },
];

const MAX_AHEAD_MS = 366 * 86_400_000;

export const CREATE_MEETING_DECLARATION: FunctionDeclaration = {
  name: "create_meeting",
  description:
    "Tạo CUỘC HỌP GOOGLE MEET (sự kiện Google Calendar kèm link Meet) rồi trả link để gửi cho người hỏi / cả nhóm. Dùng cho «tạo cuộc họp», " +
    "«đặt lịch meet». Thiếu giờ thì HỎI LẠI. Trong nhóm nên tạo thêm nhắc hẹn Zalo (create_reminder) cùng giờ để cả nhóm được báo.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Tên cuộc họp, vd 'Giao ban K52'. Người hỏi không nói thì đặt theo nội dung / tên nhóm." },
      start_time: { type: "string", description: "Giờ bắt đầu, ISO 8601 có +07:00, vd 2026-10-07T09:00:00+07:00" },
      duration_minutes: { type: "integer", description: "Thời lượng phút, mặc định 60" },
      description: { type: "string", description: "Nội dung / chương trình họp (tùy chọn)" },
    },
    required: ["title", "start_time"],
  },
};

export function parseMeetingInput(args: Record<string, unknown>, now: Date): { ok: true; value: MeetingInput } | { ok: false; error: string } {
  const title = typeof args.title === "string" ? args.title.trim().slice(0, 200) : "";
  if (!title) return { ok: false, error: "Thiếu tên cuộc họp." };
  const startTime = parseVnTime(args.start_time);
  if (startTime === null) return { ok: false, error: "Thiếu hoặc sai giờ họp — hỏi lại người dùng họp lúc mấy giờ, ngày nào." };
  if (startTime < now.getTime() - 5 * 60_000) return { ok: false, error: `Giờ họp ${formatVnTime(startTime)} đã qua — hỏi lại.` };
  if (startTime > now.getTime() + MAX_AHEAD_MS) return { ok: false, error: "Giờ họp xa quá một năm — hỏi lại." };
  const rawDuration = Number(args.duration_minutes);
  const durationMinutes = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.min(480, Math.max(15, Math.round(rawDuration))) : 60;
  const description = typeof args.description === "string" ? args.description.trim().slice(0, 2000) : "";
  return { ok: true, value: { title, startTime, durationMinutes, description } };
}

export async function runListMeetings(meetings: MeetingCreator | undefined, scopeTag: string | undefined): Promise<Record<string, unknown>> {
  if (!meetings?.connected) return { error: "Chưa kết nối Google — quản trị vào Cài đặt → Google bấm «Kết nối Google»." };
  try {
    const list = await meetings.listMeetings(scopeTag);
    return { meetings: list.map((item) => ({ id: item.id, title: item.title, time_vn: formatVnTime(item.startTime), meet_link: item.meetLink })) };
  } catch (error) {
    if (error instanceof GoogleSheetsError) return { error: error.message };
    throw error;
  }
}

export async function runCancelMeeting(
  meetings: MeetingCreator | undefined, counter: { done: number }, args: Record<string, unknown>, scopeTag: string | undefined,
): Promise<Record<string, unknown>> {
  if (!meetings?.connected) return { error: "Chưa kết nối Google — quản trị vào Cài đặt → Google bấm «Kết nối Google»." };
  if (counter.done >= MAX_ACTIONS_PER_TURN) return { error: `Mỗi lần hỏi chỉ làm tối đa ${MAX_ACTIONS_PER_TURN} việc.` };
  const id = typeof args.meeting_id === "string" ? args.meeting_id.trim() : "";
  if (!id) return { error: "Thiếu meeting_id — gọi list_meetings trước." };
  try {
    await meetings.cancelMeeting(id, scopeTag);
    counter.done += 1;
    return { done: "đã xóa cuộc họp khỏi Google Calendar", id };
  } catch (error) {
    if (error instanceof GoogleSheetsError) return { error: error.message };
    throw error;
  }
}

export async function runCreateMeeting(
  meetings: MeetingCreator | undefined,
  counter: { done: number },
  args: Record<string, unknown>,
  now: Date,
  scopeTag?: string,
  /** Mã Zalo người hỏi — ghi vào sự kiện (phase 3 recap Drive dùng để gửi riêng khi cuộc họp không đặt trong nhóm). */
  requesterUid?: string,
): Promise<Record<string, unknown>> {
  if (!meetings?.connected) return { error: "Chưa kết nối Google — quản trị vào Cài đặt → Google bấm «Kết nối Google» thì bot mới tạo được cuộc họp Meet." };
  if (counter.done >= MAX_ACTIONS_PER_TURN) return { error: `Mỗi lần hỏi chỉ làm tối đa ${MAX_ACTIONS_PER_TURN} việc.` };
  const parsed = parseMeetingInput(args, now);
  if (!parsed.ok) return { error: parsed.error };
  try {
    const meeting = await meetings.createMeeting({ ...parsed.value, scopeTag, requesterUid });
    counter.done += 1;
    return {
      created: "cuộc họp Google Meet",
      title: parsed.value.title,
      time_vn: formatVnTime(parsed.value.startTime),
      duration_minutes: parsed.value.durationMinutes,
      meet_link: meeting.meetLink || "(Google chưa trả link Meet — xem trong sự kiện)",
      calendar_link: meeting.eventLink,
    };
  } catch (error) {
    if (error instanceof GoogleSheetsError) return { error: error.message };
    throw error;
  }
}
