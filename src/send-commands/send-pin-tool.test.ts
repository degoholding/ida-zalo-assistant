import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MeetingCreator } from "../assistant/meeting-tool.js";
import type { BotMeeting } from "../google/calendar-meetings.js";
import { GoogleSheetsError } from "../google/sheets-error-messages.js";
import type { SendChatContext } from "./send-command-chat.js";
import { buildPinMeetingBody } from "./send-meeting-pick.js";
import { cleanPinContent } from "./send-pin-draft-service.js";
import { PROPOSE_PIN_DECLARATION, runProposePinTool } from "./send-pin-tool.js";

// Nhánh trước khi tạo nháp (không cần DB); nhánh tạo nháp + nội dung từ cuộc họp test ở test/send-pin.integration.test.ts.

const NOW = new Date("2026-10-12T04:00:00Z");
const requester = { uid: "u-mi", name: "Mi", recipientId: null, role: 1 } as unknown as SendChatContext["requester"];
const chat = (over: Partial<SendChatContext> = {}): SendChatContext =>
  ({ deps: {} as SendChatContext["deps"], requester, uid: "u-mi", name: "Mi", question: "ghim cuộc họp 15h của nhóm Kho HN", sourceThreadId: 1, ...over });
const meetings = (list: BotMeeting[] | Error, connected = true): MeetingCreator => ({
  connected, createMeeting: async () => { throw new Error("không được tạo họp"); }, cancelMeeting: async () => undefined,
  listMeetings: async () => { if (list instanceof Error) throw list; return list; },
});
const mt = (id: string, over: Partial<BotMeeting> = {}): BotMeeting => ({
  id, title: "Họp team bot", startTime: NOW.getTime() + 3_600_000, endTime: NOW.getTime() + 7_200_000, meetLink: `https://meet.google.com/${id}`,
  requesterUid: "u-mi", createdAt: NOW.getTime() - 60_000, ...over,
});

describe("propose_group_pin — nhánh không tạo nháp", () => {
  test("khai báo: groups bắt buộc; content / meeting_title / start_time tùy chọn", () => {
    assert.deepEqual(PROPOSE_PIN_DECLARATION.parameters.required, ["groups"]);
    assert.deepEqual(Object.keys(PROPOSE_PIN_DECLARATION.parameters.properties as Record<string, unknown>).sort(), ["content", "groups", "meeting_title", "start_time"]);
  });

  test("không phải tin riêng / không đủ quyền / thiếu nhóm / giờ sai", async () => {
    assert.ok((await runProposePinTool(undefined, meetings([]), { groups: ["A"], content: "x" }, NOW)).response.error);
    assert.match((await runProposePinTool(chat({ requester: null }), meetings([]), { groups: ["A"], content: "x" }, NOW)).fixedReply ?? "", /chỉ dành cho/);
    assert.ok((await runProposePinTool(chat(), meetings([]), { groups: [], content: "x" }, NOW)).response.error);
    assert.ok((await runProposePinTool(chat(), meetings([]), { groups: ["A"], start_time: "mai" }, NOW)).response.error);
  });

  test("ghim cuộc họp: Calendar chưa kết nối / lỗi / không thấy / nhiều cuộc → câu cố định, không tạo nháp", async () => {
    assert.match((await runProposePinTool(chat(), meetings([], false), { groups: ["A"] }, NOW)).fixedReply ?? "", /chưa kết nối được Google Calendar/);
    assert.match((await runProposePinTool(chat(), meetings(new GoogleSheetsError("hết hạn")), { groups: ["A"] }, NOW)).fixedReply ?? "", /chưa đọc được Google Calendar: hết hạn/);
    const none = await runProposePinTool(chat(), meetings([]), { groups: ["A"] }, NOW);
    assert.match(none.fixedReply ?? "", /^Em chưa thấy cuộc họp nào bot tạo/);
    assert.equal(none.response.drafted, false);
    const many = await runProposePinTool(chat(), meetings([mt("a"), mt("b", { startTime: NOW.getTime() + 10_800_000, endTime: NOW.getTime() + 14_400_000 })]),
      { groups: ["A"], meeting_title: "họp team" }, NOW);
    assert.match(many.fixedReply ?? "", /thấy 2 cuộc họp khớp, anh\/chị muốn ghim cuộc nào ạ\?/);
  });
});

describe("nội dung ghim", () => {
  test("cuộc họp → «Cuộc họp: <tiêu đề>\\nLúc: HH:MM T2 12/10\\nLink Google Meet: <link>»", () => {
    assert.equal(buildPinMeetingBody(mt("abc", { title: "  Họp   team\nbot " })),
      "Cuộc họp: Họp team bot\nLúc: 12:00 T2 12/10\nLink Google Meet: https://meet.google.com/abc");
  });

  test("cleanPinContent: chuẩn hóa xuống dòng, bỏ ký tự điều khiển, cắt đầu cuối", () => {
    assert.equal(cleanPinContent("  a\r\nb\u0000c\u0007 \n"), "a\nbc");
  });
});
