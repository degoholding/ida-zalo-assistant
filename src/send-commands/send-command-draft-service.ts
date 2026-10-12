import { SendCommandSource } from "../constants.js";
import { parseDueText } from "../tasks/task-due-parser.js";
import { assertNamesInQuestion, assertVerbatim, SendCommandInputError } from "./send-command-content-guard.js";
import type { SendCommandDeps } from "./send-command-deps.js";
import { findRecentFiles, expireRequesterDrafts, listAttachmentNames, resetFilesForDownload } from "./send-command-lifecycle-queries.js";
import {
  ATTACH_WINDOW_MS, CONFIRM_TTL_MS, MAX_ATTACHMENTS, MAX_BODY_CHARS, MAX_DRAFTS_PER_HOUR, MAX_SCHEDULE_AHEAD_DAYS, MAX_TARGETS,
} from "./send-command-limits.js";
import { canIssueSendCommand } from "./send-command-permissions.js";
import { formatPreview } from "./send-command-preview.js";
import { countRecent, insertDraft } from "./send-command-repository.js";
import type { SendRequester } from "./send-command-types.js";
import { loadGroupScope, resolveTargetNames } from "./send-target-resolver.js";
import { foldName } from "./send-target-matcher.js";

// Dựng NHÁP lệnh gửi (phase 9): kiểm quyền + trần → phân giải nơi nhận → giờ hẹn → tệp kèm → ghi nháp → bản xem trước.
// Tên mơ hồ / không thấy / không được phép → trả câu giải thích, KHÔNG tạo nháp. Dùng chung cho lệnh gõ và công cụ AI.

const TRUSTED_NAME_HINT = "Tên nơi nhận phải đúng như anh/chị viết — nhắn lại, ví dụ «gửi link họp vừa tạo vào nhóm A».";
const MIN_LEAD_MS = 60_000;
const DAY_MS = 86_400_000;

export interface CreateDraftInput {
  requester: SendRequester;
  requesterContactId?: number | null;
  /** NGUYÊN VĂN tin người ra lệnh ở lượt này — nội dung + tên nơi nhận phải nằm trong đây (assertVerbatim) */
  question: string;
  targetNames: string[];
  /** «8h sáng mai» — rỗng = gửi ngay */
  scheduleText: string;
  body: string;
  /**
   * true = `body` do MÁY CHỦ dựng (lời mời họp từ dữ liệu Calendar), không phải chữ người dùng/mô hình → bỏ kiểm nguyên văn.
   * Chỉ công cụ propose_meeting_announcement được đặt; tên nơi nhận vẫn phải có trong tin người ra lệnh.
   */
  trustedBody?: boolean;
  withRecentFiles: boolean;
  /** Cuộc riêng nơi ra lệnh — báo kết quả về đây, và tìm tệp vừa gửi */
  sourceThreadId: number;
  sourceMessageId?: number | null;
  botAccountId?: number | null;
}

export interface CreateDraftResult {
  /** Câu trả lời nguyên văn cho người ra lệnh (bản xem trước hoặc lý do không tạo nháp) */
  reply: string;
  commandId?: number;
}

const refuse = (reply: string): CreateDraftResult => ({ reply });

/** Giờ hẹn → mốc giờ, hoặc câu lỗi. `at` null = gửi ngay. */
function planSchedule(scheduleText: string, now: Date): { at: Date | null } | { error: string } {
  if (!scheduleText.trim()) return { at: null };
  const due = parseDueText(scheduleText, now);
  if (!due?.hasTime) return { error: `Em chưa hiểu giờ hẹn «${scheduleText.trim()}» — anh/chị ghi cả giờ, ví dụ «lúc 8h sáng mai».` };
  if (due.at.getTime() <= now.getTime() + MIN_LEAD_MS) return { error: "Giờ hẹn đã qua hoặc quá sát — anh/chị chọn giờ muộn hơn, hoặc bỏ giờ để gửi ngay." };
  if (due.at.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_DAYS * DAY_MS) return { error: `Chỉ hẹn được trong ${MAX_SCHEDULE_AHEAD_DAYS} ngày tới.` };
  return { at: due.at };
}

/** Cảnh báo (vẫn cho gửi) khi giờ gửi rơi vào ngày nghỉ / giờ yên lặng. */
function offHoursNote(deps: SendCommandDeps, sendAt: Date): string {
  if (!deps.calendar.isWorkingDay(sendAt)) return "Giờ gửi rơi vào ngày nghỉ — người nhận có thể thấy tin muộn.";
  return deps.calendar.isQuietTime(sendAt) ? "Giờ gửi rơi vào giờ yên lặng — người nhận có thể thấy tin muộn." : "";
}

export async function createDraft(deps: SendCommandDeps, input: CreateDraftInput, now: Date = new Date()): Promise<CreateDraftResult> {
  const { requester } = input;
  if (!canIssueSendCommand(requester)) return refuse("Lệnh gửi tin chỉ dành cho người nhận cảnh báo hoặc Quản lý / Trưởng phòng ạ.");
  if (await countRecent(deps.db, requester.uid, "draft", new Date(now.getTime() - 3_600_000)) >= MAX_DRAFTS_PER_HOUR) {
    return refuse("Anh/chị ra lệnh gửi khá nhiều trong một giờ qua — thử lại sau giúp em nhé.");
  }
  const names = [...new Map(input.targetNames.map((name) => [foldName(name), name.trim()] as const)).values()].filter(Boolean);
  if (!names.length) return refuse("Anh/chị cho em biết gửi tới đâu: «gửi nhóm A, anh B: <nội dung>».");
  if (names.length > MAX_TARGETS) return refuse(`Mỗi lệnh gửi tối đa ${MAX_TARGETS} nơi (anh/chị nêu ${names.length}). Anh/chị chia làm hai lệnh giúp em.`);
  // Nội dung gửi đi = ĐOẠN GỐC cắt từ tin người ra lệnh (không phải chữ mô hình chép lại)
  let body: string;
  try {
    if (input.trustedBody) {
      assertNamesInQuestion(input.question, names, TRUSTED_NAME_HINT);
      body = input.body.trim();
    } else {
      body = assertVerbatim(input.question, input.body, names);
    }
  } catch (error) {
    if (error instanceof SendCommandInputError) return refuse(error.message);
    throw error;
  }
  if (body.length > MAX_BODY_CHARS) return refuse(`Nội dung dài ${body.length} ký tự — tối đa ${MAX_BODY_CHARS}. Anh/chị rút gọn hoặc chia làm hai lệnh giúp em.`);

  const schedule = planSchedule(input.scheduleText, now);
  if ("error" in schedule) return refuse(schedule.error);

  const { targets, problems } = await resolveTargetNames(deps.db, names, await loadGroupScope(deps.db, requester.recipientId));
  if (problems.length) return refuse([...problems, "Em chưa tạo lệnh nào. Anh/chị nhắn lại giúp em."].join("\n\n"));
  if (targets.length > MAX_TARGETS) return refuse(`Mỗi lệnh gửi tối đa ${MAX_TARGETS} nơi.`);

  let attachmentIds: number[] = [];
  if (input.withRecentFiles) {
    const files = await findRecentFiles(deps.db, input.sourceThreadId, requester.uid, input.sourceMessageId ?? null,
      new Date(now.getTime() - ATTACH_WINDOW_MS), MAX_ATTACHMENTS);
    if (!files.length) return refuse(`Em chưa thấy tệp / ảnh nào anh/chị vừa gửi em trong ${ATTACH_WINDOW_MS / 60_000} phút qua. Anh/chị gửi tệp trước, rồi nhắn lại lệnh.`);
    attachmentIds = files.map((file) => file.id);
    const toFetch = await resetFilesForDownload(deps.db, files);
    if (toFetch.length) deps.requestDownload?.(toFetch);
  }
  if (!body && !attachmentIds.length) return refuse("Anh/chị chưa ghi nội dung cần gửi: «gửi nhóm A: <nội dung>».");

  const scheduledAt = schedule.at;
  const note = offHoursNote(deps, scheduledAt ?? now);
  // Mỗi người MỘT nháp sống: nháp cũ hết hiệu lực để «đồng ý» không bao giờ trỏ nhầm lệnh
  await expireRequesterDrafts(deps.db, requester.uid);
  const commandId = await insertDraft(deps.db, {
    source: SendCommandSource.Zalo, requesterContactId: input.requesterContactId ?? null, requesterUid: requester.uid,
    requesterName: requester.name, botAccountId: input.botAccountId ?? null, sourceThreadId: input.sourceThreadId,
    sourceMessageId: input.sourceMessageId ?? null, body, attachmentIds, scheduledAt, offHoursNote: note,
    confirmExpiresAt: new Date(now.getTime() + CONFIRM_TTL_MS), targets: targets.map((candidate) => candidate.target),
  });
  const reply = formatPreview({
    id: commandId, scheduledAt, offHoursNote: note, body, attachmentNames: await listAttachmentNames(deps.db, attachmentIds),
    targets: targets.map((candidate) => ({ kind: candidate.target.kind, displayName: candidate.target.displayName, secret: candidate.secret })),
  });
  return { reply, commandId };
}
