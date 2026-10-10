import type { RowDataPacket } from "mysql2";
import { ConversationType } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { RecipientRow } from "../recipients/recipient-repository.js";
import type { BriefScope } from "./brief-types.js";

// Luật phạm vi Mật của bản tin / báo cáo (IDA câu 4, chốt 09/10/2026) — KHÁC phạm vi cảnh báo (alert-store.ts):
//   «Mọi nhóm»  → thấy mọi nhóm ĐANG ĐỌC, KHÔNG BAO GIỜ thấy nhóm Mật.
//   Giới hạn    → chỉ thấy nhóm đã chọn (recipient_group) — CÓ THỂ gồm nhóm Mật nếu chọn đúng nhóm đó.
//   aiGroupIds  → luôn bỏ nhóm Mật, dù phạm vi có chọn Mật (không bao giờ đưa dữ liệu Mật cho AI).
// Hàm thuần (resolveBriefScope) để test không cần DB; loadBriefScope mới chạm CSDL.

export interface BriefScopeGroup {
  id: number;
  isConfidential: boolean;
  readMessages: boolean;
}

export interface BriefScopeInput {
  uid: string;
  /** recipient.all_groups */
  allGroups: boolean;
  /** Nhóm người nhận đã chọn (recipient_group) — chỉ có ý nghĩa khi `allGroups` false. */
  selectedGroupIds: number[];
  /** Mọi nhóm (loại Group, không phải cuộc riêng) hệ thống đang biết — để biết nhóm nào Mật / đang đọc. */
  groups: BriefScopeGroup[];
}

/**
 * Phạm vi việc / ticket: gắn nhóm theo dõi, HOẶC (nếu «mọi nhóm») không gắn nhóm nào, HOẶC CHÍNH người nhận liên quan
 * trực tiếp (người giao / phụ trách việc, người gửi / xử lý ticket) — chốt 09/10/2026: việc / ticket của chính người
 * nhận vẫn hiện dù ở nhóm Mật họ không chọn. Dùng chung cho bộ gom bản tin (brief-work-collectors.ts) VÀ báo cáo tuần /
 * tháng (reports/periodic-report-work-stats.ts, kể cả sheet «Theo nhân viên» — review phase 8, H1) để khỏi lặp luật
 * này mỗi nơi một kiểu.
 */
export function workScopeSql(scope: BriefScope, columns: { thread: string; parties: string[] }): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  // «Không gắn nhóm» = không có cuộc nào, HOẶC tạo trong TIN RIÊNG với bot (vd «báo lỗi: …» nhắn riêng — cột nguồn trỏ tới
  // cuộc riêng, không phải nhóm) — trước đây chỉ tính IS NULL nên ticket / việc tạo qua tin riêng lọt khỏi bản tin «mọi nhóm»
  if (scope.includeUngrouped) {
    parts.push(`(${columns.thread} IS NULL OR ${columns.thread} IN (SELECT id FROM zalo_group WHERE thread_type = ${ConversationType.Direct}))`);
  }
  if (scope.groupIds.length) {
    parts.push(`${columns.thread} IN (?)`);
    params.push(scope.groupIds);
  }
  for (const party of columns.parties) {
    parts.push(`${party} = ?`);
    params.push(scope.uid);
  }
  if (!parts.length) return { sql: "1 = 0", params: [] };
  return { sql: `(${parts.join(" OR ")})`, params };
}

/** Phạm vi nhóm một người nhận được thấy trong bản tin / báo cáo. */
export function resolveBriefScope(input: BriefScopeInput): BriefScope {
  const { uid, allGroups, selectedGroupIds, groups } = input;
  if (allGroups) {
    const groupIds = groups.filter((group) => group.readMessages && !group.isConfidential).map((group) => group.id);
    // «Mọi nhóm» đã bỏ Mật ở trên nên aiGroupIds trùng groupIds
    return { uid, groupIds, aiGroupIds: groupIds, includeUngrouped: true };
  }
  const selected = new Set(selectedGroupIds);
  const chosen = groups.filter((group) => selected.has(group.id));
  return {
    uid,
    groupIds: chosen.map((group) => group.id),
    aiGroupIds: chosen.filter((group) => !group.isConfidential).map((group) => group.id),
    includeUngrouped: false,
  };
}

/** Đọc nhóm + lựa chọn của một người nhận rồi tính phạm vi (một câu nhóm + một câu recipient_group). */
export async function loadBriefScope(
  db: Db, recipient: Pick<RecipientRow, "id" | "all_groups" | "zalo_uid">,
): Promise<BriefScope> {
  const [groupRows] = await db.query<RowDataPacket[]>(
    "SELECT id, is_confidential, read_messages FROM zalo_group WHERE thread_type = ?", [ConversationType.Group]);
  const groups: BriefScopeGroup[] = groupRows.map((row) => ({
    id: Number(row.id), isConfidential: Boolean(row.is_confidential), readMessages: Boolean(row.read_messages),
  }));
  let selectedGroupIds: number[] = [];
  if (!recipient.all_groups) {
    const [rows] = await db.query<RowDataPacket[]>(
      "SELECT group_id FROM recipient_group WHERE recipient_id = ?", [recipient.id]);
    selectedGroupIds = rows.map((row) => Number(row.group_id));
  }
  return resolveBriefScope({
    uid: recipient.zalo_uid, allGroups: Boolean(recipient.all_groups), selectedGroupIds, groups,
  });
}
