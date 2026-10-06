import crypto from "node:crypto";
import type { AppConfig } from "../config.js";
import { GoogleUserAuth, MISSING_CALENDAR_SCOPE_TEXT, oauthClientOf, type GoogleAccountLink } from "./google-oauth.js";
import { GoogleSheetsError, NETWORK_ERROR_TEXT } from "./sheets-error-messages.js";

// Cuộc họp Google Meet = sự kiện Google Calendar (lịch chính của tài khoản đã «Kết nối Google») kèm
// conferenceData.createRequest hangoutsMeet, conferenceDataVersion=1. Mỗi sự kiện bot tạo được ĐÁNH DẤU bằng
// extendedProperties.private (createdBy + nơi tạo) — bot chỉ xem / hủy được sự kiện của chính nó, không bao giờ đụng
// lịch cá nhân khác của chủ tài khoản (06/10/2026).

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TIME_ZONE = "Asia/Ho_Chi_Minh";
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
/** Dấu bot trên sự kiện — lọc bằng privateExtendedProperty. */
export const BOT_MARK = "bot-tro-ly";

export interface MeetingInput {
  title: string;
  startTime: number;
  durationMinutes: number;
  description: string;
  /** Nơi tạo (vd «group-91»): trong nhóm chỉ thấy / hủy cuộc họp của nhóm đó. */
  scopeTag?: string;
}

export interface CreatedMeeting {
  eventId: string;
  meetLink: string;
  eventLink: string;
}

export interface BotMeeting {
  id: string;
  title: string;
  startTime: number;
  meetLink: string;
}

/** Giờ Việt Nam dạng RFC3339 «2026-10-07T09:00:00+07:00» (Calendar nhận kèm timeZone). */
export function toVnRfc3339(ms: number): string {
  return `${new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 19)}+07:00`;
}

export function buildMeetingEvent(input: MeetingInput, requestId: string): Record<string, unknown> {
  return {
    summary: input.title,
    description: input.description || "Tạo bởi Bot trợ lý.",
    start: { dateTime: toVnRfc3339(input.startTime), timeZone: TIME_ZONE },
    end: { dateTime: toVnRfc3339(input.startTime + input.durationMinutes * 60_000), timeZone: TIME_ZONE },
    conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    extendedProperties: { private: { createdBy: BOT_MARK, ...(input.scopeTag ? { scope: input.scopeTag } : {}) } },
  };
}

/** Link Meet trong sự kiện: hangoutLink, hoặc entryPoint video của conferenceData. */
export function meetLinkOf(event: Record<string, unknown>): string {
  if (typeof event.hangoutLink === "string") return event.hangoutLink;
  const entryPoints = ((event.conferenceData as { entryPoints?: { entryPointType?: string; uri?: string }[] } | undefined)?.entryPoints) ?? [];
  return entryPoints.find((entry) => entry.entryPointType === "video")?.uri ?? "";
}

/** Câu báo dễ hiểu cho lỗi Calendar API. */
function describeCalendarFailure(status: number, body: Record<string, unknown>): GoogleSheetsError {
  const message = ((body.error ?? {}) as { message?: string }).message ?? "";
  if (status === 403 && /insufficient authentication scopes|insufficientPermissions/i.test(message)) return new GoogleSheetsError(MISSING_CALENDAR_SCOPE_TEXT, 403);
  if (status === 403 && /has not been used|disabled/i.test(message)) {
    return new GoogleSheetsError("Project chưa bật Google Calendar API — vào Google Cloud Console bật «Google Calendar API».", 403);
  }
  if (status === 401) return new GoogleSheetsError("Kết nối Google không còn hiệu lực — vào Cài đặt bấm «Kết nối Google» lại.", 401);
  if (status === 404 || status === 410) return new GoogleSheetsError("Cuộc họp này không còn trên lịch (có thể đã bị xóa).", status);
  return new GoogleSheetsError(`Google Calendar báo lỗi ${status}${message ? `: ${message.slice(0, 200)}` : ""}`, status);
}

export class MeetingScheduler {
  constructor(
    /** Đọc lúc gọi — kết nối / ngắt kết nối trên màn Cài đặt có hiệu lực ngay. */
    private readonly getGoogle: () => AppConfig["google"],
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  get connected(): boolean {
    const google = this.getGoogle();
    return Boolean(oauthClientOf(google) && google.calendarAccount);
  }

  async createMeeting(input: MeetingInput): Promise<CreatedMeeting> {
    const event = await this.request(`${EVENTS_URL}?conferenceDataVersion=1&sendUpdates=none`, {
      method: "POST", body: JSON.stringify(buildMeetingEvent(input, crypto.randomUUID())),
    });
    return { eventId: String(event.id ?? ""), meetLink: meetLinkOf(event), eventLink: String(event.htmlLink ?? "") };
  }

  /** Cuộc họp SẮP TỚI (và vừa bắt đầu trong 1 giờ) do bot tạo — trong nhóm: chỉ của nhóm đó. */
  async listMeetings(scopeTag?: string): Promise<BotMeeting[]> {
    const params = new URLSearchParams({
      timeMin: new Date(this.now() - 60 * 60_000).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "20",
    });
    params.append("privateExtendedProperty", `createdBy=${BOT_MARK}`);
    if (scopeTag) params.append("privateExtendedProperty", `scope=${scopeTag}`);
    const body = await this.request(`${EVENTS_URL}?${params}`, { method: "GET" });
    return ((body.items ?? []) as Record<string, unknown>[]).map((item) => ({
      id: String(item.id ?? ""),
      title: String(item.summary ?? ""),
      startTime: Date.parse(String((item.start as { dateTime?: string } | undefined)?.dateTime ?? "")) || 0,
      meetLink: meetLinkOf(item),
    }));
  }

  /** Hủy (xóa) một cuộc họp — chỉ khi id nằm trong danh sách cuộc họp CỦA BOT ở phạm vi này. */
  async cancelMeeting(eventId: string, scopeTag?: string): Promise<void> {
    const mine = await this.listMeetings(scopeTag);
    if (!mine.some((meeting) => meeting.id === eventId)) {
      throw new GoogleSheetsError("Không có cuộc họp này trong các cuộc họp bot đã tạo — gọi list_meetings lấy id đúng.");
    }
    await this.request(`${EVENTS_URL}/${encodeURIComponent(eventId)}?sendUpdates=none`, { method: "DELETE" });
  }

  private async request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const google = this.getGoogle();
    const client = oauthClientOf(google);
    if (!client || !google.calendarAccount) {
      throw new GoogleSheetsError("Chưa kết nối Google — quản trị vào Cài đặt → Google bấm «Kết nối Google».");
    }
    const token = await new GoogleUserAuth(client, google.calendarAccount as GoogleAccountLink, this.fetcher).getAccessToken();
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GoogleSheetsError(NETWORK_ERROR_TEXT);
    }
    // DELETE thành công trả 204 không có thân
    const body = response.status === 204 ? {} : ((await response.json().catch(() => ({}))) as Record<string, unknown>);
    if (!response.ok) throw describeCalendarFailure(response.status, body);
    return body;
  }
}
