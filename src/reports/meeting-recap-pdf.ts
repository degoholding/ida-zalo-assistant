import type { MeetingRecap, RecapSection, RecapVariant, TaskPriority } from "./meeting-recap-input.js";
import { COLOR, LOGO, MAIN_FONT, getEngine } from "./pdf-engine.js";
import { GlyphCoverage, toTextRuns } from "./pdf-text-runs.js";

// Dựng PDF recap cuộc họp theo mẫu «Meeting Recap» của DEGO (06/10/2026): logo + «RECAP HỌP» · tiêu đề lớn · bảng
// thông tin · khung TL;DR vàng · thanh mục xanh · bảng · định hướng ✓ · công việc (ưu tiên tô màu) · mốc thời gian ·
// vấn đề mở · người tham dự. Máy dựng PDF dùng chung (pdfmake + font + logo) nằm ở pdf-engine.ts (phase 3, 09/10/2026).

const PRIORITY_STYLE: Record<TaskPriority, { fill: string; color: string }> = {
  Cao: { fill: "#fde4e4", color: "#c0392b" }, TB: { fill: "#fff3d6", color: "#b7791f" }, Thấp: { fill: "#e5f5ea", color: "#2f855a" },
};

/** Nhãn theo loại bản: recap họp (mẫu gốc) / tóm tắt tài liệu. */
const LABELS: Record<RecapVariant, { kicker: string; kickerEn: string; decisions: string; sources: string; sourcePrefix: string; footer: string; subject: string }> = {
  meeting: {
    kicker: "RECAP HỌP", kickerEn: "MEETING RECAP", decisions: "ĐỊNH HƯỚNG ĐÃ THỐNG NHẤT", sources: "Người tham dự & nguồn",
    sourcePrefix: "Ghi âm gốc", footer: "Bản recap nội bộ", subject: "Meeting Recap",
  },
  document: {
    kicker: "TÓM TẮT TÀI LIỆU", kickerEn: "DOCUMENT SUMMARY", decisions: "NHẬN XÉT & KẾT LUẬN", sources: "Nguồn",
    sourcePrefix: "Tài liệu gốc", footer: "Bản tóm tắt nội bộ", subject: "Document Summary",
  },
};

export function buildRecapDocument(recap: MeetingRecap, coverage: Pick<GlyphCoverage, "fontFor">, logoPath: string | null = LOGO): object {
  const rich = (value: string) => toTextRuns(value, coverage, COLOR.tealText, MAIN_FONT);
  const labels = LABELS[recap.variant];
  const bullets = (items: string[]) => ({ ul: items.map((item) => ({ text: rich(item) })), markerColor: COLOR.teal, margin: [0, 2, 0, 6] });
  const sectionBar = (heading: string) => ({
    table: { widths: ["*"], body: [[{ text: rich(heading.toUpperCase()), color: "white", fontSize: 11 }]] },
    layout: {
      fillColor: () => COLOR.teal, hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 4 : 0), vLineColor: () => COLOR.green,
      paddingLeft: () => 8, paddingTop: () => 4, paddingBottom: () => 4,
    },
    margin: [0, 10, 0, 4],
  });
  const subBar = (heading: string) => ({
    table: { widths: ["*"], body: [[{ text: rich(heading), color: COLOR.tealText }]] },
    layout: { fillColor: () => COLOR.tealLight, hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 3 : 0), vLineColor: () => COLOR.teal, paddingTop: () => 3, paddingBottom: () => 3 },
    margin: [0, 6, 0, 2],
  });
  const dataTable = (columns: string[], rows: object[][], widths: (string | number)[]) => ({
    table: { headerRows: 1, keepWithHeaderRows: 1, widths, body: [columns.map((column) => ({ text: column, color: "white", fontSize: 9 })), ...rows] },
    layout: {
      fillColor: (row: number) => (row === 0 ? COLOR.teal : null), hLineColor: () => COLOR.border, vLineColor: () => COLOR.border,
      hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 4, paddingBottom: () => 4,
    },
    fontSize: 9, margin: [0, 2, 0, 6],
  });
  // Khối ngắn (thanh mục + nội dung) không tách trang — tránh thanh mục / đầu bảng nằm trơ cuối trang (gặp 06/10/2026)
  const keepTogether = (parts: object[], size: number) => (size <= 12 ? [{ stack: parts, unbreakable: true }] : parts);
  const section = (item: RecapSection) => [
    sectionBar(item.heading),
    ...(item.bullets.length ? [bullets(item.bullets)] : []),
    ...item.subsections.flatMap((sub) => [subBar(sub.heading), bullets(sub.bullets)]),
    ...(item.table ? [dataTable(item.table.columns, item.table.rows.map((row) => row.map((cell) => ({ text: rich(cell) }))), item.table.columns.map((column) => (/^(stt|tt|#)$/i.test(column.trim()) ? 26 : "*")))] : []),
  ];
  const label = (value: string) => ({ text: value, color: COLOR.tealText, fillColor: COLOR.tealLight });
  const attendeeLines = recap.attendees.map((person) => ({ text: [{ text: person.role ? `${person.role}: ` : "", color: COLOR.tealText }, ...rich(person.name)] }));

  const content: object[] = [
    {
      columns: [
        logoPath ? { image: logoPath, width: 120 } : { text: "DEGO HOLDING", fontSize: 18, bold: true, color: COLOR.green },
        { stack: [
          { text: labels.kicker, fontSize: 13, color: COLOR.tealText },
          { text: labels.kickerEn, fontSize: 8, italics: true, color: COLOR.muted },
          { text: `Mã văn bản: ${recap.docCode}`, fontSize: 7.5, color: COLOR.text },
          { text: `Phiên bản: ${recap.version}`, fontSize: 7.5, color: COLOR.text },
        ], alignment: "right" },
      ],
    },
    { canvas: [{ type: "line", x1: 0, y1: 4, x2: 515, y2: 4, lineWidth: 1.5, lineColor: COLOR.teal }], margin: [0, 2, 0, 10] },
    { text: rich(recap.title.toUpperCase()), fontSize: 19, color: COLOR.tealText, alignment: "center", margin: [30, 0, 30, 4] },
    ...(recap.subtitle ? [{ text: rich(recap.subtitle), italics: true, color: COLOR.muted, alignment: "center", margin: [0, 0, 0, 10] }] : []),
    {
      table: { widths: [70, "*", 70, "*"], body: recap.variant === "meeting" ? [
        [label("Ngày họp"), recap.meetingDate || "—", label("Thời lượng"), recap.duration || "—"],
        [label("Hình thức"), recap.format, label("Thư ký"), recap.secretary],
        ...(attendeeLines.length ? [[label("Thành phần"), { stack: attendeeLines, colSpan: 3 }, {}, {}]] : []),
      ] : [
        [label("Ngày"), recap.meetingDate || "—", label("Thực hiện"), recap.secretary],
        [label("Nguồn"), { text: rich(recap.source || "—"), colSpan: 3 }, {}, {}],
      ] },
      layout: { hLineColor: () => COLOR.border, vLineColor: () => COLOR.border, hLineWidth: () => 0.5, vLineWidth: (i: number) => (i === 0 ? 3 : 0.5), paddingTop: () => 4, paddingBottom: () => 4 },
      fontSize: 9.5,
    },
    { text: recap.disclaimer, italics: true, fontSize: 7.5, color: COLOR.muted, margin: [0, 4, 0, 8] },
  ];
  if (recap.tldr.length) {
    content.push({
      table: { widths: ["*"], body: [[{ stack: [{ text: "TL;DR — Tóm tắt nhanh", color: COLOR.tealText, margin: [0, 0, 0, 4] }, bullets(recap.tldr)] }]] },
      layout: { fillColor: () => COLOR.tldrBg, hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 3 : 0), vLineColor: () => COLOR.tldrBorder, paddingLeft: () => 10, paddingTop: () => 8, paddingBottom: () => 6 },
      margin: [0, 0, 0, 6],
    });
  }
  recap.sections.forEach((item, index) => content.push(...section({ ...item, heading: /^\d+\./.test(item.heading) ? item.heading : `${index + 1}. ${item.heading}` })));
  if (recap.decisions.length) {
    content.push({ text: labels.decisions, color: COLOR.tealText, fontSize: 10, margin: [0, 10, 0, 4] });
    // Dấu ✓ không có trong Be Vietnam Pro — rich() tự chuyển sang font ký hiệu
    content.push({ stack: recap.decisions.map((item) => ({ text: [...rich("✓  ").map((run) => ({ ...run, color: COLOR.teal })), ...rich(item)], margin: [0, 1, 0, 2] })), margin: [0, 0, 0, 6] });
  }
  if (recap.tasks.length) {
    content.push(...keepTogether([sectionBar("Công việc cần làm"), dataTable(["STT", "Việc", "Người", "Hạn", "Ưu tiên"], recap.tasks.map((task, index) => [
      { text: String(index + 1), alignment: "center" }, { text: rich(task.task) }, { text: rich(task.owner) }, { text: rich(task.due || "—") },
      { text: task.priority, alignment: "center", color: PRIORITY_STYLE[task.priority].color, fillColor: PRIORITY_STYLE[task.priority].fill },
    ]), [24, "*", 90, 62, 46])], recap.tasks.length));
  }
  if (recap.timeline.length) {
    content.push(...keepTogether([sectionBar("Mốc thời gian"), dataTable(["STT", "Mốc", "Nội dung"], recap.timeline.map((item, index) => [
      { text: String(index + 1), alignment: "center" }, { text: rich(item.when), color: COLOR.tealText }, { text: rich(item.content) },
    ]), [24, 110, "*"])], recap.timeline.length));
  }
  if (recap.openIssues.length) content.push(...keepTogether([sectionBar("Vấn đề còn mở"), bullets(recap.openIssues)], recap.openIssues.length));
  if (recap.sideNotes.length) content.push({ text: "GHI CHÚ NGOÀI LỀ", color: COLOR.tealText, fontSize: 10, margin: [0, 6, 0, 2] }, bullets(recap.sideNotes));
  // Bản tóm tắt tài liệu đã ghi nguồn ở bảng thông tin đầu trang
  if (recap.variant === "meeting" && (recap.attendees.length || recap.source)) {
    const people = [...recap.attendees.map((person) => (person.role ? `${person.name} — ${person.role}` : person.name)), ...(recap.source ? [`${labels.sourcePrefix}: ${recap.source}`] : [])];
    content.push(...keepTogether([sectionBar(labels.sources), bullets(people)], people.length));
  }

  return {
    pageSize: "A4",
    pageMargins: [40, 36, 40, 56],
    defaultStyle: { font: MAIN_FONT, fontSize: 10, color: COLOR.text, lineHeight: 1.25 },
    info: { title: recap.title, author: "Bot trợ lý — DEGO HOLDING", subject: labels.subject },
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 14, 40, 0],
      stack: [
        { columns: [
          { text: "DEGO HOLDING · Cần Thơ, Việt Nam", fontSize: 7, color: COLOR.muted },
          { text: "Tài liệu nội bộ · Lưu hành hạn chế", fontSize: 7, color: COLOR.muted, alignment: "center" },
          { text: `Bot trợ lý · ${currentPage}/${pageCount}`, fontSize: 7, color: COLOR.muted, alignment: "right" },
        ] },
        { text: `${labels.footer} · ${recap.title} · Lưu hành hạn chế`, fontSize: 6.5, italics: true, color: COLOR.muted, alignment: "center" },
      ],
    }),
    content,
  };
}

export async function renderRecapPdf(recap: MeetingRecap): Promise<Buffer> {
  const { pdfmake, coverage } = getEngine();
  return pdfmake.createPdf(buildRecapDocument(recap, coverage)).getBuffer();
}
