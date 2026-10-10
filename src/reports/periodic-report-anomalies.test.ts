import assert from "node:assert/strict";
import { test } from "node:test";
import { BriefKind } from "../constants.js";
import { detectAnomalies } from "./periodic-report-anomalies.js";
import type { PeriodicReportData } from "./periodic-report-types.js";

const PERIOD = {
  from: new Date("2026-10-05T00:00:00Z"), to: new Date("2026-10-12T00:00:00Z"), periodKey: "2026-W41", periodLabel: "Tuần 41/2026",
  previous: { from: new Date("2026-09-28T00:00:00Z"), to: new Date("2026-10-05T00:00:00Z") },
};

const BASE: PeriodicReportData = {
  kind: BriefKind.Weekly,
  period: PERIOD,
  totals: {
    messages: { current: 100, previous: 90 },
    urgent: { current: 5, previous: 5 },
    important: { current: 3, previous: 3 },
    waitingOverdueOpen: { current: 0, previous: 0 },
    responseMedianMinutes: { current: 20, previous: 18 },
    responseAverageMinutes: { current: 30, previous: 28 },
    tasksCreated: { current: 10, previous: 8 },
    tasksDone: { current: 8, previous: 7 },
    tasksDoneLate: { current: 1, previous: 1 },
    tasksOverdueOpen: { current: 1, previous: 1 },
    ticketsCreated: { current: 4, previous: 3 },
    ticketsClosed: { current: 3, previous: 2 },
    ticketsOpen: { current: 2, previous: 2 },
  },
  groups: [],
  staff: [],
  tasks: [],
  tickets: [],
};

test("detectAnomalies: không có gì bất thường thì mảng rỗng", () => {
  assert.deepEqual(detectAnomalies(BASE), []);
});

test("detectAnomalies: khẩn tăng ≥ 30% so kỳ trước", () => {
  const data: PeriodicReportData = { ...BASE, totals: { ...BASE.totals, urgent: { current: 10, previous: 6 } } };
  const result = detectAnomalies(data);
  assert.equal(result.length, 1);
  assert.match(result[0], /KHẨN tăng mạnh.*10 kỳ này so 6 kỳ trước.*▲ 67%/);
});

test("detectAnomalies: khẩn mới xuất hiện (kỳ trước 0) vẫn báo, không chia cho 0", () => {
  const data: PeriodicReportData = { ...BASE, totals: { ...BASE.totals, urgent: { current: 3, previous: 0 } } };
  assert.match(detectAnomalies(data)[0], /mới xuất hiện/);
});

test("detectAnomalies: nhóm phản hồi TB ≥ 2× mức chung", () => {
  const data: PeriodicReportData = {
    ...BASE,
    groups: [
      { groupName: "K52", messages: 10, previousMessages: 10, urgent: 0, waitingOverdueOpen: 0, responseAverageMinutes: 90 },
      { groupName: "Kế toán", messages: 10, previousMessages: 10, urgent: 0, waitingOverdueOpen: 0, responseAverageMinutes: 35 },
    ],
  };
  const result = detectAnomalies(data);
  assert.equal(result.length, 1);
  assert.match(result[0], /K52.*phản hồi chậm.*90 phút.*chung 30 phút/);
});

test("detectAnomalies: nhóm im lặng (kỳ trước có tin, kỳ này 0)", () => {
  const data: PeriodicReportData = {
    ...BASE,
    groups: [{ groupName: "Kho vận", messages: 0, previousMessages: 25, urgent: 0, waitingOverdueOpen: 0, responseAverageMinutes: 0 }],
  };
  assert.match(detectAnomalies(data)[0], /Kho vận.*im lặng.*kỳ trước 25 tin/);
});

test("detectAnomalies: việc quá hạn còn mở ≥ 5", () => {
  const data: PeriodicReportData = { ...BASE, totals: { ...BASE.totals, tasksOverdueOpen: { current: 5, previous: 1 } } };
  assert.match(detectAnomalies(data)[0], /Việc quá hạn còn mở: 5 việc/);
});

test("detectAnomalies: việc quá hạn mở dưới ngưỡng (4) thì không báo", () => {
  const data: PeriodicReportData = { ...BASE, totals: { ...BASE.totals, tasksOverdueOpen: { current: 4, previous: 1 } } };
  assert.deepEqual(detectAnomalies(data), []);
});

test("detectAnomalies: tin chờ quá giờ còn mở cuối kỳ > 0", () => {
  const data: PeriodicReportData = { ...BASE, totals: { ...BASE.totals, waitingOverdueOpen: { current: 2, previous: 0 } } };
  assert.match(detectAnomalies(data)[0], /Tin chờ trả lời quá giờ còn mở cuối kỳ: 2 tin/);
});

test("detectAnomalies: nhiều bất thường cùng lúc vẫn cắt còn tối đa 5, đúng thứ tự ưu tiên", () => {
  const data: PeriodicReportData = {
    ...BASE,
    totals: {
      ...BASE.totals,
      urgent: { current: 10, previous: 5 },
      tasksOverdueOpen: { current: 6, previous: 1 },
      waitingOverdueOpen: { current: 3, previous: 0 },
    },
    groups: [
      { groupName: "A", messages: 10, previousMessages: 10, urgent: 0, waitingOverdueOpen: 0, responseAverageMinutes: 100 },
      { groupName: "B", messages: 10, previousMessages: 10, urgent: 0, waitingOverdueOpen: 0, responseAverageMinutes: 95 },
      { groupName: "C", messages: 0, previousMessages: 8, urgent: 0, waitingOverdueOpen: 0, responseAverageMinutes: 0 },
    ],
  };
  const result = detectAnomalies(data);
  assert.equal(result.length, 5);
  assert.match(result[0], /KHẨN tăng mạnh/);
  assert.match(result[1], /A.*phản hồi chậm/);
  assert.match(result[2], /B.*phản hồi chậm/);
  assert.match(result[3], /C.*im lặng/);
  assert.match(result[4], /Việc quá hạn còn mở/);
});
