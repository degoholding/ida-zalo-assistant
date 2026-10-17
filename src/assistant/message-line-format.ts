import type { RowDataPacket } from "mysql2";
import { ConversationType, MessageKind } from "../constants.js";
import { maskPersonalData } from "../privacy/personal-data.js";

// Định dạng dòng tin + giờ Việt Nam cho công cụ đọc của trợ lý (tách khỏi tools.ts). Hàm thuần, không đụng DB.

export const MAX_MESSAGES = 1500;
const MAX_CHARS = 120_000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export function parseTime(raw: unknown, fallback: Date): Date {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? fallback : value;
}

const VN_WEEKDAYS = ["Chủ nhật", "thứ Hai", "thứ Ba", "thứ Tư", "thứ Năm", "thứ Sáu", "thứ Bảy"];

/**
 * «thứ Tư, 07/10/2026» theo giờ Việt Nam. Đưa sẵn cho mô hình — không có thì mô hình tự đoán thứ và đoán sai (gặp thật
 * 07/10/2026: bot nói «hôm nay thứ Ba» vào thứ Tư).
 */
export function formatVnDay(date: Date): string {
  const local = new Date(date.getTime() + VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${VN_WEEKDAYS[local.getUTCDay()]}, ${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}`;
}

/** Giờ Việt Nam dạng dd/MM HH:mm — mô hình đọc giờ địa phương, không phải UTC. */
export function formatVn(date: Date): string {
  const local = new Date(date.getTime() + VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

export interface MessageLineRow extends RowDataPacket {
  sent_at: Date;
  sender_name: string;
  sender_uid: string;
  kind: number;
  text: string | null;
  quote_text: string | null;
  file_name: string | null;
  attachment_id: number | null;
  /** Chữ đã đọc từ tệp (attachment_text) — ảnh tự đọc / tệp trợ lý từng đọc */
  file_text: string | null;
  group_name: string;
  thread_type: number;
}

/** Chữ đọc từ ảnh đưa vào dòng tin tối đa ngần này ký tự — đủ để tóm tắt biết ảnh nói gì, muốn đủ thì read_file. */
const IMAGE_TEXT_IN_LINE = 300;

/** «[tệp #12: Bao gia.xlsx]» / «[ảnh #20: <chữ + mô tả đã đọc>]» (ảnh Zalo không có tên tệp). */
export function attachmentLabel(row: Pick<MessageLineRow, "kind" | "file_name" | "attachment_id" | "file_text">): string {
  if (row.file_name) return `[tệp #${row.attachment_id}: ${row.file_name}]`;
  if (row.kind !== MessageKind.Image) return `[tệp #${row.attachment_id}]`;
  // Che dữ liệu cá nhân TRƯỚC khi cắt — cắt trước có thể đứt đôi một SĐT / STK, nửa còn lại lọt qua mẫu che
  const seen = maskPersonalData(row.file_text ?? "").replace(/\s+/g, " ").trim();
  if (!seen) return `[ảnh #${row.attachment_id}]`;
  return `[ảnh #${row.attachment_id}: ${seen.length > IMAGE_TEXT_IN_LINE ? `${seen.slice(0, IMAGE_TEXT_IN_LINE - 1)}…` : seen}]`;
}

export function formatLines(rows: MessageLineRow[], withGroup: boolean): { text: string; truncated: boolean } {
  const lines: string[] = [];
  for (const row of rows) {
    const where = withGroup ? ` (${row.thread_type === ConversationType.Direct ? "nhắn riêng bot" : row.group_name})` : "";
    const quote = row.quote_text ? ` [trả lời: "${row.quote_text.slice(0, 80)}"]` : "";
    const file = row.attachment_id ? ` ${attachmentLabel(row)}` : "";
    const body = (row.text ?? "").replace(/\s+/g, " ").trim();
    lines.push(`[${formatVn(row.sent_at)}]${where} ${row.sender_name || row.sender_uid}:${quote} ${body}${file}`.trim());
  }
  // Quá dài thì giữ phần MỚI nhất — câu hỏi thường về chuyện gần đây
  let total = 0;
  let start = lines.length;
  while (start > 0 && total + lines[start - 1].length + 1 <= MAX_CHARS) {
    start -= 1;
    total += lines[start].length + 1;
  }
  return { text: lines.slice(start).join("\n"), truncated: start > 0 };
}

export const MESSAGE_SELECT = `
  SELECT m.sent_at, m.sender_name, m.sender_uid, m.kind, m.text, m.quote_text, a.file_name, a.id AS attachment_id,
         IF(m.kind = ${MessageKind.Image}, LEFT(t.text, 2000), NULL) AS file_text,
         COALESCE(NULLIF(g.label, ''), g.name) AS group_name, g.thread_type
  FROM message m
  JOIN zalo_group g ON g.id = m.group_id
  LEFT JOIN attachment a ON a.message_id = m.id
  LEFT JOIN attachment_text t ON t.attachment_id = a.id`;
