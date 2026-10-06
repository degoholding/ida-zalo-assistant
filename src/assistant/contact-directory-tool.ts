import type { RowDataPacket } from "mysql2";
import { ContactKind, ContactKindSource } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { FunctionDeclaration } from "./gemini-client.js";

// Công cụ list_contacts: đếm / liệt kê người trong Danh bạ theo loại (khách hàng, nhân sự). Chỉ đọc.
// Mặc định chỉ tính người «đang làm việc với bot»: thành viên các nhóm bot ĐANG ĐỌC + người từng nhắn riêng.
// Danh bạ còn có thành viên mọi nhóm bot ở (kể cả nhóm không đọc) — đếm cả thì ra số ảo, nên phải hỏi rõ mới tính.
// Loại do hệ thống tự gán (suy theo loại nhóm, chưa ai xác nhận) được tách riêng để mô hình nói rõ độ tin cậy.

const MAX_PEOPLE = 50;

const KIND_BY_NAME: Record<string, ContactKind> = {
  customer: ContactKind.Customer,
  staff: ContactKind.Staff,
  unclassified: ContactKind.Unclassified,
};
const KIND_LABEL: Record<number, string> = {
  [ContactKind.Customer]: "khách hàng",
  [ContactKind.Staff]: "nhân sự",
  [ContactKind.Unclassified]: "chưa phân loại",
};

export const LIST_CONTACTS_DECLARATION: FunctionDeclaration = {
  name: "list_contacts",
  description:
    "Đếm và liệt kê người trong Danh bạ theo loại (khách hàng / nhân sự / chưa phân loại), kèm công ty và số nhóm. Dùng cho câu " +
    "«có bao nhiêu khách hàng», «danh sách nhân sự», «khách hàng của công ty X». Mặc định chỉ tính người trong các nhóm bot đang đọc " +
    "và người từng nhắn riêng. Kết quả tách số người được quản trị phân loại tay và số tự gán — phải nói rõ với người hỏi.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["all", "customer", "staff", "unclassified"], description: "Loại người; mặc định all" },
      query: { type: "string", description: "Một phần tên người hoặc tên công ty (tùy chọn)" },
      scope: {
        type: "string",
        enum: ["active", "everyone"],
        description: "active (mặc định): nhóm bot đang đọc + người nhắn riêng; everyone: cả thành viên các nhóm KHÔNG đọc — chỉ dùng khi người hỏi nói rõ",
      },
    },
  },
};

interface ContactCountRow extends RowDataPacket { kind: number; kind_source: number; n: number }
interface ContactListRow extends RowDataPacket { name: string; kind: number; kind_source: number; company: string | null; groups: number }

export async function runListContacts(db: Db, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const kind = typeof args.kind === "string" && args.kind in KIND_BY_NAME ? KIND_BY_NAME[args.kind] : null;
  const scope = args.scope === "everyone" ? "everyone" : "active";
  const query = typeof args.query === "string" ? args.query.trim().slice(0, 100) : "";
  const where = ["1 = 1"];
  const params: unknown[] = [];
  if (scope === "active") {
    where.push(`(c.last_dm_at IS NOT NULL OR EXISTS (
      SELECT 1 FROM group_member gm JOIN zalo_group g ON g.id = gm.group_id
      WHERE gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL AND g.read_messages = 1))`);
  }
  if (query) {
    where.push("(c.display_name LIKE ? OR c.zalo_name LIKE ? OR co.name LIKE ?)");
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  const from = `FROM contact c LEFT JOIN company co ON co.id = c.company_id WHERE ${where.join(" AND ")}`;
  const [counts] = await db.query<ContactCountRow[]>(`SELECT c.kind, c.kind_source, COUNT(*) AS n ${from} GROUP BY c.kind, c.kind_source`, params);
  const byKind: Record<string, { total: number; set_by_admin: number; auto_guessed: number }> = {};
  for (const row of counts) {
    const label = KIND_LABEL[row.kind] ?? `loại ${row.kind}`;
    const bucket = (byKind[label] ??= { total: 0, set_by_admin: 0, auto_guessed: 0 });
    bucket.total += Number(row.n);
    if (row.kind_source === ContactKindSource.Manual) bucket.set_by_admin += Number(row.n);
    else bucket.auto_guessed += Number(row.n);
  }
  const [people] = await db.query<ContactListRow[]>(
    `SELECT COALESCE(NULLIF(c.display_name, ''), c.zalo_name) AS name, c.kind, c.kind_source, co.name AS company,
            (SELECT COUNT(*) FROM group_member gm WHERE gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL) AS \`groups\`
     ${from} ${kind === null ? "" : "AND c.kind = ?"} ORDER BY c.kind_source DESC, name LIMIT ?`,
    [...params, ...(kind === null ? [] : [kind]), MAX_PEOPLE],
  );
  const matching = kind === null ? Object.values(byKind).reduce((sum, bucket) => sum + bucket.total, 0) : byKind[KIND_LABEL[kind]]?.total ?? 0;
  return {
    scope: scope === "active" ? "người trong các nhóm bot đang đọc + người từng nhắn riêng bot" : "mọi người bot từng thấy (cả nhóm không đọc)",
    total_matching: matching,
    by_kind: byKind,
    note: "auto_guessed = hệ thống tự gán theo loại nhóm, chưa ai xác nhận — nhắc người hỏi vào Danh bạ chỉnh nếu cần số chính xác.",
    people: people.map((row) => ({
      name: row.name,
      kind: KIND_LABEL[row.kind] ?? String(row.kind),
      classified: row.kind_source === ContactKindSource.Manual ? "quản trị đặt" : "tự gán",
      company: row.company ?? "",
      groups: Number(row.groups),
    })),
    people_truncated: matching > people.length,
  };
}
