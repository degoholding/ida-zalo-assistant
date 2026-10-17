import { z } from "zod/v4";
import { patchGroup } from "../../web/api/groups-api.js";
import { parseCompanyId } from "../../web/api/contacts-api.js";
import { DataAccessError } from "../data-access-errors.js";
import type { WriteAction } from "./write-action.js";
import { assertNoMaskedText } from "./write-input-guards.js";
import { runLockedWrite } from "./write-row-lock.js";
import { loadVisibleGroup, type VisibleGroupRow } from "./write-target-guards.js";

// Nhóm: chỉ đổi tên gọi + công ty qua `patchGroup` (có recordAudit). Cờ đọc tin / lấy tệp / Mật / số ngày lưu và loại nhóm KHÔNG có trong
// sơ đồ (`.strict()`) — đó là chính sách dữ liệu, chỉ đổi trên web.

const schema = z.object({
  group_id: z.number().int().positive(),
  label: z.string().trim().max(100).optional().describe("Tên gọi nội bộ MỚI của nhóm (rỗng = bỏ tên gọi, dùng tên Zalo)."),
  company_id: z.number().int().min(0).optional().describe("Id công ty; 0 = bỏ gán."),
}).strict().refine((value) => value.label !== undefined || value.company_id !== undefined, { message: "Cần label hoặc company_id" });
type Input = z.infer<typeof schema>;

const quote = (text: string) => `«${text.replace(/\s+/g, " ").slice(0, 200)}»`;

const stateOf = (group: VisibleGroupRow): string => JSON.stringify([group.label, group.company_id ?? 0]);

export const groupUpdateAction: WriteAction<Input> = {
  tool: "propose_group_update",
  title: "Đề xuất sửa nhóm",
  description: "Đề xuất đổi tên gọi nội bộ hoặc công ty của một nhóm Zalo. KHÔNG đổi được cờ đọc tin, lấy tệp, nhóm Mật hay số ngày lưu.",
  entity: "group",
  schema,
  async prepare(ctx, input) {
    assertNoMaskedText(ctx, { label: input.label });
    const before = await loadVisibleGroup(ctx, input.group_id);
    const changes: string[] = [];
    if (input.label !== undefined && input.label !== before.label) changes.push(`Tên gọi: ${quote(before.label || before.name)} → ${quote(input.label || before.name)}`);
    if (input.company_id !== undefined) {
      if (input.company_id) await parseCompanyId(ctx.db, input.company_id);
      if (input.company_id !== (before.company_id ?? 0)) changes.push(`Công ty: #${before.company_id ?? "chưa gán"} → #${input.company_id || "bỏ gán"}`);
    }
    if (!changes.length) throw new DataAccessError("invalid_value", "Không có thay đổi nào so với nhóm hiện tại.");
    return { preview: `Nhóm #${before.id} ${quote(before.label || before.name)}: ${changes.join("; ")}`, targetEntity: "group", targetId: before.id, stateToken: stateOf(before) };
  },
  async execute(ctx, input, expectedState) {
    assertNoMaskedText(ctx, { label: input.label });
    const { group_id: id, ...fields } = input;
    return runLockedWrite(ctx, {
      lockSql: "SELECT id FROM zalo_group WHERE id = ? FOR UPDATE", lockParams: [id], expectedState,
      currentState: async (tx) => stateOf(await loadVisibleGroup(tx, id)),
      run: async (tx) => {
        // Không đụng cờ đọc tin nên `startBackfill` không bao giờ được gọi; nếu có thay đổi tương lai làm gọi tới thì báo lỗi rõ thay vì chạy ngầm
        const service = { db: tx.db, startBackfill: async (): Promise<never> => { throw new Error("Lấy tin cũ không hỗ trợ qua công cụ ghi"); } };
        await patchGroup(service, id, fields);
        const changed = [fields.label !== undefined ? "Tên gọi" : "", fields.company_id !== undefined ? "Công ty" : ""].filter(Boolean);
        return { entity: "group", id, changed, message: `Đã sửa nhóm #${id}: ${changed.join(", ")}` };
      },
    });
  },
};
