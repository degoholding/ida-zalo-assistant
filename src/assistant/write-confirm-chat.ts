// mcp-guard: legacy(drafts) — đường cũ của «đồng ý / hủy» nháp ghi khi họ `drafts` tắt; gỡ ở phase 13
import { foldKeepLength } from "./fold-text.js";
import { McpCallSource, McpCallStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { executeOpenDraft } from "../data-access/write/confirm-write-tool.js";
import { DataAccessError } from "../data-access/data-access-errors.js";
import { cancelDraft, findOpenDraft, listOpenDrafts, type DraftBinding, type DraftRecord } from "../data-access/write/write-draft-store.js";
import { WRITE_ACTIONS } from "../data-access/write/write-tool-catalog.js";
import { logMcpCall } from "../mcp/mcp-call-log.js";
import type { AskerAccess } from "./infra/asker-access.js";
import { draftCommandSession, listOpenDraftsViaMcp, runDraftCommandViaMcp, type PendingDraft } from "./mcp-bridge/draft-confirm-via-mcp.js";
import type { AssistantMcpTurn } from "./mcp-bridge/assistant-mcp-turn.js";
import { assistantWriteAccess } from "./write-tool-adapter.js";
import type { PendingStoreProvider } from "./chat-confirm-router.js";
import type { ChatCommandContext } from "./chat-commands.js";

// D1 (chủ chốt 17/10/2026): xác nhận ghi ở trợ lý làm y như lệnh gửi («đồng ý G-12»). MÁY CHỦ gửi bản xem trước + mã (không phải mô hình),
// và việc ghi CHỈ chạy khi tin kế tiếp của chính người hỏi là «đồng ý» (đúng một nháp đang mở) hoặc «đồng ý <mã>» (nhiều nháp). Kiểm bằng
// mã ở đây — mô hình không có công cụ xác nhận nào, nên lời nhắn trong dữ liệu Zalo không thể kích ghi.

/** «đồng ý K7Q2MX» / «hủy K7Q2MX» (kèm «mã»): mã 6 ký tự trong bảng chữ không nhầm lẫn (không 0 O 1 I L). */
const CODED = /^(dong y|ok|oke|xac nhan|luu|huy|bo qua|cancel)\s+(?:ma\s+)?#?([2-9a-hj-km-np-z]{6})$/;

export interface WriteCodeCommand {
  kind: "confirm" | "cancel";
  code: string;
}

/** Đọc «đồng ý <mã>» / «hủy <mã>»; không phải dạng này thì null. Hàm thuần. */
export function parseWriteCodeCommand(input: string): WriteCodeCommand | null {
  const folded = foldKeepLength(input.normalize("NFC").toLowerCase()).replace(/\s+/g, " ").replace(/[.!?…]+$/u, "").trim();
  const match = folded.match(CODED);
  if (!match) return null;
  return { kind: ["huy", "bo qua", "cancel"].includes(match[1]) ? "cancel" : "confirm", code: match[2].toUpperCase() };
}

const bindingOf = (access: AskerAccess): DraftBinding => ({ tenantId: access.principal.tenantId, userId: access.principal.userId!, keyId: null, source: McpCallSource.Assistant });

/**
 * Các nháp ghi đang chờ của người hỏi (tin riêng thật, tài khoản web); rỗng nếu không đủ điều kiện. Mới nhất trước.
 * Họ `drafts` bật (có `mcp`) → qua `list_open_drafts` của máy chủ MCP; tắt → đọc thẳng kho nháp (đường cũ).
 */
export async function pendingWriteDrafts(db: Db, access: AskerAccess, now: Date, mcp?: () => Promise<AssistantMcpTurn | undefined>): Promise<PendingDraft[]> {
  const writable = assistantWriteAccess(access, undefined);
  if (!writable) return [];
  const turn = await draftCommandSession(await mcp?.());
  return turn ? listOpenDraftsViaMcp(turn) : listOpenDrafts(db, bindingOf(writable), now);
}

const shortPreview = (draft: PendingDraft) => draft.preview.replace(/\s+/g, " ").slice(0, 160);

export interface WriteConfirmInput {
  kind: "confirm" | "cancel";
  /** Mã người gõ; không có = áp cho nháp duy nhất đang mở. */
  code?: string;
  access: AskerAccess;
  drafts: PendingDraft[];
  now: Date;
  wakeJobs?: () => void;
  /** Phiên MCP của lệnh (lười): họ `drafts` bật thì «đồng ý» / «hủy» đi qua `confirm_draft` / `cancel_draft`; không có = đường cũ. */
  mcp?: () => Promise<AssistantMcpTurn | undefined>;
}

async function logOutcome(access: AskerAccess, tool: string, status: McpCallStatus, errorCode?: string): Promise<void> {
  // Không ghi mã vào log: args rỗng
  await logMcpCall(access.db, {
    userId: access.principal.userId, tenantId: access.principal.tenantId, keyId: null, source: McpCallSource.Assistant, tool, entity: "write_draft",
    args: {}, rowCount: 0, resultChars: 0, durationMs: 0, status, errorCode, clientIp: null,
  });
}

/** Chạy «đồng ý» / «hủy» lên đúng một nháp, hoặc hỏi lại mã khi mơ hồ. Trả đúng câu bot nhắn lại. */
export async function runWriteConfirm(input: WriteConfirmInput): Promise<string> {
  const { access, drafts, now } = input;
  const writable = assistantWriteAccess(access, undefined);
  if (!writable) return "Tài khoản này không ghi dữ liệu qua trợ lý được.";
  const turn = await draftCommandSession(await input.mcp?.());
  if (turn) {
    if (input.code) return runDraftCommandViaMcp(turn, input.kind, { code: input.code });
    if (drafts.length === 1) return runDraftCommandViaMcp(turn, input.kind, { draftId: drafts[0].id });
  }
  let draft: DraftRecord | null = null;
  if (input.code) {
    draft = await findOpenDraft(access.db, bindingOf(writable), input.code, now);
    if (!draft) return "Mã không đúng, đã hết hạn (10 phút) hoặc đã dùng — nhờ em tạo đề xuất mới.";
  } else if (drafts.length === 1) {
    // `drafts` có thể đến từ MCP (chỉ id / xem trước) — đường cũ cần bản ghi đầy đủ
    draft = (await listOpenDrafts(access.db, bindingOf(writable), now)).find((item) => item.id === drafts[0].id) ?? null;
    if (!draft) return "Đề xuất này đã hết hạn hoặc đã xử lý rồi.";
  } else {
    const lines = drafts.slice(0, 5).map((item, index) => `${index + 1}. ${shortPreview(item)}`);
    return [`Đang có ${drafts.length} đề xuất chờ nên em chưa biết anh/chị chọn cái nào:`, ...lines,
      `Nhắn «${input.kind === "cancel" ? "hủy" : "đồng ý"} <mã>» với mã 6 ký tự ở tin xem trước của đề xuất đó.`].join("\n");
  }
  if (input.kind === "cancel") {
    const cancelled = await cancelDraft(access.db, draft.id, now);
    await logOutcome(access, "cancel_write", McpCallStatus.Ok);
    return cancelled ? `Dạ, em đã bỏ đề xuất: ${shortPreview(draft)}. Dữ liệu giữ nguyên.` : "Đề xuất này đã hết hạn hoặc đã xử lý rồi.";
  }
  try {
    const done = await executeOpenDraft({ ...writable, now, wakeJobs: input.wakeJobs }, WRITE_ACTIONS, draft);
    await logOutcome(access, "confirm_write", McpCallStatus.Ok);
    return `Đã xong: ${done.message}`;
  } catch (error) {
    if (!(error instanceof DataAccessError)) throw error;
    await logOutcome(access, "confirm_write", error.code === "forbidden" || error.code === "not_found" ? McpCallStatus.Denied : McpCallStatus.Invalid, error.code);
    return `Chưa ghi được: ${error.message}`;
  }
}

/** «đồng ý <mã>» / «hủy <mã>»: không có quyền ghi / không có nháp nào đang mở thì null (coi là câu thường). */
export async function runWriteCodeConfirm(chat: ChatCommandContext, access: AskerAccess | null, kind: "confirm" | "cancel", code: string): Promise<string | null> {
  const drafts = access ? await pendingWriteDrafts(chat.db, access, chat.now, chat.mcp) : [];
  if (!access || !drafts.length) return null;
  return runWriteConfirm({ kind, code, access, drafts, now: chat.now, wakeJobs: chat.wakeJobs, mcp: chat.mcp });
}

/** Kho chờ xác nhận của nháp ghi dữ liệu do trợ lý đề xuất (D1: chỉ xác nhận ở đây — mô hình không có công cụ xác nhận). */
export const writePendingProvider: PendingStoreProvider = {
  async latest({ chat, access }) {
    const drafts = access ? await pendingWriteDrafts(chat.db, access, chat.now, chat.mcp) : [];
    if (!access || !drafts.length) return null;
    const run = (kind: "confirm" | "cancel") => runWriteConfirm({ kind, access, drafts, now: chat.now, wakeJobs: chat.wakeJobs, mcp: chat.mcp });
    return { at: drafts[0].createdAt.getTime(), confirm: () => run("confirm"), cancel: () => run("cancel") };
  },
};
