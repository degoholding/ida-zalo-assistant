import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorkCalendar } from "../schedule/work-calendar.js";
import { computeReplyStats, responderKey, type EpisodeMessage } from "./reply-episodes.js";

// Lịch IDA: 08:30–12:00, 13:30–17:30, thứ 2–7
const calendar = buildWorkCalendar({ workHours: "08:30-12:00, 13:30-17:30", workDays: [1, 2, 3, 4, 5, 6], quietHours: "21:00-06:30", holidays: "" });
const vn = (text: string) => new Date(`${text}+07:00`);
const dayOf = (at: Date) => new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
const STAFF = new Set(["s1", "s2", "bot"]);
const msg = (at: string, uid: string, name = uid): EpisodeMessage => ({ sentAt: vn(at), senderUid: uid, senderName: name });
const run = (messages: EpisodeMessage[], now = vn("2026-11-10T18:00:00"), extra: Partial<Parameters<typeof computeReplyStats>[1]> = {}) =>
  computeReplyStats(messages, {
    now, slaMinutes: 120, isStaff: (uid) => STAFF.has(uid), workingMinutesBetween: (a, b) => calendar.workingMinutesBetween(a, b), dayOf, ...extra,
  });

test("một lượt: khách hỏi 2 tin, nhân viên trả lời sau 45 phút → 1 lượt, 2 tin khách, chờ 45 phút, đúng hạn, công cho s1", () => {
  // 10/11/2026 là thứ 3
  const result = run([msg("2026-11-10T09:00:00", "c1", "Khách A"), msg("2026-11-10T09:10:00", "c1"), msg("2026-11-10T09:45:00", "s1", "Lan")]);
  const day = result.byDay.get("2026-11-10")!;
  assert.deepEqual(day, {
    customerMessages: 2, episodes: 1, answered: 1, answeredLate: 0, openEpisodes: 0, openOverdue: 0,
    waitSumSec: 2700, waitMaxSec: 2700, workWaitSumSec: 2700, workWaitMaxSec: 2700, staffMessages: 1,
  });
  const lan = result.byResponderDay.get(responderKey("2026-11-10", "s1"))!;
  assert.equal(lan.responderName, "Lan");
  assert.equal(lan.answered, 1);
  assert.equal(lan.waitSumSec, 2700);
  assert.equal(lan.staffMessages, 1);
});

test("tin nhân viên chủ động (không có lượt mở) chỉ đếm staffMessages; nhân viên thứ hai nói thêm không được tính lượt", () => {
  const result = run([
    msg("2026-11-10T08:00:00", "s1"), msg("2026-11-10T09:00:00", "c1"), msg("2026-11-10T09:05:00", "s2"), msg("2026-11-10T09:06:00", "s1"),
  ]);
  const day = result.byDay.get("2026-11-10")!;
  assert.equal(day.episodes, 1);
  assert.equal(day.answered, 1);
  assert.equal(day.staffMessages, 3);
  assert.equal(result.byResponderDay.get(responderKey("2026-11-10", "s2"))!.answered, 1);
  assert.equal(result.byResponderDay.get(responderKey("2026-11-10", "s1"))!.answered, 0);
  assert.equal(result.byResponderDay.get(responderKey("2026-11-10", "s1"))!.staffMessages, 2);
});

test("trễ tính theo PHÚT LÀM VIỆC: khách nhắn 17:00, trả lời 08:40 hôm sau = 40 phút làm (đúng hạn) dù giờ thường gần 16 tiếng", () => {
  const result = run([msg("2026-11-10T17:00:00", "c1"), msg("2026-11-11T08:40:00", "s1")]);
  const day = result.byDay.get("2026-11-10")!;
  assert.equal(day.answered, 1);
  assert.equal(day.answeredLate, 0);
  assert.equal(day.workWaitSumSec, 40 * 60);
  assert.equal(day.waitSumSec, (15 * 60 + 40) * 60);
  // Lượt tính vào ngày MỞ (10/11), ngày 11/11 chỉ có tin nhân viên
  assert.equal(result.byDay.get("2026-11-11")!.episodes, 0);
  assert.equal(result.byDay.get("2026-11-11")!.staffMessages, 1);
});

test("trả lời sau 2 giờ 1 phút làm việc là trễ; lượt chưa trả lời đến mốc tính là đang mở, quá ngưỡng là mở quá hạn", () => {
  const late = run([msg("2026-11-10T09:00:00", "c1"), msg("2026-11-10T11:01:00", "s1")]);
  assert.equal(late.byDay.get("2026-11-10")!.answeredLate, 1);
  const open = run([msg("2026-11-10T09:00:00", "c1"), msg("2026-11-10T16:00:00", "c2")], vn("2026-11-10T16:30:00"));
  const day = open.byDay.get("2026-11-10")!;
  assert.equal(day.episodes, 1, "hai tin khách liên tiếp vẫn một lượt");
  assert.equal(day.customerMessages, 2);
  assert.equal(day.openEpisodes, 1);
  assert.equal(day.openOverdue, 1);
  const fresh = run([msg("2026-11-10T16:00:00", "c1")], vn("2026-11-10T16:30:00"));
  assert.equal(fresh.byDay.get("2026-11-10")!.openOverdue, 0);
});

test("fromDay: tin trước cửa sổ chỉ dựng trạng thái — lượt mở hôm trước được trả lời hôm nay không bị đếm lại, tin hôm nay vẫn đếm", () => {
  const result = run([msg("2026-11-09T17:00:00", "c1"), msg("2026-11-10T08:35:00", "s1"), msg("2026-11-10T09:00:00", "c1"), msg("2026-11-10T09:20:00", "s1")],
    vn("2026-11-10T18:00:00"), { fromDay: "2026-11-10" });
  assert.equal(result.byDay.has("2026-11-09"), false);
  const day = result.byDay.get("2026-11-10")!;
  assert.equal(day.episodes, 1);
  assert.equal(day.answered, 1);
  assert.equal(day.staffMessages, 2);
  assert.equal(day.waitSumSec, 20 * 60);
});

test("không có lịch (workingMinutesBetween null) thì phút làm việc = giờ thường; slaMinutes 0 không bao giờ trễ", () => {
  const result = run([msg("2026-11-10T20:00:00", "c1"), msg("2026-11-10T23:00:00", "s1")], vn("2026-11-11T00:00:00"), { workingMinutesBetween: null, slaMinutes: 0 });
  const day = result.byDay.get("2026-11-10")!;
  assert.equal(day.workWaitSumSec, 3 * 3600);
  assert.equal(day.answeredLate, 0);
});
