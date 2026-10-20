import { foldKeepLength } from "../../assistant/fold-text.js";
import { McpCallSource } from "../../constants.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { canPropose, type AnyWriteAction, type WriteExecuted } from "./write-action.js";
import { createDraft, draftBindingOf } from "./write-draft-store.js";
import { executeImmediateWrite } from "./immediate-write.js";
import { guardWrite } from "./write-errors.js";

// D-A (chủ chốt 20/10/2026) — chốt chặn chống TIÊM LỆNH cho thao tác quan hệ PHÁ HỦY / NHẮN NGƯỜI KHÁC do MÔ HÌNH khởi xướng: hủy / giao lại / dời hạn việc,
// hủy ticket, ghi chú việc / ticket (báo người khác), «xong tin số N». Mô hình đọc cả nội dung Zalo của người khác (nhóm, tin cũ), nên một dòng «hủy V-12» nằm
// trong đó có thể khiến nó gọi công cụ. Luật: chạy NGAY chỉ khi MÃ ĐÍCH (V-n / T-n / tin số n) xuất hiện trong chữ CỦA CHÍNH người hỏi ở lượt này (tin họ vừa nhắn)
// hoặc trong câu bot trả lời liền trước họ; không thì thành NHÁP + bản xem trước, chờ «đồng ý» (kho nháp + write-confirm-chat có sẵn). Lệnh gõ không đi qua đây
// (chính là chữ của người dùng). Giao việc mới / báo ticket mới từ chính lời người hỏi vẫn ghi ngay.

export type GuardedTargetKind = "task" | "ticket" | "item";

export interface GuardedTarget {
  kind: GuardedTargetKind;
  id: number;
}

// Mỗi dạng: tiền tố + số, không dính chữ / số liền trước, không dính số liền sau. Chữ đã bỏ dấu + hạ chữ thường (foldKeepLength giữ độ dài).
const CODE_PATTERNS: Record<GuardedTargetKind, RegExp> = {
  task: /(?<![a-z0-9])(?:v-?|viec\s*(?:so\s*)?#?)0*(\d{1,9})(?!\d)/g,
  ticket: /(?<![a-z0-9])(?:t-?|ticket\s*(?:so\s*)?#?)0*(\d{1,9})(?!\d)/g,
  item: /(?<![a-z0-9])(?:tin\s*(?:so\s*)?#?|#)0*(\d{1,9})(?!\d)/g,
};

/** Các số mã thuộc loại `kind` xuất hiện trong `text` («V-12», «v0012», «việc số 12» → 12). Hàm thuần. */
export function codeNumbersIn(text: string, kind: GuardedTargetKind): Set<number> {
  const folded = foldKeepLength(text.normalize("NFC")).toLowerCase();
  const found = new Set<number>();
  for (const match of folded.matchAll(CODE_PATTERNS[kind])) found.add(Number(match[1]));
  return found;
}

/** Mã đích có nằm trong chữ của CHÍNH người hỏi (tin vừa nhắn, câu bot trả lời liền trước) không. Không có chủ thể Zalo → false. */
export async function ownTextNamesTarget(ctx: DataAccessContext, target: GuardedTarget): Promise<boolean> {
  if (!ctx.contactActor) return false;
  const texts = await ctx.contactActor.facts.ownTurnTexts();
  return [texts.asker, texts.previousBotReply].some((text) => text !== "" && codeNumbersIn(text, target.kind).has(target.id));
}

export interface WriteDraftNotice {
  id: number;
  code: string;
  preview: string;
  expiresAt: Date;
}

/**
 * Biến một thao tác `immediate` thành NHÁP (không ghi gì): cùng lớp kiểm với ghi ngay (`schema`, quyền, `prepare` = luật quan hệ + đích HIỆN TẠI), rồi lưu nháp
 * gắn theo liên hệ Zalo (nguồn Trợ lý) — «đồng ý» ở tin sau mới chạy `execute` (kiểm lại quyền + dấu trạng thái ở `executeOpenDraft`).
 */
export async function draftImmediateWrite(ctx: DataAccessContext, action: AnyWriteAction, rawArgs: unknown): Promise<WriteDraftNotice> {
  if (!canPropose(ctx, action)) throw new DataAccessError("forbidden", "Không đủ điều kiện thực hiện thao tác này.");
  const parsed = action.schema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new DataAccessError("invalid_value", `Tham số không hợp lệ: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(gốc)"}: ${issue.message}`).join("; ")}`);
  }
  const prepared = await guardWrite(() => action.prepare(ctx, parsed.data));
  const { id, code, expiresAt } = await createDraft(ctx.db, {
    ...draftBindingOf({ ...ctx, source: McpCallSource.Assistant, keyId: null }), tool: action.tool, ttlMs: action.ttlMs, targetEntity: prepared.targetEntity, targetId: prepared.targetId,
    payload: { args: parsed.data, state: prepared.stateToken }, preview: prepared.preview, now: ctx.now,
  });
  return { id, code, preview: prepared.preview, expiresAt };
}

export type GuardedWriteResult =
  | { kind: "executed"; done: WriteExecuted }
  | { kind: "drafted"; draft: WriteDraftNotice }
  /** Cần nháp nhưng không xác nhận được ở đây (hỏi trong nhóm / xem thử từ web): `reply` là câu trả lời cho mô hình, không ghi gì. */
  | { kind: "refused"; reply: string };

const EXAMPLE_REQUEST: Record<GuardedTargetKind, string> = { task: "«hủy V-12»", ticket: "«hủy T-12»", item: "«xong tin số 123»" };

/**
 * Ghi ngay nếu `target` null (không thuộc diện chặn) hoặc mã đích do chính người hỏi nêu; không thì nháp + xem trước — trừ khi nháp không xác nhận được
 * («đồng ý» trơn ở nhóm không tới lệnh; xem thử từ web không có tin Zalo của người được chọn) → `refused`, không ghi, không để nháp mồ côi.
 */
export async function executeOrDraftWrite(ctx: DataAccessContext, action: AnyWriteAction, rawArgs: unknown, target: GuardedTarget | null): Promise<GuardedWriteResult> {
  if (target === null || await ownTextNamesTarget(ctx, target)) return { kind: "executed", done: await executeImmediateWrite(ctx, action, rawArgs) };
  if (ctx.contactActor?.groupId != null) {
    return { kind: "refused", reply: `Thao tác này cần xác nhận mà trong nhóm không xác nhận được. Báo người hỏi nhắn RIÊNG cho bot và nêu rõ mã (vd ${EXAMPLE_REQUEST[target.kind]}).` };
  }
  if (!ctx.ownDirectUid) {
    return { kind: "refused", reply: `Đang xem thử từ web nên không tạo được nháp xác nhận. Thao tác thật cần người đó nhắn riêng cho bot và nêu rõ mã (vd ${EXAMPLE_REQUEST[target.kind]}).` };
  }
  return { kind: "drafted", draft: await draftImmediateWrite(ctx, action, rawArgs) };
}
