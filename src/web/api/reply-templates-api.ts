import type { RowDataPacket } from "mysql2";
import { can, type Principal } from "../../auth/principal.js";
import { ReplyTemplateStatus } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { changeTemplateStatus, createTemplate, editTemplate, ReplyTemplateError } from "../../reply-suggestions/reply-template-workflow.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import type { ListSpec, SqlPart } from "./list-query.js";
import { runList } from "./list-runner.js";
import { buildVnDayCondition } from "./send-commands-api.js";

// Màn web "Mẫu tin" (phase 10, phase 7). Mọi thay đổi đi qua `reply-template-workflow.ts` (kiểm quyền + luật trạng thái + nhật ký);
// tệp này chỉ lọc / phân trang, dựng cờ `can_edit` / `can_review` cho giao diện và đổi `ReplyTemplateError` sang mã HTTP.

export const REPLY_TEMPLATE_LIST_SPEC: ListSpec = {
  fields: {
    status: { sql: "r.status", type: "number" },
    tone: { sql: "r.tone", type: "number" },
    author_user_id: { sql: "r.author_user_id", type: "number" },
    reviewer_user_id: { sql: "r.reviewer_user_id", type: "number" },
    updated_at: { type: "date", build: (operator, values) => buildVnDayCondition("r.updated_at", operator, values) },
  },
  sorts: { updated_at: "r.updated_at", name: "r.name", status: "r.status", tone: "r.tone" },
  defaultSort: { by: "updated_at", dir: "desc" },
  tieBreaker: "r.id",
  search: { param: "q", columns: ["r.name", "r.situation", "r.keywords", "r.body"] },
};

const TEMPLATE_FROM = "FROM reply_template r";
const TEMPLATE_COLUMNS = `r.id, r.name, r.situation, r.keywords, r.body, r.tone, r.status, r.author_user_id, r.author_name,
  r.reviewer_user_id, r.reviewer_name, r.review_note, r.submitted_at, r.reviewed_at, r.created_at, r.updated_at`;

/** Chưa lọc theo trạng thái (không có `status` trên URL) thì ẩn mẫu "Ngừng dùng"; lọc rõ thì thấy hết. */
export function buildTemplateBaseWhere(principal: Principal, params: URLSearchParams): SqlPart {
  if (params.has("status")) return { sql: "r.tenant_id = ?", params: [principal.tenantId] };
  return { sql: "r.tenant_id = ? AND r.status <> ?", params: [principal.tenantId, ReplyTemplateStatus.Archived] };
}

/** Cờ theo người gọi: sửa được (người soạn hoặc người có quyền duyệt) / duyệt được. Máy chủ vẫn kiểm lại khi ghi. */
export function buildTemplateFlags(principal: Principal, authorUserId: number | null): { can_edit: boolean; can_review: boolean } {
  const canReview = can(principal, "reply_template", "approve");
  const isAuthor = principal.userId !== null && authorUserId === principal.userId;
  return { can_edit: can(principal, "reply_template", "write") && (isAuthor || canReview), can_review: canReview };
}

function decorateRows(principal: Principal) {
  return (rows: RowDataPacket[]): Record<string, unknown>[] => rows.map((row) => {
    const authorUserId = row.author_user_id === null ? null : Number(row.author_user_id);
    return {
      ...row, id: Number(row.id), tone: Number(row.tone), status: Number(row.status), author_user_id: authorUserId,
      reviewer_user_id: row.reviewer_user_id === null ? null : Number(row.reviewer_user_id),
      ...buildTemplateFlags(principal, authorUserId),
    };
  });
}

async function getTemplateDetail(db: Db, id: number, principal: Principal): Promise<Record<string, unknown>> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${TEMPLATE_COLUMNS} ${TEMPLATE_FROM} WHERE r.id = ? AND r.tenant_id = ?`, [id, principal.tenantId]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có mẫu tin này");
  return decorateRows(principal)(rows)[0];
}

const HTTP_BY_CODE = { validation: [422, "validation_error"], forbidden: [403, "forbidden"], not_found: [404, "not_found"], conflict: [409, "invalid_state"] } as const;

/** Lỗi nghiệp vụ của workflow → `ApiError` (422 / 403 / 404 / 409); lỗi khác ném nguyên. */
export async function mapWorkflowError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ReplyTemplateError) {
      const [status, code] = HTTP_BY_CODE[error.code];
      throw new ApiError(status, code, error.message);
    }
    throw error;
  }
}

const STATUS_ACTIONS = new Set(["submit", "approve", "return", "archive"]);
const ACTION_DONE: Record<string, string> = { submit: "Đã gửi duyệt", approve: "Đã duyệt mẫu", return: "Đã trả lại mẫu", archive: "Đã ngừng dùng mẫu" };

export const replyTemplateRoutes: ApiRoute[] = [
  ["GET", /^\/api\/reply-templates$/, async ({ response, url, service, principal }) => sendOk(response, await runList(service.db, url.searchParams, REPLY_TEMPLATE_LIST_SPEC, {
    select: TEMPLATE_COLUMNS, from: TEMPLATE_FROM, baseWhere: buildTemplateBaseWhere(principal, url.searchParams), decorate: decorateRows(principal),
  }))],

  ["GET", /^\/api\/reply-templates\/(\d+)$/, async ({ response, match, service, principal }) =>
    sendOk(response, await getTemplateDetail(service.db, parseId(match[1]), principal))],

  ["POST", /^\/api\/reply-templates$/, async ({ request, response, service, principal }) => {
    const body = await readJson(request);
    const id = await mapWorkflowError(() => createTemplate(service.db, principal, body));
    sendOk(response, await getTemplateDetail(service.db, id, principal), "Đã lưu mẫu — chờ duyệt", 201);
  }],

  ["PATCH", /^\/api\/reply-templates\/(\d+)$/, async ({ request, response, match, service, principal }) => {
    const id = parseId(match[1]);
    const body = await readJson(request);
    await mapWorkflowError(() => editTemplate(service.db, principal, id, body));
    sendOk(response, await getTemplateDetail(service.db, id, principal), "Đã lưu mẫu — chờ duyệt");
  }],

  // { action: submit | approve | return | archive, note? } — "return" bắt buộc ghi chú (workflow trả 422); trạng thái không cho → 409
  ["POST", /^\/api\/reply-templates\/(\d+)\/actions$/, async ({ request, response, match, service, principal }) => {
    const id = parseId(match[1]);
    const body = await readJson(request);
    const action = String(body.action ?? "");
    if (!STATUS_ACTIONS.has(action)) throw new ApiError(422, "validation_error", "Thao tác không hợp lệ");
    const note = typeof body.note === "string" ? body.note : undefined;
    await mapWorkflowError(() => changeTemplateStatus(service.db, principal, id, action as "submit" | "approve" | "return" | "archive", note));
    sendOk(response, await getTemplateDetail(service.db, id, principal), ACTION_DONE[action]);
  }],
];
