import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppConfig } from "../config.js";
import { parseMeetingInput, runCancelMeeting, runCreateMeeting, runListMeetings } from "../assistant/meeting-tool.js";
import { MeetingScheduler, buildMeetingEvent, meetLinkOf, toVnRfc3339 } from "./calendar-meetings.js";

const NOW = new Date("2026-10-06T07:00:00Z"); // 14:00 giờ Việt Nam
const GOOGLE: AppConfig["google"] = {
  serviceAccount: null, spreadsheetUrl: "",
  oauthClientId: "1.apps.googleusercontent.com", oauthClientSecret: "s",
  calendarAccount: { email: "duoc@gmail.com", refresh_token: "rt" },
};

test("events are written in Vietnam time with a Google Meet create request", () => {
  assert.equal(toVnRfc3339(Date.parse("2026-10-07T02:00:00Z")), "2026-10-07T09:00:00+07:00");
  const event = buildMeetingEvent({ title: "Giao ban", startTime: Date.parse("2026-10-07T02:00:00Z"), durationMinutes: 90, description: "" }, "req-1");
  assert.deepEqual(event.start, { dateTime: "2026-10-07T09:00:00+07:00", timeZone: "Asia/Ho_Chi_Minh" });
  assert.deepEqual(event.end, { dateTime: "2026-10-07T10:30:00+07:00", timeZone: "Asia/Ho_Chi_Minh" });
  assert.deepEqual(event.conferenceData, { createRequest: { requestId: "req-1", conferenceSolutionKey: { type: "hangoutsMeet" } } });
});

test("the Meet link comes from hangoutLink or the video entry point", () => {
  assert.equal(meetLinkOf({ hangoutLink: "https://meet.google.com/abc-defg-hij" }), "https://meet.google.com/abc-defg-hij");
  assert.equal(meetLinkOf({ conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:1" }, { entryPointType: "video", uri: "https://meet.google.com/x" }] } }), "https://meet.google.com/x");
  assert.equal(meetLinkOf({}), "");
});

test("meeting input needs a title and a future time; duration is clamped to 15–480 minutes", () => {
  const ok = parseMeetingInput({ title: "Giao ban", start_time: "2026-10-07T09:00:00", duration_minutes: 5 }, NOW);
  assert.deepEqual(ok, { ok: true, value: { title: "Giao ban", startTime: Date.parse("2026-10-07T02:00:00Z"), durationMinutes: 15, description: "" } });
  assert.equal((parseMeetingInput({ title: "x", start_time: "2026-10-07T09:00:00" }, NOW) as { value: { durationMinutes: number } }).value.durationMinutes, 60);
  assert.equal(parseMeetingInput({ start_time: "2026-10-07T09:00:00" }, NOW).ok, false);
  assert.equal(parseMeetingInput({ title: "x", start_time: "2026-10-05T09:00:00" }, NOW).ok, false);
});

test("creating a meeting calls Calendar with conferenceDataVersion=1 and returns the Meet link", async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    urls.push(String(url));
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }));
    return new Response(JSON.stringify({ id: "ev1", htmlLink: "https://calendar.google.com/e/ev1", hangoutLink: "https://meet.google.com/abc-defg-hij" }));
  }) as typeof fetch;
  const scheduler = new MeetingScheduler(() => GOOGLE, fetcher);
  const result = await runCreateMeeting(scheduler, { done: 0 }, { title: "Giao ban K52", start_time: "2026-10-07T09:00:00+07:00" }, NOW);
  assert.equal(result.meet_link, "https://meet.google.com/abc-defg-hij");
  assert.equal(result.time_vn, "09:00 07/10/2026");
  assert.ok(urls[1].includes("conferenceDataVersion=1"));
});

test("without a Google connection the tool explains how to connect", async () => {
  const scheduler = new MeetingScheduler(() => ({ ...GOOGLE, calendarAccount: null }));
  const result = await runCreateMeeting(scheduler, { done: 0 }, { title: "x", start_time: "2026-10-07T09:00:00" }, NOW);
  assert.match(String(result.error), /Kết nối Google/);
});

test("a token without the calendar scope asks the admin to reconnect and tick the permission", async () => {
  const fetcher = (async (url: string | URL | Request) => String(url).includes("oauth2")
    ? new Response(JSON.stringify({ access_token: "at" }))
    : new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "Request had insufficient authentication scopes." } }), { status: 403 })) as typeof fetch;
  const result = await runCreateMeeting(new MeetingScheduler(() => GOOGLE, fetcher), { done: 0 }, { title: "x", start_time: "2026-10-07T09:00:00" }, NOW);
  assert.match(String(result.error), /TICK ô/);
});

test("Calendar API errors become actionable messages", async () => {
  const fetcher = (async (url: string | URL | Request) => String(url).includes("oauth2")
    ? new Response(JSON.stringify({ access_token: "at" }))
    : new Response(JSON.stringify({ error: { message: "Google Calendar API has not been used in project 123" } }), { status: 403 })) as typeof fetch;
  const result = await runCreateMeeting(new MeetingScheduler(() => GOOGLE, fetcher), { done: 0 }, { title: "x", start_time: "2026-10-07T09:00:00" }, NOW);
  assert.match(String(result.error), /bật «Google Calendar API»/);
});

// 06/10/2026: bot chỉ xem / hủy được cuộc họp CHÍNH NÓ tạo (đánh dấu extendedProperties.private), trong nhóm chỉ của nhóm đó
test("listing asks Google only for bot-marked meetings of the asking group", async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    urls.push(String(url));
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "at" }));
    return new Response(JSON.stringify({ items: [{ id: "ev1", summary: "Giao ban", start: { dateTime: "2026-10-07T09:00:00+07:00" }, hangoutLink: "https://meet.google.com/x" }] }));
  }) as typeof fetch;
  const result = await runListMeetings(new MeetingScheduler(() => GOOGLE, fetcher, () => NOW.getTime()), "group-91");
  assert.deepEqual(result, { meetings: [{ id: "ev1", title: "Giao ban", time_vn: "09:00 07/10/2026", meet_link: "https://meet.google.com/x" }] });
  const query = new URL(urls[1]).searchParams.getAll("privateExtendedProperty");
  assert.deepEqual(query, ["createdBy=bot-tro-ly", "scope=group-91"]);
});

test("cancelling refuses events the bot did not create and deletes its own", async () => {
  const methods: string[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "at" }));
    methods.push(`${init?.method} ${new URL(String(url)).pathname.split("/").pop()}`);
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ items: [{ id: "ev-bot", summary: "Giao ban", start: { dateTime: "2026-10-07T09:00:00+07:00" } }] }));
  }) as typeof fetch;
  const scheduler = new MeetingScheduler(() => GOOGLE, fetcher, () => NOW.getTime());
  const foreign = await runCancelMeeting(scheduler, { done: 0 }, { meeting_id: "ev-ca-nhan" }, undefined);
  assert.match(String(foreign.error), /không có cuộc họp này/i);
  assert.ok(!methods.some((call) => call.startsWith("DELETE")));
  const own = await runCancelMeeting(scheduler, { done: 0 }, { meeting_id: "ev-bot" }, undefined);
  assert.equal(own.done, "đã xóa cuộc họp khỏi Google Calendar");
  assert.ok(methods.includes("DELETE ev-bot"));
});

test("new meetings carry the bot mark and the group scope", () => {
  const event = buildMeetingEvent({ title: "x", startTime: 0, durationMinutes: 60, description: "", scopeTag: "group-91" }, "r");
  assert.deepEqual(event.extendedProperties, { private: { createdBy: "bot-tro-ly", scope: "group-91" } });
});

// 10/10/2026 (phase 3): mọi cuộc họp mới (nhóm lẫn riêng) ghi thêm requester — để recap Drive biết gửi riêng khi không có scope nhóm
test("new meetings also carry the requester — direct chats included, so recap can DM the asker later", () => {
  const groupEvent = buildMeetingEvent({ title: "x", startTime: 0, durationMinutes: 60, description: "", scopeTag: "group-91", requesterUid: "uid-1" }, "r");
  assert.deepEqual(groupEvent.extendedProperties, { private: { createdBy: "bot-tro-ly", scope: "group-91", requester: "uid-1" } });
  const directEvent = buildMeetingEvent({ title: "x", startTime: 0, durationMinutes: 60, description: "", requesterUid: "uid-2" }, "r");
  assert.deepEqual(directEvent.extendedProperties, { private: { createdBy: "bot-tro-ly", requester: "uid-2" } });
});

test("runCreateMeeting forwards the asker's Zalo uid as requester on the created event", async () => {
  let postedBody: Record<string, unknown> = {};
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "at" }));
    postedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ id: "ev1", hangoutLink: "https://meet.google.com/x" }));
  }) as typeof fetch;
  await runCreateMeeting(new MeetingScheduler(() => GOOGLE, fetcher), { done: 0 }, { title: "Giao ban", start_time: "2026-10-07T09:00:00" }, NOW, undefined, "uid-asker");
  assert.equal((postedBody.extendedProperties as { private: { requester: string } }).private.requester, "uid-asker");
});

// listMeetingsBetween (phase 3, khớp ghi âm Drive) — không giới hạn "sắp tới" như listMeetings, trả kèm endTime / scopeTag / requesterUid
test("listMeetingsBetween queries the given window and surfaces endTime, scope and requester from private properties", async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    urls.push(String(url));
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "at" }));
    return new Response(JSON.stringify({
      items: [{
        id: "ev1", summary: "Giao ban K52",
        start: { dateTime: "2026-10-07T09:00:00+07:00" }, end: { dateTime: "2026-10-07T10:00:00+07:00" },
        hangoutLink: "https://meet.google.com/x",
        extendedProperties: { private: { createdBy: "bot-tro-ly", scope: "group-91", requester: "uid-1" } },
      }],
    }));
  }) as typeof fetch;
  const timeMin = new Date("2026-10-06T00:00:00Z");
  const timeMax = new Date("2026-10-08T00:00:00Z");
  const result = await new MeetingScheduler(() => GOOGLE, fetcher).listMeetingsBetween(timeMin, timeMax);
  assert.deepEqual(result, [{
    id: "ev1", title: "Giao ban K52",
    startTime: Date.parse("2026-10-07T02:00:00Z"), endTime: Date.parse("2026-10-07T03:00:00Z"),
    meetLink: "https://meet.google.com/x", scopeTag: "group-91", requesterUid: "uid-1",
  }]);
  const query = new URL(urls[1]);
  assert.equal(query.searchParams.get("timeMin"), timeMin.toISOString());
  assert.equal(query.searchParams.get("timeMax"), timeMax.toISOString());
  assert.deepEqual(query.searchParams.getAll("privateExtendedProperty"), ["createdBy=bot-tro-ly"]);
});

// M1 (review 10/10/2026): >250 cuộc họp bot tạo trong cửa sổ (lô tệp lớn / sự cố kéo dài) — phải lặp nextPageToken,
// không được cắt mất cuộc MỚI NHẤT như trần 50 cũ.
test("listMeetingsBetween follows nextPageToken across multiple pages", async () => {
  const urls: string[] = [];
  let calls = 0;
  const fetcher = (async (url: string | URL | Request) => {
    const s = String(url);
    urls.push(s);
    if (s.includes("oauth2")) return new Response(JSON.stringify({ access_token: "at" }));
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        items: [{ id: "ev1", summary: "Họp 1", start: { dateTime: "2026-10-07T09:00:00+07:00" }, end: { dateTime: "2026-10-07T10:00:00+07:00" } }],
        nextPageToken: "page-2",
      }));
    }
    return new Response(JSON.stringify({
      items: [{ id: "ev2", summary: "Họp 2", start: { dateTime: "2026-10-07T11:00:00+07:00" }, end: { dateTime: "2026-10-07T12:00:00+07:00" } }],
    }));
  }) as typeof fetch;
  const result = await new MeetingScheduler(() => GOOGLE, fetcher).listMeetingsBetween(new Date("2026-10-06T00:00:00Z"), new Date("2026-10-08T00:00:00Z"));
  assert.deepEqual(result.map((m) => m.id), ["ev1", "ev2"]);
  assert.equal(calls, 2);
  // urls: [oauth, events trang 1, oauth, events trang 2] — mỗi lượt request() tự lấy token riêng (MeetingScheduler hiện tại)
  assert.equal(new URL(urls[3]).searchParams.get("pageToken"), "page-2");
});
