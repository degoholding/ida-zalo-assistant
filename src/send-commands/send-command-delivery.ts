import { SendActionKind, SendCommandSource, SendCommandStatus, SendTargetKind, SendTargetStatus } from "../constants.js";
import { JobSkippedError } from "../jobs/job-skipped-error.js";
import type { JobRow } from "../jobs/job-queue.js";
import { describeError } from "../logger.js";
import { BotHaltedError } from "../messaging/bot-halted-error.js";
import type { SendDeliveryDeps, SendTargetJobPayload } from "./send-command-deps.js";
import { setCommandStatusIf } from "./send-command-lifecycle-queries.js";
import { finalizeIfDone } from "./send-command-finalize.js";
import { canIssueSendCommand } from "./send-command-permissions.js";
import { findCommand, findTarget, markTarget } from "./send-command-repository.js";
import type { SendCommandRow, SendTargetRow } from "./send-command-types.js";
import { checkTargetStillAllowed, loadGroupScope, loadSendRequester } from "./send-target-resolver.js";

// Handler job `SendCommandTarget` (phase 9): giao tin tới MỘT nơi nhận — hoặc (action_kind = 2) tạo nhắc hẹn Zalo cho MỘT nhóm. Phase 4 đăng ký `runSendTargetJob` vào JobRunner
// với `deps.port` nối vào SyncService. Kiểm quyền LẦN BA ở đây (vai trò / loại nhóm có thể đổi trong lúc chờ hẹn).

const HALTED_TEXT = "bot đang tắt khẩn lúc tới giờ gửi";

/** Tiến độ đã gửi của CHÍNH job này (do port ghi lại sau mỗi phần) — thử lại không gửi lặp phần đã xong. */
function readProgress(payload: unknown): Pick<SendTargetJobPayload, "textSent" | "sentAttachmentCount" | "sentFileCount"> {
  const record = (payload ?? {}) as Record<string, unknown>;
  const count = (value: unknown) => (typeof value === "number" ? value : undefined);
  // Phải đọc ĐỦ ba mốc deliverContactMessage ghi — thiếu `sentAttachmentCount` thì thử lại gửi lặp tệp đã gửi
  return { textSent: record.textSent === true ? true : undefined, sentAttachmentCount: count(record.sentAttachmentCount), sentFileCount: count(record.sentFileCount) };
}

export function buildDeliveryPayload(command: SendCommandRow, target: SendTargetRow, jobPayload: unknown): SendTargetJobPayload {
  return {
    targetId: target.id,
    ...(target.threadId ? { threadId: target.threadId } : { zaloUid: target.zaloUid ?? target.key.slice(2) }),
    name: target.kind === SendTargetKind.Person ? target.displayName : undefined,
    text: command.body || undefined,
    attachmentIds: command.attachmentIds.length ? command.attachmentIds : undefined,
    ...readProgress(jobPayload),
  };
}

/** Lệnh Zalo: người ra lệnh còn quyền và nơi nhận còn hợp lệ? Trả lý do nếu không (lệnh web: quản trị đã gửi được thì thôi). */
async function checkStillPermitted(deps: SendDeliveryDeps, command: SendCommandRow, target: SendTargetRow): Promise<string | null> {
  if (command.source !== SendCommandSource.Zalo) return null;
  const requester = await loadSendRequester(deps.db, command.requesterUid);
  if (!requester || !canIssueSendCommand(requester)) return "người ra lệnh không còn quyền ra lệnh";
  return checkTargetStillAllowed(deps.db, target, await loadGroupScope(deps.db, requester.recipientId), command.actionKind === SendActionKind.Reminder);
}

async function failTarget(deps: SendDeliveryDeps, target: SendTargetRow, reason: string): Promise<void> {
  await markTarget(deps.db, target.id, SendTargetStatus.Failed, reason);
  await finalizeIfDone(deps, target.commandId);
}

/** Nhắc hẹn: chỉ nhóm, giờ nhắc còn ở tương lai. Ném JobSkippedError khi không còn tạo được (không thử lại). */
async function createReminderOnce(deps: SendDeliveryDeps, command: SendCommandRow, target: SendTargetRow, job: JobRow, now: Date): Promise<void> {
  if (target.kind !== SendTargetKind.Group || !target.threadId) throw new JobSkippedError("nhắc hẹn chỉ tạo cho nhóm");
  if (!command.reminderAt || command.reminderAt.getTime() <= now.getTime()) throw new JobSkippedError("giờ nhắc đã qua lúc tới lượt tạo");
  await deps.port.createReminder({
    threadId: target.threadId, title: command.body, startTime: command.reminderAt.getTime(), repeat: command.reminderRepeat,
    checkExisting: job.attempts > 1 || target.attemptNo > 1,
  }, job);
}

const deliverOnce = (deps: SendDeliveryDeps, command: SendCommandRow, target: SendTargetRow, job: JobRow, now: Date): Promise<void> =>
  command.actionKind === SendActionKind.Reminder
    ? createReminderOnce(deps, command, target, job, now)
    : deps.port.deliver(buildDeliveryPayload(command, target, job.payload), job);

export async function runSendTargetJob(deps: SendDeliveryDeps, job: JobRow, now: Date = new Date()): Promise<void> {
  const targetId = Number((job.payload as { targetId?: unknown } | null)?.targetId);
  const target = Number.isFinite(targetId) ? await findTarget(deps.db, targetId) : null;
  if (!target) throw new JobSkippedError("nơi nhận của lệnh gửi không còn");
  // Chỉ nơi đang chờ giao (Queued) mới gửi — đã gửi / hủy / lỗi (việc cũ của lượt trước) thì bỏ qua
  if (target.status !== SendTargetStatus.Queued) return;
  const command = await findCommand(deps.db, target.commandId);
  if (!command || command.status === SendCommandStatus.Cancelled) return;

  const refusal = await checkStillPermitted(deps, command, target);
  if (refusal) return failTarget(deps, target, `không gửi: ${refusal}`);

  await setCommandStatusIf(deps.db, command.id, [SendCommandStatus.Scheduled], SendCommandStatus.Sending);
  const lastAttempt = job.attempts >= job.maxAttempts;
  try {
    await deliverOnce(deps, command, target, job, now);
  } catch (error) {
    if (error instanceof BotHaltedError) {
      await failTarget(deps, target, HALTED_TEXT);
      throw error;
    }
    if (error instanceof JobSkippedError) {
      await failTarget(deps, target, error.message);
      throw error;
    }
    if (lastAttempt) await failTarget(deps, target, describeError(error));
    throw error;
  }
  await markTarget(deps.db, target.id, SendTargetStatus.Sent);
  await finalizeIfDone(deps, target.commandId);
}
