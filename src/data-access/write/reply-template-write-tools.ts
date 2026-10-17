import { z } from "zod/v4";
import { ReplyTone, UserRole } from "../../constants.js";
import { findTemplate } from "../../reply-suggestions/reply-template-repository.js";
import { createTemplate, editTemplate, validateTemplateInput } from "../../reply-suggestions/reply-template-workflow.js";
import type { Principal } from "../../auth/principal.js";
import { DataAccessError } from "../data-access-errors.js";
import type { WriteAction } from "./write-action.js";
import { assertNoMaskedText } from "./write-input-guards.js";
import { runLockedWrite } from "./write-row-lock.js";

// Mẫu tin: soạn mới / sửa mẫu CỦA CHÍNH MÌNH, luôn về «Chờ duyệt» (người có quyền duyệt vẫn phải duyệt trên web). Chạy với bản principal
// KHÔNG có quyền duyệt (vai trò Nhân viên) để một Quản lý / Quản trị gọi qua AI không tự giữ «Đã duyệt» khi sửa — AI không bỏ qua bước duyệt.

const schema = z.object({
  id: z.number().int().positive().optional().describe("Bỏ trống = soạn mẫu mới; có id = sửa mẫu CỦA CHÍNH BẠN."),
  title: z.string().trim().min(3).max(150).describe("Tên mẫu."),
  situation: z.string().trim().max(500).default("").describe("Tình huống dùng mẫu."),
  body: z.string().trim().min(10).max(2000).describe("Nội dung mẫu tin."),
  tone: z.number().int().min(1).max(3).default(ReplyTone.Formal).describe("Tông: 1 trang trọng, 2 thân thiện, 3 ngắn gọn."),
}).strict();
type Input = z.infer<typeof schema>;

const quote = (text: string) => `«${text.replace(/\s+/g, " ").slice(0, 200)}»`;
const TONES: Record<number, string> = { [ReplyTone.Formal]: "trang trọng", [ReplyTone.Friendly]: "thân thiện", [ReplyTone.Brief]: "ngắn gọn" };
const asNonApprover = (principal: Principal): Principal => ({ ...principal, role: UserRole.Staff });
const guardInput = (ctx: Parameters<WriteAction<Input>["prepare"]>[0], input: Input) =>
  assertNoMaskedText(ctx, { title: input.title, situation: input.situation, body: input.body });
const stateOf = (template: NonNullable<Awaited<ReturnType<typeof findTemplate>>>): string =>
  JSON.stringify([template.status, template.name, template.situation, template.body, template.tone]);
const raw = (input: Input) => ({ name: input.title, situation: input.situation, body: input.body, tone: input.tone });

async function loadOwn(ctx: Parameters<WriteAction<Input>["prepare"]>[0], id: number) {
  const template = await findTemplate(ctx.db, ctx.principal.tenantId, id);
  if (!template) throw new DataAccessError("not_found", "Không tìm thấy mẫu tin này.");
  if (template.authorUserId === null || template.authorUserId !== ctx.principal.userId) {
    throw new DataAccessError("forbidden", "Qua AI chỉ sửa được mẫu do chính bạn soạn.");
  }
  return template;
}

export const replyTemplateSaveAction: WriteAction<Input> = {
  tool: "propose_reply_template_save",
  title: "Đề xuất lưu mẫu tin",
  description: "Đề xuất soạn mẫu tin trả lời mới (hoặc sửa mẫu của chính bạn). Mẫu luôn vào «Chờ duyệt»; bot chỉ dùng sau khi người có quyền duyệt trên web.",
  entity: "reply_template",
  schema,
  async prepare(ctx, input) {
    guardInput(ctx, input);
    validateTemplateInput(raw(input));
    const before = input.id === undefined ? null : await loadOwn(ctx, input.id);
    const preview = `${before ? `Sửa mẫu #${before.id}` : "Soạn mẫu mới"} ${quote(input.title)} (tông ${TONES[input.tone]}), chờ duyệt — nội dung: ${quote(input.body)}`;
    return {
      preview, targetEntity: "reply_template", targetId: before?.id ?? null,
      stateToken: before ? stateOf(before) : "new",
    };
  },
  async execute(ctx, input, expectedState) {
    guardInput(ctx, input);
    const principal = asNonApprover(ctx.principal);
    if (input.id === undefined) {
      const id = await createTemplate(ctx.db, principal, raw(input));
      return { entity: "reply_template", id, changed: ["Tạo mới"], message: `Đã soạn mẫu #${id} ${quote(input.title)} — chờ duyệt` };
    }
    const id = input.id;
    return runLockedWrite(ctx, {
      lockSql: "SELECT id FROM reply_template WHERE id = ? FOR UPDATE", lockParams: [id], expectedState,
      currentState: async (tx) => stateOf(await loadOwn(tx, id)),
      run: async (tx) => {
        await editTemplate(tx.db, principal, id, raw(input));
        return { entity: "reply_template", id, changed: ["Nội dung"], message: `Đã sửa mẫu #${id} ${quote(input.title)} — chờ duyệt` };
      },
    });
  },
};
