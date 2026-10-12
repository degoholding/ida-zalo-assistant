import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MeetingCreator } from "../assistant/meeting-tool.js";
import type { BotMeeting } from "../google/calendar-meetings.js";
import { GoogleSheetsError } from "../google/sheets-error-messages.js";
import type { SendChatContext } from "./send-command-chat.js";
import { PROPOSE_MEETING_ANNOUNCEMENT_DECLARATION, runProposeMeetingAnnouncementTool } from "./send-meeting-announcement-tool.js";

// Nhánh trước khi tạo nháp (không cần DB); nhánh tạo nháp + nội dung do máy chủ dựng test ở test/send-meeting-announcement.integration.test.ts.

const NOW = new Date("2026-10-12T04:00:00Z");
const requester = { uid: "u-mi", name: "Mi", recipientId: null, role: 1 } as unknown as SendChatContext["requester"];
const chat = (over: Partial<SendChatContext> = {}): SendChatContext =>
  ({ deps: {} as SendChatContext["deps"], requester, uid: "u-mi", name: "Mi", question: "gửi link họp vào nhóm Kho HN", sourceThreadId: 1, ...over });
const meetings = (list: BotMeeting[] | Error, connected = true): MeetingCreator => ({
  connected, createMeeting: async () => { throw new Error("không được tạo họp"); }, cancelMeeting: async () => undefined,
  listMeetings: async () => { if (list instanceof Error) throw list; return list; },
});
const mt = (id: string, over: Partial<BotMeeting> = {}): BotMeeting => ({
  id, title: "Họp team bot", startTime: NOW.getTime() + 3_600_000, endTime: NOW.getTime() + 7_200_000, meetLink: `https://meet.google.com/${id}`,
  requesterUid: "u-mi", createdAt: NOW.getTime() - 60_000, ...over,
});

describe("propose_meeting_announcement — nhánh không tạo nháp", () => {
  test("khai báo công cụ không có tham số nội dung (mô hình không truyền được body)", () => {
    const names = Object.keys(PROPOSE_MEETING_ANNOUNCEMENT_DECLARATION.parameters.properties as Record<string, unknown>);
    assert.deepEqual(names.sort(), ["groups", "meeting_title", "start_time"]);
  });

  test("không phải tin riêng / không đủ quyền / thiếu nhóm / giờ sai", async () => {
    assert.ok((await runProposeMeetingAnnouncementTool(undefined, meetings([]), { groups: ["A"] }, NOW)).response.error);
    const denied = await runProposeMeetingAnnouncementTool(chat({ requester: null }), meetings([]), { groups: ["A"] }, NOW);
    assert.match(denied.fixedReply ?? "", /chỉ dành cho/);
    assert.ok((await runProposeMeetingAnnouncementTool(chat(), meetings([]), { groups: [] }, NOW)).response.error);
    assert.ok((await runProposeMeetingAnnouncementTool(chat(), meetings([]), { groups: ["A"], start_time: "mai" }, NOW)).response.error);
  });

  test("Calendar chưa kết nối / lỗi: báo rõ bằng câu cố định, không tạo nháp", async () => {
    const off = await runProposeMeetingAnnouncementTool(chat(), meetings([], false), { groups: ["A"] }, NOW);
    assert.match(off.fixedReply ?? "", /chưa kết nối được Google Calendar/);
    const broken = await runProposeMeetingAnnouncementTool(chat(), meetings(new GoogleSheetsError("Kết nối Google không còn hiệu lực")), { groups: ["A"] }, NOW);
    assert.match(broken.fixedReply ?? "", /chưa đọc được Google Calendar: Kết nối Google không còn hiệu lực/);
  });

  test("không thấy cuộc họp: «chưa thấy cuộc họp nào bot tạo»", async () => {
    const out = await runProposeMeetingAnnouncementTool(chat(), meetings([]), { groups: ["A"] }, NOW);
    assert.match(out.fixedReply ?? "", /^Em chưa thấy cuộc họp nào bot tạo/);
    assert.equal(out.response.drafted, false);
  });

  test("nhiều cuộc khớp: liệt kê để hỏi lại", async () => {
    const out = await runProposeMeetingAnnouncementTool(chat(), meetings([mt("a"), mt("b", { startTime: NOW.getTime() + 10_800_000, endTime: NOW.getTime() + 14_400_000 })]),
      { groups: ["A"], meeting_title: "họp team" }, NOW);
    assert.match(out.fixedReply ?? "", /thấy 2 cuộc họp khớp[\s\S]*1\. Họp team bot — 12:00 T2 12/);
    assert.match(out.fixedReply ?? "", /2\. Họp team bot — 14:00 T2 12\/10/);
  });
});
