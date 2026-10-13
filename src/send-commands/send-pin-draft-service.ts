import { SendActionKind, SendCommandSource } from "../constants.js";
import type { CreateDraftResult } from "./send-command-draft-service.js";
import type { SendCommandDeps } from "./send-command-deps.js";
import { expireRequesterDrafts } from "./send-command-lifecycle-queries.js";
import { CONFIRM_TTL_MS, MAX_PIN_CHARS } from "./send-command-limits.js";
import { insertDraft } from "./send-command-repository.js";
import { precheckGroupAction, refuse, resolveGroupActionTargets, type GroupActionDraftInput } from "./send-group-action-draft-common.js";
import { formatPinPreview } from "./send-pin-preview.js";

// Dựng NHÁP ghim ghi chú lên nhóm từ tin riêng (công cụ AI propose_group_pin): kiểm quyền + trần → nhóm đích (CHỈ nhóm) → nội dung
// → ghi nháp (action_kind = 3, body = nội dung ghim) → bản xem trước. Dùng chung nháp / «đồng ý» / báo kết quả với lệnh gửi tin.

export interface CreatePinDraftInput extends GroupActionDraftInput {
  groupNames: string[];
  /**
   * Nội dung ghim: hoặc do MÁY CHỦ dựng từ cuộc họp bot đã tạo, hoặc do mô hình soạn (≤ 1000 ký tự) — cả hai đều hiện NGUYÊN
   * trong bản xem trước để người dùng duyệt trước khi «đồng ý».
   */
  content: string;
}

/** Bỏ ký tự điều khiển (giữ xuống dòng / tab), chuẩn hóa Unicode, cắt đầu cuối. */
export function cleanPinContent(raw: string): string {
  // eslint-disable-next-line no-control-regex -- chủ ý loại ký tự điều khiển khỏi nội dung ghim
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

export async function createPinDraft(deps: SendCommandDeps, input: CreatePinDraftInput, now: Date = new Date()): Promise<CreateDraftResult> {
  const { requester } = input;
  const pre = await precheckGroupAction(deps, SendActionKind.Pin, requester, input.question, input.groupNames, now);
  if ("refusal" in pre) return pre.refusal;
  const content = cleanPinContent(input.content);
  if (!content) return refuse("Anh/chị cho em biết ghim nội dung gì — nội dung ghim đang trống.");
  if (content.length > MAX_PIN_CHARS) return refuse(`Nội dung ghim dài ${content.length} ký tự — tối đa ${MAX_PIN_CHARS}. Anh/chị rút gọn giúp em.`);

  const resolved = await resolveGroupActionTargets(deps, SendActionKind.Pin, requester, pre.names);
  if ("refusal" in resolved) return resolved.refusal;
  const { targets } = resolved;

  // Mỗi người MỘT nháp sống: nháp cũ (gửi tin, nhắc hẹn hay ghim) hết hiệu lực để «đồng ý» không trỏ nhầm
  await expireRequesterDrafts(deps.db, requester.uid);
  const commandId = await insertDraft(deps.db, {
    source: SendCommandSource.Zalo, requesterContactId: input.requesterContactId ?? null, requesterUid: requester.uid,
    requesterName: requester.name, botAccountId: input.botAccountId ?? null, sourceThreadId: input.sourceThreadId,
    sourceMessageId: input.sourceMessageId ?? null, body: content, actionKind: SendActionKind.Pin,
    confirmExpiresAt: new Date(now.getTime() + CONFIRM_TTL_MS), targets: targets.map((candidate) => candidate.target),
  });
  const reply = formatPinPreview({
    id: commandId, content, targets: targets.map((candidate) => ({ displayName: candidate.target.displayName, secret: candidate.secret })),
  });
  return { reply, commandId };
}
