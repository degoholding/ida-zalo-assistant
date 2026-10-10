import { BriefKind } from "../constants.js";
import { clock } from "../briefs/brief-format.js";
import type { BriefHighlight } from "../briefs/brief-types.js";
import { COLOR, LOGO, MAIN_FONT, getEngine } from "./pdf-engine.js";
import type { GlyphCoverage } from "./pdf-text-runs.js";
import { toTextRuns } from "./pdf-text-runs.js";
import { detectAnomalies } from "./periodic-report-anomalies.js";
import type { MetricPair, PeriodicReportData, ReportMeta } from "./periodic-report-types.js";

// KHUÔN TẠM báo cáo tuần / tháng (phase 3, chốt 09/10/2026) — A4 dọc, ĐÚNG 1 TRANG: logo + tiêu đề + kỳ/người nhận/
// phạm vi · lưới 6 ô số (kèm ▲▼ so kỳ trước) · bảng top 5 nhóm · «Bất thường» · «Điểm nổi bật (AI)» · chân trang
// «Khuôn tạm — chờ form IDA». Đổi khuôn thật (IDA gửi form) = viết lại tệp NÀY cùng chữ ký `buildPeriodicReportDocument`,
// không đụng phần gom số liệu / gửi (periodic-report-builder.ts). Mọi danh sách CẮT CỨNG theo trần để không tràn trang.

const TOP_GROUPS_LIMIT = 5;
const GROUP_NAME_MAX_CHARS = 26;
const KIND_LABEL: Record<BriefKind.Weekly | BriefKind.Monthly, string> = { [BriefKind.Weekly]: "BÁO CÁO TUẦN", [BriefKind.Monthly]: "BÁO CÁO THÁNG" };

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** «▲ 12 so kỳ trước (90)» / «▼ 3 so kỳ trước (8)» / «– như kỳ trước» — không gán tốt/xấu, chỉ báo chiều đổi. */
function trendText(pair: MetricPair): string {
  if (pair.current === pair.previous) return "– như kỳ trước";
  const arrow = pair.current > pair.previous ? "▲" : "▼";
  return `${arrow} ${Math.abs(pair.current - pair.previous)} so kỳ trước (${pair.previous})`;
}

export function buildPeriodicReportDocument(
  data: PeriodicReportData, ai: BriefHighlight[], meta: ReportMeta, coverage: Pick<GlyphCoverage, "fontFor">, logoPath: string | null = LOGO,
): object {
  const rich = (value: string) => toTextRuns(value, coverage, COLOR.tealText, MAIN_FONT);
  // ▲▼ không có trong Be Vietnam Pro — rich() tự chuyển ký tự đó sang font ký hiệu dự phòng (như dấu ✓ ở recap);
  // ép màu muted cho cả dòng vì rich() chỉ tô màu nhấn cho cụm «**…**» (không dùng ở đây).
  const mutedRich = (value: string) => rich(value).map((run) => ({ ...run, color: COLOR.muted }));
  const cell = (label: string, pair: MetricPair) => ({
    stack: [{ text: label, fontSize: 7, color: COLOR.muted }, { text: String(pair.current), fontSize: 15, color: COLOR.tealText },
      { text: mutedRich(trendText(pair)), fontSize: 6.5 }],
    margin: [6, 5, 6, 5],
  });
  const t = data.totals;
  const grid = {
    table: {
      widths: ["*", "*", "*"],
      body: [
        [cell("Tin", t.messages), cell("Khẩn", t.urgent), cell("Chờ quá giờ còn mở", t.waitingOverdueOpen)],
        [cell("Phản hồi TB (phút)", t.responseAverageMinutes), cell("Việc xong", t.tasksDone), cell("Ticket còn mở", t.ticketsOpen)],
      ],
    },
    layout: { hLineColor: () => COLOR.border, vLineColor: () => COLOR.border, hLineWidth: () => 0.5, vLineWidth: () => 0.5 },
    margin: [0, 8, 0, 10],
  };

  const topGroups = [...data.groups].sort((a, b) => b.messages - a.messages).slice(0, TOP_GROUPS_LIMIT);
  const groupsTable = {
    table: {
      headerRows: 1, widths: ["*", 40, 36, 60, 70],
      body: [
        ["Nhóm", "Tin", "Khẩn", "Chờ quá giờ", "Phản hồi TB"].map((text) => ({ text, color: "white", fontSize: 8 })),
        ...topGroups.map((group) => [
          truncate(group.groupName, GROUP_NAME_MAX_CHARS), String(group.messages), String(group.urgent),
          String(group.waitingOverdueOpen), `${group.responseAverageMinutes} phút`,
        ]),
      ],
    },
    layout: {
      fillColor: (row: number) => (row === 0 ? COLOR.teal : null), hLineColor: () => COLOR.border, vLineColor: () => COLOR.border,
      hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 3, paddingBottom: () => 3,
    },
    fontSize: 8, margin: [0, 2, 0, 8],
  };

  const bulletList = (items: string[]) => ({ ul: items.map((item) => ({ text: rich(item) })), markerColor: COLOR.teal, fontSize: 8, margin: [0, 2, 0, 8] });
  const sectionHeading = (text: string) => ({ text, fontSize: 10, color: COLOR.tealText, margin: [0, 4, 0, 2] });

  const anomalies = detectAnomalies(data);
  const highlightLines = ai.map((item) => `${item.text} [${item.line.groupName || "riêng"} · ${item.line.senderName || "?"} · ${clock(item.line.at)}]`);

  const content: object[] = [
    {
      columns: [
        logoPath ? { image: logoPath, width: 100 } : { text: "DEGO HOLDING", fontSize: 16, bold: true, color: COLOR.green },
        { stack: [
          { text: KIND_LABEL[data.kind], fontSize: 13, color: COLOR.tealText },
          { text: data.period.periodLabel, fontSize: 9, color: COLOR.text },
          { text: `Người nhận: ${meta.recipientName}`, fontSize: 8, color: COLOR.muted },
          { text: `Phạm vi: ${truncate(meta.scopeLabel, 70)}`, fontSize: 8, color: COLOR.muted },
        ], alignment: "right" },
      ],
    },
    { canvas: [{ type: "line", x1: 0, y1: 4, x2: 515, y2: 4, lineWidth: 1.5, lineColor: COLOR.teal }], margin: [0, 2, 0, 0] },
    grid,
    sectionHeading("Top 5 nhóm"),
    groupsTable,
    sectionHeading("Bất thường"),
    anomalies.length ? bulletList(anomalies) : { text: "Không có bất thường đáng chú ý", fontSize: 8, color: COLOR.muted, margin: [0, 0, 0, 8] },
    sectionHeading("Điểm nổi bật (AI)"),
    highlightLines.length ? bulletList(highlightLines) : { text: "Không có điểm tin AI kỳ này", fontSize: 8, color: COLOR.muted, margin: [0, 0, 0, 8] },
  ];

  return {
    pageSize: "A4",
    pageMargins: [36, 28, 36, 36],
    defaultStyle: { font: MAIN_FONT, fontSize: 9, color: COLOR.text, lineHeight: 1.15 },
    info: { title: `${KIND_LABEL[data.kind]} ${data.period.periodLabel}`, author: "Bot trợ lý — DEGO HOLDING", subject: "Periodic report" },
    footer: { text: "Khuôn tạm — chờ form IDA · Lưu hành hạn chế · Bot trợ lý DEGO HOLDING", fontSize: 6.5, italics: true, color: COLOR.muted, alignment: "center", margin: [36, 8, 36, 0] },
    content,
  };
}

/** Dựng PDF thật (buffer) — nơi gọi (periodic-report-builder.ts) không cần biết tới pdfmake / font. */
export async function renderPeriodicReportPdf(data: PeriodicReportData, ai: BriefHighlight[], meta: ReportMeta): Promise<Buffer> {
  const { pdfmake, coverage } = getEngine();
  return pdfmake.createPdf(buildPeriodicReportDocument(data, ai, meta, coverage)).getBuffer();
}
