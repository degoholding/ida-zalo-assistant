import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BotMeeting } from "../google/calendar-meetings.js";
import { buildAnnouncementBody, pickMeeting } from "./send-meeting-pick.js";

const NOW = Date.parse("2026-10-12T04:00:00Z"); // 11:00 VN, thứ Hai 12/10
const H = 3_600_000;
const ASKER = "u-mi";

function meeting(over: Partial<BotMeeting> & { id: string }): BotMeeting {
  return { title: "Họp team bot", startTime: NOW + H, endTime: NOW + 2 * H, meetLink: `https://meet.google.com/${over.id}`, requesterUid: ASKER, createdAt: NOW - 600_000, ...over };
}
const ask = (over: { title?: string; startMs?: number | null } = {}) => ({ askerUid: ASKER, title: over.title ?? "", startMs: over.startMs ?? null, now: NOW });

describe("pickMeeting", () => {
  test("không chỉ rõ: cuộc người hỏi tạo gần nhất trong 2 giờ qua; bỏ cuộc người khác tạo", () => {
    const pick = pickMeeting([
      meeting({ id: "old", createdAt: NOW - 5 * H }), meeting({ id: "new", createdAt: NOW - 60_000 }),
      meeting({ id: "other", requesterUid: "u-khac", createdAt: NOW - 1000 }),
    ], ask());
    assert.deepEqual(pick.kind === "found" && pick.meeting.id, "new");
  });

  test("không chỉ rõ, mọi cuộc tạo quá 2 giờ trước: không thấy", () => {
    assert.equal(pickMeeting([meeting({ id: "a", createdAt: NOW - 3 * H })], ask()).kind, "none");
  });

  test("không chỉ rõ, Calendar không trả giờ tạo: cuộc sắp tới gần nhất của người hỏi", () => {
    const pick = pickMeeting([
      meeting({ id: "late", startTime: NOW + 5 * H, endTime: NOW + 6 * H, createdAt: undefined }),
      meeting({ id: "soon", createdAt: undefined }),
      meeting({ id: "other", requesterUid: "u-khac", startTime: NOW + 60_000, createdAt: undefined }),
    ], ask());
    assert.deepEqual(pick.kind === "found" && pick.meeting.id, "soon");
  });

  test("khớp tiêu đề (bỏ dấu, hoa thường)", () => {
    const list = [meeting({ id: "a", title: "Giao ban tuần" }), meeting({ id: "b", title: "Họp team bot" })];
    const pick = pickMeeting(list, ask({ title: "HOP TEAM BOT" }));
    assert.deepEqual(pick.kind === "found" && pick.meeting.id, "b");
  });

  test("khớp giờ bắt đầu (theo phút)", () => {
    const list = [meeting({ id: "a", startTime: NOW + H }), meeting({ id: "b", startTime: NOW + 3 * H, endTime: NOW + 4 * H })];
    const pick = pickMeeting(list, ask({ startMs: NOW + 3 * H + 20_000 }));
    assert.deepEqual(pick.kind === "found" && pick.meeting.id, "b");
  });

  test("ưu tiên cuộc của người hỏi khi cả hai cùng khớp; chỉ cuộc người khác khớp thì vẫn dùng được", () => {
    const list = [meeting({ id: "other", requesterUid: "u-khac" }), meeting({ id: "mine" })];
    const first = pickMeeting(list, ask({ title: "họp team" }));
    assert.deepEqual(first.kind === "found" && first.meeting.id, "mine");
    const second = pickMeeting([list[0]], ask({ title: "họp team" }));
    assert.deepEqual(second.kind === "found" && second.meeting.id, "other");
  });

  test("nhiều cuộc khớp: trả danh sách theo giờ để hỏi lại", () => {
    const pick = pickMeeting([meeting({ id: "b", startTime: NOW + 3 * H, endTime: NOW + 4 * H }), meeting({ id: "a" })], ask({ title: "họp team" }));
    assert.equal(pick.kind, "many");
    assert.deepEqual(pick.kind === "many" && pick.meetings.map((item) => item.id), ["a", "b"]);
  });

  test("không thấy: danh sách rỗng, cuộc đã kết thúc, không có link, không khớp tiêu đề", () => {
    assert.equal(pickMeeting([], ask()).kind, "none");
    assert.equal(pickMeeting([meeting({ id: "a", startTime: NOW - 3 * H, endTime: NOW - 2 * H })], ask()).kind, "none");
    assert.equal(pickMeeting([meeting({ id: "a", meetLink: "" })], ask()).kind, "none");
    assert.equal(pickMeeting([meeting({ id: "a" })], ask({ title: "kế toán" })).kind, "none");
  });

  test("cuộc đang diễn ra (bắt đầu trước, chưa kết thúc) vẫn chọn được", () => {
    const pick = pickMeeting([meeting({ id: "live", startTime: NOW - 20 * 60_000, endTime: NOW + 40 * 60_000 })], ask());
    assert.equal(pick.kind, "found");
  });
});

describe("buildAnnouncementBody", () => {
  test("dựng đúng ba dòng: tiêu đề, giờ VN, link", () => {
    const body = buildAnnouncementBody(meeting({ id: "yec", title: "  Họp   team bot ", startTime: Date.parse("2026-10-12T05:00:00Z") }));
    assert.equal(body, "Mời họp: Họp team bot\nLúc: 12:00 T2 12/10\nLink Google Meet: https://meet.google.com/yec");
  });
});
