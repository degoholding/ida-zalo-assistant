import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { getContactTags, parseTags } from "../../sync/contact-repository.js";
import { patchContact, parseCompanyId } from "../../web/api/contacts-api.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import type { WriteAction } from "./write-action.js";
import { assertNoMaskedText } from "./write-input-guards.js";
import { runLockedWrite } from "./write-row-lock.js";
import { assertContactTarget } from "./write-target-guards.js";

// Danh bạ: sửa công ty / thẻ / ghi chú qua `patchContact` (chính hàm của màn Danh bạ, có recordAudit). Vai trò với bot (`role`), SĐT và
// LOẠI (`kind`: Khách hàng / Nhân sự…) KHÔNG nằm trong sơ đồ (`.strict()`) — vai trò mở quyền gửi lệnh / tắt bot, loại quyết định đối xử
// (quyết định chủ D2, 17/10/2026) nên chỉ người đổi trên web; AI không bao giờ đổi.

const schema = z.object({
  contact_id: z.number().int().positive(),
  company_id: z.number().int().min(0).optional().describe("Id công ty; 0 = bỏ gán."),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().describe("Danh sách thẻ MỚI (thay toàn bộ thẻ hiện có)."),
  note: z.string().max(5000).optional().describe("Ghi chú nội bộ MỚI (THAY toàn bộ ghi chú hiện có). Chỉ muốn thêm một dòng thì dùng note_append."),
  note_append: z.string().trim().min(1).max(1000).optional().describe("Dòng ghi chú THÊM vào cuối ghi chú hiện có (giữ nguyên phần cũ, kể cả phần đang bị che). Không dùng chung với note."),
}).strict()
  .refine((value) => Object.keys(value).some((key) => key !== "contact_id"), { message: "Cần ít nhất một trường để sửa" })
  .refine((value) => value.note === undefined || value.note_append === undefined, { message: "Chỉ dùng note HOẶC note_append" });
type Input = z.infer<typeof schema>;

interface ContactState {
  name: string;
  companyId: number;
  note: string;
  tags: string[];
}

async function loadState(ctx: DataAccessContext, id: number): Promise<ContactState> {
  await assertContactTarget(ctx, id);
  const [rows] = await ctx.db.query<RowDataPacket[]>(
    "SELECT COALESCE(NULLIF(display_name, ''), zalo_name, '') AS name, company_id, COALESCE(note, '') AS note FROM contact WHERE id = ?", [id]);
  const row = rows[0];
  if (!row) throw new DataAccessError("not_found", "Không tìm thấy người này trong Danh bạ.");
  const tags = (await getContactTags(ctx.db, [id])).get(id) ?? [];
  return { name: String(row.name), companyId: Number(row.company_id) || 0, note: String(row.note), tags: [...tags].sort() };
}

const quote = (text: string) => `«${text.replace(/\s+/g, " ").slice(0, 200)}»`;

/** Ghi chú sau khi sửa: `note` thay hết; `note_append` nối thêm một dòng. undefined = không đụng ghi chú. */
function nextNote(before: ContactState, input: Input): string | undefined {
  if (input.note_append === undefined) return input.note;
  const joined = before.note ? `${before.note}\n${input.note_append}` : input.note_append;
  if (joined.length > 5000) throw new DataAccessError("invalid_value", "Ghi chú sau khi thêm vượt 5000 ký tự.");
  return joined;
}

const guardInput = (ctx: DataAccessContext, input: Input) => assertNoMaskedText(ctx, { note: input.note, note_append: input.note_append, tags: input.tags });

/** Các thay đổi THẬT SỰ (bỏ trường trùng giá trị hiện tại): nhãn + «cũ → mới». */
function diffOf(before: ContactState, input: Input): { label: string; text: string }[] {
  const changes: { label: string; text: string }[] = [];
  if (input.company_id !== undefined && input.company_id !== before.companyId) changes.push({ label: "Công ty", text: `Công ty: #${before.companyId || "chưa gán"} → #${input.company_id || "bỏ gán"}` });
  const note = nextNote(before, input);
  if (note !== undefined && note !== before.note) changes.push({ label: "Ghi chú", text: `Ghi chú: ${quote(before.note)} → ${quote(note)}` });
  if (input.tags !== undefined) {
    const next = parseTags(input.tags.join(",")).sort();
    if (next.join("\u0001") !== before.tags.join("\u0001")) changes.push({ label: "Thẻ", text: `Thẻ: [${before.tags.join(", ")}] → [${next.join(", ")}]` });
  }
  return changes;
}

const stateOf = (state: ContactState): string => JSON.stringify([state.companyId, state.note, state.tags]);

export const contactUpdateAction: WriteAction<Input> = {
  tool: "propose_contact_update",
  title: "Đề xuất sửa hồ sơ Danh bạ",
  description: "Đề xuất sửa hồ sơ một người trong Danh bạ: công ty, thẻ, ghi chú (note = thay hết, note_append = thêm một dòng). KHÔNG đổi được loại (khách hàng / nhân sự), vai trò với bot hay SĐT.",
  entity: "contact",
  schema,
  async prepare(ctx, input) {
    guardInput(ctx, input);
    const before = await loadState(ctx, input.contact_id);
    const changes = diffOf(before, input);
    if (!changes.length) throw new DataAccessError("invalid_value", "Không có thay đổi nào so với hồ sơ hiện tại.");
    if (input.company_id) await parseCompanyId(ctx.db, input.company_id);
    return {
      preview: `Danh bạ #${input.contact_id} ${quote(before.name)}: ${changes.map((change) => change.text).join("; ")}`,
      targetEntity: "contact", targetId: input.contact_id,
      stateToken: stateOf(before),
    };
  },
  async execute(ctx, input, expectedState) {
    guardInput(ctx, input);
    const { contact_id: id, note_append: _append, ...rest } = input;
    return runLockedWrite(ctx, {
      lockSql: "SELECT id FROM contact WHERE id = ? FOR UPDATE", lockParams: [id], expectedState,
      currentState: async (tx) => stateOf(await loadState(tx, id)),
      run: async (tx) => {
        const before = await loadState(tx, id);
        const changes = diffOf(before, input);
        const note = nextNote(before, input);
        // `canChangeRole = false`: không bao giờ ghi cột vai trò, kể cả quản trị gọi qua AI; `kind` không có trong sơ đồ nên không bao giờ tới đây
        await patchContact(tx.db, id, { ...rest, ...(note === undefined ? {} : { note }) }, false);
        return { entity: "contact", id, changed: changes.map((change) => change.label), message: `Đã sửa hồ sơ Danh bạ #${id}: ${changes.map((change) => change.label).join(", ") || "không đổi"}` };
      },
    });
  },
};
