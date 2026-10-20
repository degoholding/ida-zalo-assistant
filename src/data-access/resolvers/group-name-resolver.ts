import type { RowDataPacket } from "mysql2";
import { ConversationType } from "../../constants.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { threadVisibilitySql } from "../visibility-guards.js";

// Phân giải TÊN NHÓM (tên thật, nhãn / tên gọi ngắn đặt ở màn Nhóm) ra nhóm người hỏi ĐỌC ĐƯỢC. Bỏ dấu / hoa thường theo collation của bảng
// (utf8mb4_unicode_ci) — «k52» khớp «K52», «tổng hợp» khớp «tong hop». Nhóm ngoài phạm vi KHÔNG lộ ra; nhóm Mật trong phạm vi mà người hỏi chưa
// có cờ → kết quả `confidential` (khác `none`) để công cụ báo đúng lý do.

export interface GroupChoice {
  id: number;
  name: string;
}

export type GroupResolution =
  | { kind: "one"; name: string; group: GroupChoice }
  | { kind: "many"; name: string; choices: GroupChoice[] }
  | { kind: "confidential"; name: string }
  | { kind: "none"; name: string };

const LIMIT = 8;

async function findVisibleGroups(ctx: DataAccessContext, name: string): Promise<(GroupChoice & { exact: boolean })[]> {
  const like = `%${name.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const visible = threadVisibilitySql(ctx, "g");
  try {
    const [rows] = await ctx.db.query<RowDataPacket[]>(
      `SELECT g.id, COALESCE(NULLIF(g.label, ''), g.name) AS shown, (g.name = ? OR g.label = ?) AS exact
       FROM zalo_group g WHERE g.thread_type = ? AND ${visible.sql} AND (g.name LIKE ? OR g.label LIKE ?)
       ORDER BY exact DESC, shown LIMIT ?`,
      [name, name, ConversationType.Group, ...visible.params, like, like, LIMIT]);
    return rows.map((row) => ({ id: Number(row.id), name: String(row.shown ?? ""), exact: Number(row.exact) === 1 }));
  } catch (error) {
    return translateDbError(error);
  }
}

export async function resolveGroupName(ctx: DataAccessContext, rawName: string): Promise<GroupResolution> {
  const name = rawName.normalize("NFC").trim();
  if (!name) return { kind: "none", name };
  const found = await findVisibleGroups(ctx, name);
  if (!found.length) {
    // Có nhóm khớp nhưng chỉ vì Mật? (nhóm ngoài phạm vi vẫn không thấy dù nới Mật)
    if (!ctx.includeConfidential && (await findVisibleGroups({ ...ctx, includeConfidential: true }, name)).length) return { kind: "confidential", name };
    return { kind: "none", name };
  }
  const exact = found.filter((group) => group.exact);
  const pool = found.length === 1 ? found : exact.length === 1 ? exact : null;
  if (pool) return { kind: "one", name, group: { id: pool[0].id, name: pool[0].name } };
  return { kind: "many", name, choices: found.map(({ id, name: shown }) => ({ id, name: shown })) };
}

/** Đúng một nhóm, hoặc lỗi lõi `not_found` / `confidential` / `ambiguous` (kèm `choices`). */
export async function requireOneGroup(ctx: DataAccessContext, rawName: string): Promise<GroupChoice> {
  const result = await resolveGroupName(ctx, rawName);
  if (result.kind === "one") return result.group;
  if (result.kind === "confidential") throw new DataAccessError("confidential", `Nhóm «${result.name}» để chế độ Mật — anh/chị chưa được cấp quyền xem nhóm Mật qua bot.`);
  if (result.kind === "none") throw new DataAccessError("not_found", `Không có nhóm nào đang đọc tên giống «${result.name}».`);
  throw new DataAccessError("ambiguous", `Có ${result.choices.length} nhóm khớp «${result.name}»: ${result.choices.map((choice) => choice.name).join("; ")}. Nêu tên đầy đủ hơn.`, undefined,
    { choices: result.choices });
}
