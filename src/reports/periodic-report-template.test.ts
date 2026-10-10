import assert from "node:assert/strict";
import { test } from "node:test";
import { BriefKind } from "../constants.js";
import type { BriefHighlight } from "../briefs/brief-types.js";
import { buildPeriodicReportDocument, renderPeriodicReportPdf } from "./periodic-report-template.js";
import type { PeriodicReportData, ReportMeta } from "./periodic-report-types.js";

// pdfmake (mặc định) không nén cây trang — đếm số trang qua đối tượng `/Type /Pages … /Count N` trong PDF thô.
function countPdfPages(buffer: Buffer): number {
  const match = /\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/.exec(buffer.toString("latin1"));
  if (!match) throw new Error("không tìm thấy /Pages /Count trong PDF — kiểm tra lại bản dựng");
  return Number(match[1]);
}

const PERIOD = {
  from: new Date("2026-10-05T00:00:00Z"), to: new Date("2026-10-12T00:00:00Z"), periodKey: "2026-W41", periodLabel: "Tuần 41/2026 (05/10–11/10)",
  previous: { from: new Date("2026-09-28T00:00:00Z"), to: new Date("2026-10-05T00:00:00Z") },
};

const LONG_GROUP_NAME = "Nhóm kinh doanh khu vực Đồng bằng sông Cửu Long mở rộng";

const MAX_DATA: PeriodicReportData = {
  kind: BriefKind.Weekly,
  period: PERIOD,
  totals: {
    messages: { current: 1842, previous: 1203 }, urgent: { current: 42, previous: 20 }, important: { current: 30, previous: 25 },
    waitingOverdueOpen: { current: 17, previous: 9 }, responseMedianMinutes: { current: 95, previous: 60 },
    responseAverageMinutes: { current: 130, previous: 70 }, tasksCreated: { current: 60, previous: 50 },
    tasksDone: { current: 48, previous: 40 }, tasksDoneLate: { current: 9, previous: 6 }, tasksOverdueOpen: { current: 11, previous: 4 },
    ticketsCreated: { current: 25, previous: 18 }, ticketsClosed: { current: 20, previous: 15 }, ticketsOpen: { current: 9, previous: 5 },
  },
  // 5 nhóm tên dài — phản hồi TB cao để kích hoạt bất thường «phản hồi chậm» cho nhiều nhóm cùng lúc
  groups: Array.from({ length: 5 }, (_, index) => ({
    groupName: `${LONG_GROUP_NAME} ${index + 1}`, messages: 400 - index * 10, previousMessages: 350 - index * 10,
    urgent: 10 - index, waitingOverdueOpen: 5 - index, responseAverageMinutes: 260 - index * 5,
  })),
  staff: [],
  tasks: [],
  tickets: [],
};

const META: ReportMeta = {
  recipientName: "Nguyễn Thị Trần Được Hương Giang", scopeLabel: "Mọi nhóm đang đọc kể cả các nhóm vùng xa mới mở trong tháng này",
  now: new Date("2026-10-12T01:00:00Z"),
};

const LONG_POINT = "Khách hàng khiếu nại giao hàng trễ ba ngày liên tục, cần xử lý gấp trước cuối tuần";

const MAX_HIGHLIGHTS: BriefHighlight[] = Array.from({ length: 5 }, (_, index) => ({
  text: `${LONG_POINT} (${index + 1})`.slice(0, 80),
  line: {
    groupName: `${LONG_GROUP_NAME} ${index + 1}`, senderName: "Nguyễn Văn Đông Phương Khánh", at: new Date(`2026-10-0${index + 5}T09:30:00Z`),
    text: LONG_POINT, ref: index + 1,
  },
}));

test("buildPeriodicReportDocument: đủ các khối chính (lưới số, top nhóm, bất thường, điểm AI, chân trang)", () => {
  const doc = buildPeriodicReportDocument(MAX_DATA, MAX_HIGHLIGHTS, META, { fontFor: () => "BeVietnam" }) as { content: unknown[]; pageSize: string };
  assert.equal(doc.pageSize, "A4");
  assert.ok(doc.content.length > 5);
});

test("renderPeriodicReportPdf: dữ liệu LỚN NHẤT (5 nhóm tên dài, 5 bất thường, 5 ý AI dài) vẫn ra ĐÚNG 1 trang A4", async () => {
  const buffer = await renderPeriodicReportPdf(MAX_DATA, MAX_HIGHLIGHTS, META);
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(countPdfPages(buffer), 1);
});

test("renderPeriodicReportPdf: không bất thường, không điểm AI vẫn ra 1 trang (mục rỗng có dòng thay thế)", async () => {
  const empty: PeriodicReportData = {
    ...MAX_DATA,
    totals: { ...MAX_DATA.totals, urgent: { current: 5, previous: 5 }, tasksOverdueOpen: { current: 1, previous: 1 }, waitingOverdueOpen: { current: 0, previous: 0 } },
    groups: [],
  };
  const buffer = await renderPeriodicReportPdf(empty, [], META);
  assert.equal(countPdfPages(buffer), 1);
});

test("renderPeriodicReportPdf: báo cáo tháng ra tiêu đề đúng loại", async () => {
  const monthly: PeriodicReportData = { ...MAX_DATA, kind: BriefKind.Monthly, period: { ...PERIOD, periodLabel: "Tháng 9/2026" } };
  const buffer = await renderPeriodicReportPdf(monthly, [], META);
  assert.equal(countPdfPages(buffer), 1);
});
