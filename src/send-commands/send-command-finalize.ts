import { SendActionKind, SendCommandSource, SendCommandStatus } from "../constants.js";
import { enqueueContactMessage } from "../messaging/contact-message.js";
import type { SendCommandDeps } from "./send-command-deps.js";
import { claimReport, countOpenTargets, releaseReport, setCommandStatusIf } from "./send-command-lifecycle-queries.js";
import { formatResultReport } from "./send-command-preview.js";
import { findCommand, listTargets } from "./send-command-repository.js";
import { formatReminderResultReport } from "./send-reminder-preview.js";

// Chốt lệnh khi hết nơi chờ (phase 9): Sending / Scheduled → Done, rồi báo kết quả từng nơi về cuộc riêng của người ra lệnh.
// Báo kết quả idempotent: giành `reported_at` (UPDATE … WHERE reported_at IS NULL) rồi mới xếp tin báo — gọi nhiều lần
// (handler + việc nền) vẫn chỉ MỘT tin báo.

/** true = lệnh đã chốt (Done). Gọi an toàn nhiều lần. */
export async function finalizeIfDone(deps: SendCommandDeps, commandId: number, now: Date = new Date()): Promise<boolean> {
  if (await countOpenTargets(deps.db, commandId)) return false;
  await setCommandStatusIf(deps.db, commandId, [SendCommandStatus.Sending, SendCommandStatus.Scheduled], SendCommandStatus.Done);
  const command = await findCommand(deps.db, commandId);
  if (!command || command.status !== SendCommandStatus.Done) return false;
  if (command.source !== SendCommandSource.Zalo || !command.sourceThreadId) return true;
  if (!(await claimReport(deps.db, commandId, now))) return true;
  try {
    const targets = await listTargets(deps.db, commandId);
    const text = command.actionKind === SendActionKind.Reminder ? formatReminderResultReport(command, targets) : formatResultReport(command, targets);
    await enqueueContactMessage({ db: deps.db, wakeJobs: deps.wakeJobs }, { threadId: command.sourceThreadId, text }, `sendcmd-report:${commandId}`);
  } catch (error) {
    // Chưa xếp được tin báo thì trả lượt báo để việc nền thử lại
    await releaseReport(deps.db, commandId);
    throw error;
  }
  return true;
}
