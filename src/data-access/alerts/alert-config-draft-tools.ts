import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { McpCallSource } from "../../constants.js";
import { describeContactChoices, pickContactMatch, searchContactsByName } from "../../sync/contact-search.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import { executeOpenDraft } from "../write/confirm-write-tool.js";
import { eraseAction } from "../write/write-action.js";
import { cancelDraft, createDraft, draftBindingOf, listOpenDrafts, type DraftRecord } from "../write/write-draft-store.js";
import { alertConfigAvailable, requireAlertAsker } from "./alert-asker-facts.js";
import {
  alertConfigChangeAction, ALERT_CONFIG_CHANGE_TOOL, ALERT_CONFIG_TTL_MS, CONFIG_ACTIONS, isVipAction, NO_VIP_LIST_MESSAGE, prepareConfigChange, type ConfigChange,
} from "./alert-write-actions.js";

// Công cụ NHÁP của «đổi cấu hình cảnh báo» (phase 10), thay kho đề xuất trong RAM bằng `mcp_write_draft` (hạn 15 phút):
// - mặt mô hình `propose_alert_change` (tên giữ): tạo nháp, máy chủ gửi bản xem trước (`effects.fixedReply`) — mô hình KHÔNG có công cụ xác nhận (BC3);
// - mặt lệnh gõ: `alert_config_propose` (tên người VIP gõ tay), `alert_config_pending` / `_confirm` / `_cancel` cho «đồng ý» / «hủy».
// Nháp luôn gắn theo LIÊN HỆ Zalo (nguồn Trợ lý) dù tạo từ mặt nào, để «đồng ý» ở tin sau tìm đúng; người nhận không có tài khoản web vẫn xác nhận
// được (`confirm_draft` của họ `drafts` đòi quyền ghi của tài khoản web nên không dùng ở đây).

export const ALERT_CONFIRM_HINT = "Anh/chị nhắn «đồng ý» để lưu (trong 15 phút), «hủy» để bỏ.";
export const ALERT_DRAFT_NOT_FOUND = "Không có đề xuất này (hoặc đã quá 15 phút) — đề xuất lại.";
const DRAFT_SENT_MESSAGE = "Đã tạo nháp và hệ thống đã gửi bản xem trước cho người hỏi. DỪNG: không viết thêm, không báo đã đổi; chỉ đổi khi người hỏi nhắn «đồng ý».";

/** Bảng thao tác riêng của họ (không đăng ký vào danh mục ghi chung: không có công cụ `propose_*` ở cổng ngoài). */
const CONFIG_ACTIONS_BY_TOOL = new Map([[ALERT_CONFIG_CHANGE_TOOL, eraseAction(alertConfigChangeAction)]]);

const bindingOf = (ctx: DataAccessContext) => draftBindingOf({ ...ctx, source: McpCallSource.Assistant, keyId: null });

const proposeFields = {
  action: z.enum(CONFIG_ACTIONS),
  person_uid: z.string().optional().describe("add_vip / remove_vip: uid người (từ find_people)"),
  keyword: z.string().optional().describe("Từ khóa cần thêm / bỏ"),
  morning: z.string().optional().describe("set_brief_times: giờ bản tin sáng HH:MM, rỗng = tắt"),
  evening: z.string().optional().describe("set_brief_times: giờ bản tin cuối ngày HH:MM, rỗng = tắt"),
  minutes: z.number().int().optional().describe("set_*_wait_minutes: số phút giờ làm việc"),
};
const modelInput = z.object(proposeFields);
const commandInput = z.object({ ...proposeFields, person_name: z.string().optional().describe("add_vip / remove_vip: tên người người dùng gõ") });
type CommandInput = z.infer<typeof commandInput>;

/** Người VIP gõ bằng TÊN (lệnh «thêm / bỏ vip <tên>»): chép `findPersonForVip` cũ — bỏ VIP chỉ tìm trong VIP của chính họ; câu báo y hệt. */
async function contactIdByName(ctx: DataAccessContext, recipientId: number, name: string, add: boolean): Promise<number> {
  const rows = await searchContactsByName(ctx.db, name, add ? {} : { vipOfRecipientId: recipientId });
  if (!rows.length) {
    throw new DataAccessError("not_found", add ? `Em không tìm thấy ai tên «${name}» trong Danh bạ.` : `Trong VIP của anh/chị không có ai tên «${name}».`);
  }
  const picked = pickContactMatch(rows);
  if (picked) return picked.id;
  throw new DataAccessError("ambiguous", describeContactChoices(rows, name, `${add ? "thêm" : "bỏ"} vip <tên đầy đủ>`), undefined,
    { choices: rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind })) });
}

async function contactIdByUid(ctx: DataAccessContext, uid: string): Promise<number | undefined> {
  const [rows] = await ctx.db.query<RowDataPacket[]>("SELECT id FROM contact WHERE zalo_uid = ?", [uid]);
  return rows[0] ? Number(rows[0].id) : undefined;
}

/** Chuẩn hóa tham số (như `proposeChange` cũ) → thay đổi đã phân giải người; kiểm luật + tạo nháp. */
async function createConfigDraft(ctx: DataAccessContext, input: CommandInput): Promise<{ draftId: number; preview: string }> {
  const asker = await requireAlertAsker(ctx);
  const change: ConfigChange = { action: input.action };
  if (isVipAction(input.action)) {
    if (!asker.recipientId) throw new DataAccessError("forbidden", NO_VIP_LIST_MESSAGE);
    change.contact_id = input.person_name !== undefined
      ? await contactIdByName(ctx, asker.recipientId, input.person_name, input.action === "add_vip")
      : await contactIdByUid(ctx, input.person_uid ?? "");
  }
  if (input.keyword !== undefined) change.keyword = input.keyword.trim().toLowerCase();
  if (input.morning !== undefined) change.morning = input.morning.trim();
  if (input.evening !== undefined) change.evening = input.evening.trim();
  if (input.minutes !== undefined) change.minutes = input.minutes;
  const prepared = await prepareConfigChange(ctx, change);
  const { id } = await createDraft(ctx.db, {
    ...bindingOf(ctx), tool: ALERT_CONFIG_CHANGE_TOOL, ttlMs: ALERT_CONFIG_TTL_MS, targetEntity: prepared.targetEntity, targetId: prepared.targetId,
    payload: { args: change, state: prepared.stateToken }, preview: prepared.preview, now: ctx.now,
  });
  return { draftId: id, preview: prepared.preview };
}

/** Câu bot nhắn sau khi tạo nháp — y hệt lệnh gõ cũ. */
export const configProposalReply = (preview: string): string => `Em sẽ đổi: ${preview}.\n${ALERT_CONFIRM_HINT}`;

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false as const };
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false as const };
const commandBase = { surfaces: ["assistant_command"] as const, family: "alerts" as const, available: alertConfigAvailable };

const sentOutput = z.object({ done: z.literal(false), message: z.string() });
const modelPropose: ToolDefinition<z.infer<typeof modelInput>, z.infer<typeof sentOutput>> = {
  name: "propose_alert_change", title: "Đề xuất đổi cấu hình cảnh báo", annotations: WRITE,
  description: "Khi người hỏi muốn đổi cấu hình cảnh báo: thêm / bỏ người VIP của chính họ (person_uid lấy từ find_people), thêm / bỏ từ khóa khẩn hoặc quan trọng, " +
    "đổi giờ bản tin sáng / chiều của họ (HH:MM, rỗng = tắt), đổi số phút chờ trước khi nhắc. Công cụ CHỈ TẠO NHÁP (chưa đổi gì): hệ thống tự gửi bản xem trước " +
    "cho người hỏi, họ nhắn «đồng ý» mới lưu. Gọi xong thì DỪNG, không báo đã đổi.",
  input: () => modelInput, output: sentOutput,
  surfaces: ["assistant_model"], family: "alerts", assistantErrorShape: "string", blocksAfterFixedReply: true, available: alertConfigAvailable,
  async handler(ctx, input) {
    const { preview } = await createConfigDraft(ctx, input);
    return { structured: { done: false as const, message: DRAFT_SENT_MESSAGE }, summary: `Đã tạo nháp đổi cấu hình cảnh báo: ${preview}`, rowCount: 1, entity: "write_draft",
      effects: { fixedReply: configProposalReply(preview) } };
  },
};

const proposedOutput = z.object({ draft_id: z.number(), preview: z.string() });
const commandPropose: ToolDefinition<CommandInput, z.infer<typeof proposedOutput>> = {
  ...commandBase, name: "alert_config_propose", title: "Đề xuất đổi cấu hình cảnh báo (lệnh «thêm vip», «thêm từ khẩn», «chờ … phút»)", annotations: WRITE,
  description: "Tạo nháp đổi cấu hình cảnh báo / VIP của người đang nhắn; «đồng ý» ở tin sau mới lưu. Chỉ lệnh gõ.",
  input: () => commandInput, output: proposedOutput,
  async handler(ctx, input) {
    const { draftId, preview } = await createConfigDraft(ctx, input);
    return { structured: { draft_id: draftId, preview }, summary: `Đã tạo nháp: ${preview}`, rowCount: 1, entity: "write_draft" };
  },
};

const draftsOutput = z.object({ drafts: z.array(z.object({ id: z.number(), preview: z.string(), created_at: z.string() })) });
const emptyInput = z.object({}).strict();

async function openConfigDrafts(ctx: DataAccessContext): Promise<DraftRecord[]> {
  return (await listOpenDrafts(ctx.db, bindingOf(ctx), ctx.now)).filter((draft) => draft.tool === ALERT_CONFIG_CHANGE_TOOL);
}

const pendingTool: ToolDefinition<Record<string, never>, z.infer<typeof draftsOutput>> = {
  ...commandBase, name: "alert_config_pending", title: "Đề xuất đổi cấu hình đang chờ («đồng ý» / «hủy»)", annotations: READ,
  description: "Các nháp đổi cấu hình cảnh báo đang chờ của người đang nhắn, mới nhất trước. Chỉ lệnh gõ.",
  input: () => emptyInput as unknown as z.ZodType<Record<string, never>>, output: draftsOutput,
  async handler(ctx) {
    const drafts = (await openConfigDrafts(ctx)).map((draft) => ({ id: draft.id, preview: draft.preview, created_at: draft.createdAt.toISOString() }));
    return { structured: { drafts }, summary: `${drafts.length} đề xuất đang chờ`, rowCount: drafts.length, entity: "write_draft" };
  },
};

const confirmInput = z.object({ draft_id: z.number().int().positive() }).strict();
const confirmOutput = z.object({ done: z.literal(true), message: z.string() });
const confirmTool: ToolDefinition<z.infer<typeof confirmInput>, z.infer<typeof confirmOutput>> = {
  ...commandBase, name: "alert_config_confirm", title: "Xác nhận đổi cấu hình cảnh báo (lệnh «đồng ý»)", annotations: { ...WRITE, destructiveHint: true },
  description: "Thực hiện MỘT nháp đổi cấu hình cảnh báo của người đang nhắn khi họ nhắn «đồng ý»; kiểm lại quyền hiện tại. Chỉ lệnh gõ — mô hình không thấy.",
  input: () => confirmInput, output: confirmOutput,
  async handler(ctx, input) {
    const draft = (await openConfigDrafts(ctx)).find((item) => item.id === input.draft_id);
    if (!draft) throw new DataAccessError("invalid_code", ALERT_DRAFT_NOT_FOUND);
    const done = await executeOpenDraft(ctx, CONFIG_ACTIONS_BY_TOOL, draft);
    return { structured: { done: true as const, message: done.message }, summary: done.message, rowCount: 1, entity: "write_draft" };
  },
};

const cancelOutput = z.object({ cancelled: z.number() });
const cancelTool: ToolDefinition<Record<string, never>, z.infer<typeof cancelOutput>> = {
  ...commandBase, name: "alert_config_cancel", title: "Hủy đề xuất đổi cấu hình (lệnh «hủy»)", annotations: { ...WRITE, idempotentHint: true },
  description: "Bỏ MỌI nháp đổi cấu hình cảnh báo đang chờ của người đang nhắn (như kho đề xuất cũ). Cấu hình giữ nguyên. Chỉ lệnh gõ.",
  input: () => emptyInput as unknown as z.ZodType<Record<string, never>>, output: cancelOutput,
  async handler(ctx) {
    let cancelled = 0;
    for (const draft of await openConfigDrafts(ctx)) if (await cancelDraft(ctx.db, draft.id, ctx.now)) cancelled += 1;
    return { structured: { cancelled }, summary: `Đã hủy ${cancelled} đề xuất`, rowCount: cancelled, entity: "write_draft" };
  },
};

export const ALERT_CONFIG_DRAFT_TOOLS: readonly AnyToolDefinition[] = [
  eraseTool(modelPropose), eraseTool(commandPropose), eraseTool(pendingTool), eraseTool(confirmTool), eraseTool(cancelTool),
];
