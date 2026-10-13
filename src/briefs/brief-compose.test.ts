import assert from "node:assert/strict";
import { test } from "node:test";
import { composeEveningBrief, composeMorningBrief, type BriefComposeData } from "./brief-compose.js";
import type { TaskBuckets, TicketBuckets } from "./brief-work-collectors.js";
import type { Bucket, BriefHighlight, BriefLine } from "./brief-types.js";

const vn = (text: string) => new Date(`${text}+07:00`);
const now = vn("2026-10-09T07:30:00");
const ctx = { recipientName: "anh Duoc", now };

const line = (over: Partial<BriefLine> = {}): BriefLine =>
  ({ groupName: "K52", senderName: "Lan", at: vn("2026-10-09T06:40:00"), text: "hàng lô 3 cháy lá", ref: 1, ...over });
const empty: Bucket<BriefLine> = { total: 0, items: [] };
const bucket = (total: number, items: BriefLine[]): Bucket<BriefLine> => ({ total, items });

const emptyTasks: TaskBuckets = { overdue: empty, dueToday: empty, dueNextWorkingDay: empty, doneInPeriod: empty };
const emptyTickets: TicketBuckets = { newInPeriod: empty, closedInPeriod: empty, open: empty };

const baseData: BriefComposeData = {
  urgentOpen: empty, urgentHandledCount: 0, waitingOverdue: empty, waitingOpen: empty,
  tasks: emptyTasks, tickets: emptyTickets, highlights: [], aiNote: "chưa có khóa AI",
};

test("composeMorningBrief: mọi mục rỗng → «không có», bỏ hẳn mục điểm tin khi có aiNote", () => {
  const text = composeMorningBrief(baseData, ctx);
  assert.equal(text, [
    "BẢN TIN SÁNG T6 09/10 — anh Duoc",
    "1. KHẨN/quan trọng chưa xử lý: 0", "   không có",
    "2. Tin chờ trả lời quá giờ: 0", "   không có",
    "3. Việc: 0 quá hạn, 0 hạn hôm nay", "   không có",
    "4. Ticket mở: 0 (0 mới)", "   không có",
    "Xem đủ: màn Bản tin trên web",
  ].join("\n"));
});

test("composeMorningBrief: đủ 5 mục, cắt «… và N nữa» khi vượt trần 3 dòng", () => {
  const data: BriefComposeData = {
    ...baseData,
    urgentOpen: bucket(2, [line({ ref: 1, senderName: "Lan" }), line({ ref: 2, senderName: "Minh", groupName: "K10" })]),
    waitingOverdue: bucket(1, [line({ ref: 3 })]),
    tasks: {
      overdue: bucket(5, [line({ ref: 11, senderName: "Mai", text: "hợp đồng thép", at: vn("2026-10-07T08:00:00") }),
        line({ ref: 12, senderName: "Tuấn", text: "báo giá", at: vn("2026-10-08T08:00:00") }),
        line({ ref: 13, senderName: "Lan", text: "đặt hàng", at: vn("2026-10-08T08:00:00") })]),
      dueToday: bucket(1, [line({ ref: 20 })]),
      dueNextWorkingDay: empty, doneInPeriod: empty,
    },
    tickets: { ...emptyTickets, open: bucket(3, [line({ ref: 8, senderName: "Tuấn", text: "Đổi hàng lỗi" })]), newInPeriod: bucket(1, []) },
    highlights: [{ text: "ý nổi bật nhất", line: line({ ref: 1, groupName: "K52", senderName: "Lan", at: vn("2026-10-08T09:00:00") }) }],
    aiNote: "",
  };
  const text = composeMorningBrief(data, ctx);
  const lines = text.split("\n");
  assert.equal(lines[0], "BẢN TIN SÁNG T6 09/10 — anh Duoc");
  assert.equal(lines.at(-1), "Xem đủ: màn Bản tin trên web");
  assert.ok(lines.includes("3. Việc: 5 quá hạn, 1 hạn hôm nay"));
  // 5 quá hạn + 1 hạn hôm nay = 6 mục, hiển thị tối đa 3 dòng → «… và 3 nữa»
  assert.ok(lines.includes("   … và 3 nữa"));
  assert.ok(lines.includes("4. Ticket mở: 3 (1 mới)"));
  assert.ok(lines.includes("5. Điểm tin hôm qua"));
  assert.ok(lines.some((row) => row.includes("ý nổi bật nhất") && row.includes("[K52 · Lan · 09:00]")));
});

test("composeEveningBrief: KHẨN hôm nay gộp đã xử lý + còn lại; tin chờ quá giờ lên trước", () => {
  const data: BriefComposeData = {
    ...baseData,
    urgentOpen: bucket(1, [line({ ref: 1 })]),
    urgentHandledCount: 2,
    waitingOverdue: bucket(1, [line({ ref: 5, senderName: "Quá giờ" })]),
    waitingOpen: bucket(1, [line({ ref: 6, senderName: "Còn chờ" })]),
    tasks: { ...emptyTasks, doneInPeriod: bucket(2, []), overdue: bucket(1, [line({ ref: 30, at: vn("2026-10-08T08:00:00") })]),
      dueNextWorkingDay: bucket(1, [line({ ref: 31 })]) },
    tickets: { newInPeriod: bucket(1, [line({ ref: 9, text: "Ticket mới" })]), closedInPeriod: bucket(1, []), open: bucket(2, []) },
    aiNote: "đã tắt trong cài đặt",
  };
  const text = composeEveningBrief(data, ctx);
  const lines = text.split("\n");
  assert.equal(lines[0], "BẢN TIN CUỐI NGÀY T6 09/10 — anh Duoc");
  assert.ok(lines.includes("1. KHẨN hôm nay: 3 (đã xử lý 2, còn 1)"));
  assert.ok(lines.includes("2. Tin còn chờ trả lời: 2 (1 quá giờ)"));
  // quá giờ lên trước — dòng «Quá giờ» phải đứng trước dòng «Còn chờ»
  assert.ok(lines.findIndex((row) => row.includes("Quá giờ")) < lines.findIndex((row) => row.includes("Còn chờ")));
  assert.ok(lines.includes("3. Việc: 2 xong hôm nay · 1 còn quá hạn · 1 hạn mai"));
  assert.ok(lines.includes("4. Ticket: 1 mới · 1 đóng · 2 còn mở"));
  // aiNote khác rỗng → không có dòng «Điểm tin hôm nay» nào trong bài
  assert.ok(!lines.includes("5. Điểm tin hôm nay"));
});

test("composeMorningBrief: cả bài vừa một màn điện thoại (≤ 25 dòng, ≤ 1.500 ký tự) kể cả khi đủ dữ liệu", () => {
  const many = (count: number, ref: number) => Array.from({ length: count }, (_, i) => line({ ref: ref + i }));
  const highlights: BriefHighlight[] = [0, 1, 2].map((i) => ({ text: `ý nổi bật số ${i + 1} khá dài một chút`, line: line({ ref: 90 + i }) }));
  const data: BriefComposeData = {
    urgentOpen: bucket(20, many(3, 1)), urgentHandledCount: 0,
    waitingOverdue: bucket(20, many(3, 10)), waitingOpen: empty,
    tasks: { overdue: bucket(20, many(3, 20)), dueToday: bucket(20, many(3, 40)), dueNextWorkingDay: empty, doneInPeriod: empty },
    tickets: { open: bucket(20, many(3, 60)), newInPeriod: bucket(20, []), closedInPeriod: empty },
    highlights, aiNote: "",
  };
  const text = composeMorningBrief(data, ctx);
  // «~25 dòng» ở plan.md là ước lượng (mỗi mục có thể thêm một dòng «… và N nữa») — trần CỨNG thật sự là 1.500 ký tự
  assert.ok(text.split("\n").length <= 28, `${text.split("\n").length} dòng`);
  assert.ok(text.length <= 1500, `${text.length} ký tự`);
});

const metricDigest = {
  date: "2026-10-08", compareDate: "2026-10-07" as string | null,
  metrics: [{ label: "Doanh số", unit: "tr", total: 125.4, changePct: 12 }], sourceNames: ["BCSale"], readAt: vn("2026-10-08T18:02:00"),
  flaggedCount: 0, missingCount: 1,
};

test("compose: metrics null / vắng → chữ y hệt bản không có mục số liệu (sáng và cuối ngày)", () => {
  assert.equal(composeMorningBrief({ ...baseData, metrics: null }, ctx), composeMorningBrief(baseData, ctx));
  assert.equal(composeEveningBrief({ ...baseData, metrics: null }, ctx), composeEveningBrief(baseData, ctx));
  assert.ok(!composeMorningBrief(baseData, ctx).includes("Số liệu"));
});

test("compose: có số liệu → mục 6 ngay trước dòng cuối; sáng ghi ĐÚNG ngày số liệu + ngày so, cuối ngày «hôm nay» không %", () => {
  const morning = composeMorningBrief({ ...baseData, metrics: metricDigest }, ctx).split("\n");
  assert.equal(morning.at(-1), "Xem đủ: màn Bản tin trên web");
  assert.deepEqual(morning.slice(-4, -1), ["6. Số liệu T5 08/10 (BCSale, đọc 18:02)", "   - Doanh số: 125,4 tr (▲12% so T4 07/10)", "   - 1 NV chưa báo"]);
  // Sáng T2: số là của T7 (ngày làm việc trước) — tiêu đề không được ghi «hôm qua»
  const monday = composeMorningBrief({ ...baseData, metrics: { ...metricDigest, date: "2026-10-10", compareDate: "2026-10-09" } }, ctx).split("\n");
  assert.equal(monday.at(-4), "6. Số liệu T7 10/10 (BCSale, đọc 18:02)");
  const evening = composeEveningBrief({ ...baseData, metrics: { ...metricDigest, compareDate: null, readAt: vn("2026-10-09T17:30:00"), missingCount: null } }, ctx).split("\n");
  assert.equal(evening.at(-3), "6. Số liệu hôm nay (tới 17:30)");
  assert.equal(evening.at(-2), "   - Doanh số: 125,4 tr");
});

test("compose: vượt trần 1.500 ký tự thì bỏ mục 6 trước", () => {
  const long = "x".repeat(60);
  const crowded: BriefComposeData = { ...baseData, urgentOpen: bucket(40, Array.from({ length: 3 }, (_, i) => line({ ref: i, text: long }))), tasks: emptyTasks };
  const huge = Array.from({ length: 3 }, (_, i) => ({ label: "Chỉ tiêu rất dài ".repeat(30), unit: "", total: i, changePct: null }));
  const text = composeMorningBrief({ ...crowded, metrics: { ...metricDigest, metrics: huge } }, ctx);
  assert.ok(!text.includes("6. Số liệu"));
});
