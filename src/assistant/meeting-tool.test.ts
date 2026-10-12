import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BotMeeting, MeetingInput } from "../google/calendar-meetings.js";
import { runCreateMeeting, type MeetingCreator } from "./meeting-tool.js";

// Chốt cứng chống tạo trùng cuộc họp Meet (sự cố prod 12/10/2026: create_meeting gọi hai lần → 2 cuộc họp cùng 11:00).

const NOW = new Date("2026-10-12T02:00:00Z"); // 09:00 VN
const START = "2026-10-12T11:00:00+07:00";

function fakeMeetings(existing: BotMeeting[], listFails = false) {
  const created: MeetingInput[] = [];
  const meetings: MeetingCreator = {
    connected: true,
    createMeeting: async (input) => { created.push(input); return { eventId: "ev-new", meetLink: "https://meet.google.com/new", eventLink: "https://cal/new" }; },
    listMeetings: async () => { if (listFails) throw new Error("Google lỗi"); return existing; },
    cancelMeeting: async () => undefined,
  };
  return { meetings, created };
}

describe("runCreateMeeting — chống trùng", () => {
  test("đã có cuộc họp cùng tên (khác hoa thường / khoảng trắng) + đúng giờ: trả cuộc đã có, KHÔNG tạo, không tính lượt việc", async () => {
    const { meetings, created } = fakeMeetings([{ id: "ev1", title: "Họp  team BOT", startTime: Date.parse(START), meetLink: "https://meet.google.com/yec" }]);
    const counter = { done: 0 };
    const result = await runCreateMeeting(meetings, counter, { title: "họp team bot", start_time: START }, NOW);
    assert.ok(result.already_exists);
    assert.equal(result.meet_link, "https://meet.google.com/yec");
    assert.equal(created.length, 0);
    assert.equal(counter.done, 0);
  });

  test("khác giờ hoặc khác tên: vẫn tạo mới", async () => {
    const { meetings, created } = fakeMeetings([
      { id: "ev1", title: "Họp team bot", startTime: Date.parse(START) + 30 * 60_000, meetLink: "x" },
      { id: "ev2", title: "Giao ban", startTime: Date.parse(START), meetLink: "y" },
    ]);
    const result = await runCreateMeeting(meetings, { done: 0 }, { title: "Họp team bot", start_time: START }, NOW);
    assert.equal(result.meet_link, "https://meet.google.com/new");
    assert.equal(created.length, 1);
  });

  test("liệt kê lỗi: không chặn việc chính, vẫn tạo", async () => {
    const { meetings, created } = fakeMeetings([], true);
    const result = await runCreateMeeting(meetings, { done: 0 }, { title: "Họp", start_time: START }, NOW);
    assert.equal(result.created, "cuộc họp Google Meet");
    assert.equal(created.length, 1);
  });
});
