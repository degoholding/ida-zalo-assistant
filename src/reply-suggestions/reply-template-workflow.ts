import { can, type Principal } from "../auth/principal.js";
import { ReplyTemplateStatus, ReplyTone } from "../constants.js";
import type { Db } from "../db/pool.js";
import { diffFields, recordAudit } from "../web/api/audit-log.js";
import { findTemplate, insertTemplate, setTemplateStatus, updateTemplate } from "./reply-template-repository.js";
import type { ReplyTemplate, ReplyTemplateInput } from "./reply-suggestion-types.js";

// Luồng soạn → duyệt mẫu tin (phase 10 — N2, chốt 12/10/2026). Người soạn = tài khoản web; sửa mẫu ở BẤT KỲ trạng thái nào đều
// đưa về «Chờ duyệt» (trừ người có quyền duyệt sửa mẫu đã duyệt: giữ «Đã duyệt»); chỉ người có quyền `approve` (Quản trị + Quản lý) duyệt / trả lại / ngừng dùng, kể cả mẫu mình soạn.
// Quyền kiểm Ở ĐÂY (không chỉ ở API) để mọi đường vào đều qua một luật. Lỗi ném `ReplyTemplateError` — API phase 7 đổi sang mã HTTP.

export type TemplateErrorCode = "validation" | "forbidden" | "not_found" | "conflict";

export class ReplyTemplateError extends Error {
  constructor(readonly code: TemplateErrorCode, message: string) {
    super(message);
  }
}

export type TemplateAction = "edit" | "submit" | "approve" | "return" | "archive";

export interface TransitionRequest {
  action: TemplateAction;
  status: ReplyTemplateStatus;
  isAuthor: boolean;
  canApprove: boolean;
  /** Ghi chú trả lại (chỉ `return`). */
  note?: string;
}

export type TransitionDecision = { ok: true; next: ReplyTemplateStatus } | { ok: false; code: TemplateErrorCode; message: string };

export const RETURN_NOTE_MIN = 5;
export const RETURN_NOTE_MAX = 500;

const deny = (code: TemplateErrorCode, message: string): TransitionDecision => ({ ok: false, code, message });

/** Luật chuyển trạng thái, thuần (không đụng DB) — mọi ca quyền / trạng thái nằm ở đây để kiểm thử. */
export function decideTemplateTransition(request: TransitionRequest): TransitionDecision {
  const { action, status, isAuthor, canApprove } = request;
  switch (action) {
    case "edit":
      if (!isAuthor && !canApprove) return deny("forbidden", "Chỉ người soạn hoặc người duyệt mới sửa được mẫu này.");
      // Người có quyền duyệt sửa mẫu ĐÃ DUYỆT thì giữ «Đã duyệt» (chốt 13/10/2026: duyệt xong bấm Lưu không quay về chờ duyệt)
      if (canApprove && status === ReplyTemplateStatus.Approved) return { ok: true, next: ReplyTemplateStatus.Approved };
      return { ok: true, next: ReplyTemplateStatus.PendingReview };
    case "submit":
      if (!isAuthor && !canApprove) return deny("forbidden", "Chỉ người soạn hoặc người duyệt mới gửi duyệt được mẫu này.");
      if (status !== ReplyTemplateStatus.Draft) return deny("conflict", "Chỉ mẫu ở trạng thái Nháp mới gửi duyệt; mẫu khác sửa là tự vào hàng chờ duyệt.");
      return { ok: true, next: ReplyTemplateStatus.PendingReview };
    case "approve":
      if (!canApprove) return deny("forbidden", "Bạn không có quyền duyệt mẫu tin.");
      if (status !== ReplyTemplateStatus.PendingReview) return deny("conflict", "Chỉ duyệt được mẫu đang ở trạng thái Chờ duyệt.");
      return { ok: true, next: ReplyTemplateStatus.Approved };
    case "return": {
      if (!canApprove) return deny("forbidden", "Bạn không có quyền trả lại mẫu tin.");
      if (status !== ReplyTemplateStatus.PendingReview) return deny("conflict", "Chỉ trả lại được mẫu đang ở trạng thái Chờ duyệt.");
      const length = (request.note ?? "").trim().length;
      if (length < RETURN_NOTE_MIN || length > RETURN_NOTE_MAX) {
        return deny("validation", `Ghi chú trả lại phải dài ${RETURN_NOTE_MIN}–${RETURN_NOTE_MAX} ký tự.`);
      }
      return { ok: true, next: ReplyTemplateStatus.Returned };
    }
    case "archive":
      if (!canApprove) return deny("forbidden", "Bạn không có quyền ngừng dùng mẫu tin.");
      if (status === ReplyTemplateStatus.Archived) return deny("conflict", "Mẫu đã ngừng dùng rồi.");
      return { ok: true, next: ReplyTemplateStatus.Archived };
  }
}

const NAME_RANGE = [3, 150] as const;
const BODY_RANGE = [10, 2000] as const;
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LEN = 60;
const MAX_SITUATION = 500;
const MAX_KEYWORDS_TOTAL = 500;

/** Kiểm + chuẩn hóa trường nhập (ranh giới hệ thống: dữ liệu từ web). Ném `validation` khi sai. */
export function validateTemplateInput(raw: Record<string, unknown>): ReplyTemplateInput {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const name = text(raw.name);
  const body = text(raw.body);
  const situation = text(raw.situation);
  const keywordSource = Array.isArray(raw.keywords) ? raw.keywords.map(String) : text(raw.keywords).split(",");
  const keywords = [...new Set(keywordSource.map((item) => item.trim()).filter(Boolean))];
  const tone = Number(raw.tone ?? ReplyTone.Formal);
  const fail = (message: string): never => { throw new ReplyTemplateError("validation", message); };
  if (name.length < NAME_RANGE[0] || name.length > NAME_RANGE[1]) fail(`Tên mẫu phải dài ${NAME_RANGE[0]}–${NAME_RANGE[1]} ký tự.`);
  if (body.length < BODY_RANGE[0] || body.length > BODY_RANGE[1]) fail(`Nội dung mẫu phải dài ${BODY_RANGE[0]}–${BODY_RANGE[1]} ký tự.`);
  if (situation.length > MAX_SITUATION) fail(`Tình huống tối đa ${MAX_SITUATION} ký tự.`);
  if (keywords.length > MAX_KEYWORDS) fail(`Tối đa ${MAX_KEYWORDS} từ khóa.`);
  if (keywords.some((item) => item.length > MAX_KEYWORD_LEN || item.includes(","))) fail(`Mỗi từ khóa tối đa ${MAX_KEYWORD_LEN} ký tự.`);
  if (keywords.join(", ").length > MAX_KEYWORDS_TOTAL) fail(`Danh sách từ khóa tối đa ${MAX_KEYWORDS_TOTAL} ký tự.`);
  if (![ReplyTone.Formal, ReplyTone.Friendly, ReplyTone.Brief].includes(tone)) fail("Tông mẫu không hợp lệ.");
  return { name, situation, keywords, body, tone };
}

const FIELD_LABELS = { name: "Tên", situation: "Tình huống", keywords: "Từ khóa", body: "Nội dung", tone: "Tông" };

function actorOf(principal: Principal) {
  return { userId: principal.userId, name: principal.fullName || "Hệ thống", canApprove: can(principal, "reply_template", "approve") };
}

async function loadOrFail(db: Db, tenantId: number, id: number): Promise<ReplyTemplate> {
  const template = await findTemplate(db, tenantId, id);
  if (!template) throw new ReplyTemplateError("not_found", "Không có mẫu tin này.");
  return template;
}

function decideOrThrow(request: TransitionRequest): ReplyTemplateStatus {
  const decision = decideTemplateTransition(request);
  if (!decision.ok) throw new ReplyTemplateError(decision.code, decision.message);
  return decision.next;
}

/** Tạo mẫu mới: vào thẳng «Chờ duyệt». Trả id. */
export async function createTemplate(db: Db, principal: Principal, raw: Record<string, unknown>): Promise<number> {
  if (!can(principal, "reply_template", "create")) throw new ReplyTemplateError("forbidden", "Bạn không có quyền soạn mẫu tin.");
  const input = validateTemplateInput(raw);
  const actor = actorOf(principal);
  const id = await insertTemplate(db, principal.tenantId, input, ReplyTemplateStatus.PendingReview, { userId: actor.userId, name: actor.name });
  await recordAudit(db, { entity: "reply_template", entityId: id, action: "create", message: `Soạn mẫu «${input.name}», chờ duyệt` });
  return id;
}

/** Sửa mẫu (mọi trạng thái) → «Chờ duyệt». */
export async function editTemplate(db: Db, principal: Principal, id: number, raw: Record<string, unknown>): Promise<void> {
  if (!can(principal, "reply_template", "write")) throw new ReplyTemplateError("forbidden", "Bạn không có quyền sửa mẫu tin.");
  const template = await loadOrFail(db, principal.tenantId, id);
  const actor = actorOf(principal);
  const next = decideOrThrow({
    action: "edit", status: template.status, isAuthor: actor.userId !== null && template.authorUserId === actor.userId, canApprove: actor.canApprove,
  });
  const input = validateTemplateInput(raw);
  const affected = await updateTemplate(db, principal.tenantId, id, input, template.status, next);
  if (!affected) throw new ReplyTemplateError("conflict", "Mẫu vừa được người khác đổi — tải lại rồi sửa tiếp.");
  const before = { ...template, keywords: template.keywords.join(", ") };
  const changed = diffFields(before, { ...input, keywords: input.keywords.join(", ") }, FIELD_LABELS);
  const wasApproved = template.status === ReplyTemplateStatus.Approved;
  await recordAudit(db, {
    entity: "reply_template", entityId: id, action: "update", changedFields: changed,
    message: next === ReplyTemplateStatus.Approved ? "Sửa mẫu đã duyệt (người duyệt sửa — giữ Đã duyệt)" : wasApproved ? "Sửa mẫu đã duyệt — về Chờ duyệt, bot tạm ngừng dùng cho tới khi duyệt lại" : "Sửa mẫu, chờ duyệt",
  });
}

type StatusAction = Exclude<TemplateAction, "edit">;

/** Nháp → Chờ duyệt | Chờ duyệt → Đã duyệt / Trả lại | mọi trạng thái → Ngừng dùng. Ghi nhật ký. */
export async function changeTemplateStatus(
  db: Db, principal: Principal, id: number, action: StatusAction, note?: string,
): Promise<ReplyTemplateStatus> {
  if (!can(principal, "reply_template", "write")) throw new ReplyTemplateError("forbidden", "Bạn không có quyền thao tác mẫu tin.");
  const template = await loadOrFail(db, principal.tenantId, id);
  const actor = actorOf(principal);
  const cleanNote = (note ?? "").trim();
  const next = decideOrThrow({
    action, status: template.status, isAuthor: actor.userId !== null && template.authorUserId === actor.userId, canApprove: actor.canApprove, note: cleanNote,
  });
  const reviewer = { userId: actor.userId, name: actor.name };
  const patch = action === "submit" ? { submitted: true }
    : action === "approve" ? { reviewer, reviewNote: "" }
    : action === "return" ? { reviewer, reviewNote: cleanNote }
    : { reviewer };
  const affected = await setTemplateStatus(db, principal.tenantId, id, template.status, next, patch);
  if (!affected) throw new ReplyTemplateError("conflict", "Mẫu vừa được người khác đổi — tải lại rồi thao tác lại.");
  const selfApproved = action === "approve" && actor.userId !== null && template.authorUserId === actor.userId;
  const messages: Record<StatusAction, string> = {
    submit: "Gửi duyệt",
    approve: selfApproved ? "Duyệt mẫu (người soạn tự duyệt)" : "Duyệt mẫu",
    return: `Trả lại mẫu: ${cleanNote}`,
    archive: "Ngừng dùng mẫu",
  };
  await recordAudit(db, { entity: "reply_template", entityId: id, action: action === "return" ? "return" : action, message: messages[action] });
  return next;
}
