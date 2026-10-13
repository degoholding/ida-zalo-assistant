import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { BriefKind } from "../constants.js";
import { buildReportWorkbook } from "./report-table.js";
import type { PeriodicReportData, ReportMeta } from "./periodic-report-types.js";
import { toPeriodicReportTable } from "./periodic-report-workbook.js";

const PERIOD = {
  from: new Date("2026-10-05T00:00:00Z"), to: new Date("2026-10-12T00:00:00Z"), periodKey: "2026-W41", periodLabel: "Tuần 41/2026",
  previous: { from: new Date("2026-09-28T00:00:00Z"), to: new Date("2026-10-05T00:00:00Z") },
};

const DATA: PeriodicReportData = {
  kind: BriefKind.Weekly,
  period: PERIOD,
  totals: {
    messages: { current: 120, previous: 100 }, urgent: { current: 5, previous: 4 }, important: { current: 3, previous: 2 },
    waitingOverdueOpen: { current: 1, previous: 0 }, responseMedianMinutes: { current: 20, previous: 18 },
    responseAverageMinutes: { current: 30, previous: 28 }, tasksCreated: { current: 10, previous: 8 },
    tasksDone: { current: 8, previous: 7 }, tasksDoneLate: { current: 1, previous: 1 }, tasksOverdueOpen: { current: 1, previous: 1 },
    ticketsCreated: { current: 4, previous: 3 }, ticketsClosed: { current: 3, previous: 2 }, ticketsOpen: { current: 2, previous: 2 },
  },
  groups: [
    { groupName: "K52", messages: 80, previousMessages: 70, urgent: 3, waitingOverdueOpen: 1, responseAverageMinutes: 25 },
    { groupName: "Kế toán", messages: 40, previousMessages: 30, urgent: 2, waitingOverdueOpen: 0, responseAverageMinutes: 35 },
  ],
  staff: [{ name: "Trần Được", messagesSent: 12, messagesHandled: 9, tasksDone: 3, tasksOverdue: 1 }],
  tasks: [{ code: "V-12", title: "Giao hàng K52", groupName: "K52", personName: "Mai", status: "Xong", at: new Date("2026-10-08T03:00:00Z") }],
  tickets: [{ code: "T-8", title: "Đổi hàng lỗi", groupName: "", personName: "Tuấn", status: "Mới", at: new Date("2026-10-09T02:00:00Z") }],
};

const META: ReportMeta = { recipientName: "Trần Được", scopeLabel: "Mọi nhóm", now: new Date("2026-10-12T01:00:00Z") };

test("toPeriodicReportTable: tab chính «Theo nhóm» có notes là các số tổng kèm kỳ trước", () => {
  const table = toPeriodicReportTable(DATA, META);
  assert.equal(table.title, "Báo cáo tuần");
  assert.equal(table.period, "Tuần 41/2026");
  assert.equal(table.notes[0], "Người nhận: Trần Được · Phạm vi: Mọi nhóm");
  assert.match(table.notes[1], /^Tin: 120 \(kỳ trước 100\)$/);
  assert.match(table.notes.find((n) => n.startsWith("Phản hồi trung vị"))!, /20 phút \(kỳ trước 18 phút\)/);
  assert.deepEqual(table.rows[0], ["K52", 80, 70, 3, 1, 25]);
});

test("toPeriodicReportTable: đủ 4 tab phụ theo đúng thứ tự", () => {
  const table = toPeriodicReportTable(DATA, META);
  assert.deepEqual(table.extraSheets.map((sheet) => sheet.title), ["Theo nhân viên", "Việc", "Ticket", "Bất thường"]);
  assert.deepEqual(table.extraSheets[0].rows[0], ["Trần Được", 12, 9, 3, 1]);
  assert.deepEqual(table.extraSheets[1].rows[0].slice(0, 5), ["V-12", "Giao hàng K52", "K52", "Mai", "Xong"]);
  assert.deepEqual(table.extraSheets[2].rows[0].slice(0, 5), ["T-8", "Đổi hàng lỗi", "(riêng)", "Tuấn", "Mới"]);
});

test("toPeriodicReportTable: nhóm im lặng kỳ này sinh dòng «Bất thường»", () => {
  const silent: PeriodicReportData = { ...DATA, groups: [...DATA.groups, { groupName: "Kho vận", messages: 0, previousMessages: 15, urgent: 0, waitingOverdueOpen: 0, responseAverageMinutes: 0 }] };
  const table = toPeriodicReportTable(silent, META);
  const anomalies = table.extraSheets.find((sheet) => sheet.title === "Bất thường")!;
  assert.ok(anomalies.rows.some((row) => String(row[0]).includes("Kho vận")));
});

test("toPeriodicReportTable: workbook thật mở lại được, đủ 5 tab", () => {
  const buffer = buildReportWorkbook(toPeriodicReportTable(DATA, META), "09/10/2026 08:00");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Báo cáo tuần", "Theo nhân viên", "Việc", "Ticket", "Bất thường"]);
});

test("toPeriodicReportTable: không nhóm / việc / ticket nào vẫn ra bảng hợp lệ (không rơi)", () => {
  const empty: PeriodicReportData = { ...DATA, groups: [], staff: [], tasks: [], tickets: [] };
  const buffer = buildReportWorkbook(toPeriodicReportTable(empty, META), "09/10/2026 08:00");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  assert.equal(workbook.SheetNames.length, 5);
});

const METRICS: NonNullable<PeriodicReportData["metrics"]> = {
  metrics: [
    { code: "doanh_so", label: "Doanh số", unit: "tr", current: 2100, previous: 1944, changePct: 8 },
    { code: "ton_kho", label: "Tồn kho", unit: "bao", current: 3420, previous: null, changePct: null },
  ],
  staff: [
    { name: "Lan", flagged: true, figures: { doanh_so: { current: 1200, previous: 1000, changePct: 20 } } },
    { name: "Minh", flagged: false, figures: { doanh_so: { current: 900, previous: 944, changePct: -4.7 }, ton_kho: { current: 3420, previous: null, changePct: null } } },
  ],
  areas: [{ name: "Miền Tây", flagged: false, figures: { doanh_so: { current: 2100, previous: 1944, changePct: 8 } } }],
  flaggedCount: 1,
};

test("toPeriodicReportTable: có số liệu → thêm sheet «Số liệu» (NV, TỔNG, khu vực); workbook 6 tab", () => {
  const table = toPeriodicReportTable({ ...DATA, metrics: METRICS }, META);
  const sheet = table.extraSheets.at(-1)!;
  assert.equal(sheet.title, "Số liệu");
  assert.equal(sheet.columns.length, 1 + 3 * 2);
  assert.deepEqual(sheet.rows[0], ["Lan (cần xác nhận)", 1200, 1000, 20, "", "", ""]);
  assert.deepEqual(sheet.rows[2], ["TỔNG", 2100, 1944, 8, 3420, "", ""]);
  assert.equal(sheet.rows[3][0], "Khu vực: Miền Tây");
  const workbook = XLSX.read(buildReportWorkbook(table, "09/10/2026 08:00"), { type: "buffer" });
  assert.equal(workbook.SheetNames.length, 6);
  assert.equal(workbook.SheetNames.at(-1), "Số liệu");
});

test("toPeriodicReportTable: không có số liệu → KHÔNG có sheet «Số liệu» (y hệt trước)", () => {
  const table = toPeriodicReportTable(DATA, META);
  assert.ok(!table.extraSheets.some((sheet) => sheet.title === "Số liệu"));
});
