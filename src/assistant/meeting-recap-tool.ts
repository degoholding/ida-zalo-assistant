import { RecapInputError, normalizeRecap, type MeetingRecap } from "../reports/meeting-recap-input.js";
import type { FunctionDeclaration } from "./gemini-client.js";

// Công cụ create_meeting_recap_pdf (06/10/2026): sau khi đọc file ghi âm cuộc họp (read_file), mô hình soạn recap
// theo mẫu «Meeting Recap» của DEGO rồi gọi công cụ này — máy chủ dựng PDF, cất kho và gửi tệp cho người hỏi (tin
// riêng) hoặc vào nhóm đang hỏi. Mỗi lượt hỏi một tệp (chung trần với export_report).

export type CreateRecapPdf = (recap: MeetingRecap) => Promise<Record<string, unknown>>;

const STRINGS = { type: "array", items: { type: "string" } };

export const MEETING_RECAP_PDF_DECLARATION: FunctionDeclaration = {
  name: "create_meeting_recap_pdf",
  description:
    "Xuất BẢN RECAP CUỘC HỌP ra tệp PDF theo mẫu công ty (gửi kèm sau câu trả lời). Dùng sau khi đã read_file bản ghi âm / " +
    "biên bản họp. ĐIỀN ĐỦ mọi phần ghi âm có nói: sections (nội dung theo chủ đề), decisions, tasks, timeline (mốc ngày), " +
    "open_issues (việc chưa chốt / chưa rõ người). Chỉ ghi điều có trong ghi âm — không bịa người, hạn, số liệu. " +
    "Dùng **cụm từ** để tô màu nhấn ý quan trọng.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Tên cuộc họp, vd 'Giao ban dự án K52'" },
      subtitle: { type: "string", description: "Một dòng mô tả: chủ đề / các bên tham gia" },
      meeting_date: { type: "string", description: "Ngày họp dd/mm/yyyy (không rõ thì ngày gửi file)" },
      duration: { type: "string", description: "Thời lượng, vd '~45 phút'" },
      format: { type: "string", description: "Hình thức, vd 'Google Meet', 'Trực tiếp'" },
      attendees: {
        type: "array",
        items: { type: "object", properties: { role: { type: "string" }, name: { type: "string" } } },
        description: "Thành phần: vai trò (CEO, Trưởng nhóm…) + tên",
      },
      tldr: { ...STRINGS, description: "TL;DR 3–6 ý quan trọng nhất" },
      sections: {
        type: "array",
        description: "Các phần nội dung chính, theo chủ đề đã bàn",
        items: {
          type: "object",
          properties: {
            heading: { type: "string" },
            bullets: STRINGS,
            subsections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, bullets: STRINGS } } },
            table: {
              type: "object",
              description: "Bảng (tùy chọn) khi nội dung có dạng so sánh / số liệu",
              properties: { columns: STRINGS, rows: { type: "array", items: STRINGS } },
            },
          },
        },
      },
      decisions: { ...STRINGS, description: "Định hướng / quyết định đã thống nhất" },
      tasks: {
        type: "array",
        description: "Công việc cần làm. owner = TÊN người được giao (đúng tên thành viên nhóm nếu khớp); hạn / ưu tiên chỉ ghi khi có nói",
        items: {
          type: "object",
          properties: {
            task: { type: "string" },
            owner: { type: "string" },
            due: { type: "string", description: "vd '10/10/2026', 'Tuần này'" },
            priority: { type: "string", enum: ["Cao", "TB", "Thấp"] },
          },
        },
      },
      timeline: {
        type: "array",
        items: { type: "object", properties: { when: { type: "string" }, content: { type: "string" } } },
        description: "Mốc thời gian đã nhắc tới",
      },
      open_issues: { ...STRINGS, description: "Vấn đề còn mở / chưa chốt" },
      side_notes: { ...STRINGS, description: "Ghi chú ngoài lề (tùy chọn)" },
      source: { type: "string", description: "Nguồn: tên file ghi âm" },
    },
    required: ["title", "tldr", "tasks"],
  },
};

export async function runCreateRecapPdf(create: CreateRecapPdf | undefined, args: Record<string, unknown>, now: Date): Promise<Record<string, unknown>> {
  if (!create) return { error: "Xuất PDF recap chưa bật cho trợ lý này." };
  let recap: MeetingRecap;
  try {
    recap = normalizeRecap(args, now);
  } catch (error) {
    if (error instanceof RecapInputError) return { error: error.message };
    throw error;
  }
  return create(recap);
}
