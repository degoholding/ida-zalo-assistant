import type { RowDataPacket } from "mysql2";
import type { BriefLine } from "./brief-types.js";

// Mẩu SQL + hàm đọc dòng dùng chung giữa các bộ gom bản tin (brief-work-collectors.ts, brief-message-collectors.ts) —
// tách khỏi brief-types.ts (chỉ khai kiểu) để không trùng mã giữa nhiều tệp (review phase 8, Low).

/** Tên nhóm hiển thị: nhãn riêng (`zalo_group.label`) nếu có, không thì tên nhóm gốc. */
export const GROUP_NAME_SQL = "COALESCE(NULLIF(g.label, ''), g.name)";

/** Một dòng SELECT ra `BriefLine` — cột phải đặt bí danh đúng `group_name / sender_name / at / text / id`. */
export function toBriefLine(row: RowDataPacket): BriefLine {
  return {
    groupName: String(row.group_name ?? ""), senderName: String(row.sender_name ?? ""),
    at: new Date(row.at), text: String(row.text ?? ""), ref: Number(row.id),
  };
}
