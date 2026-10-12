import { JobKind, SendTargetStatus } from "../constants.js";
import { enqueueJob } from "../jobs/job-queue.js";
import type { SendCommandDeps } from "./send-command-deps.js";
import { SCHEDULED_JOB_GRACE_MS } from "./send-command-limits.js";
import { beginTargetAttempt, markTarget, setTargetJob } from "./send-command-repository.js";
import { describeError } from "../logger.js";

// Xếp MỘT job gửi cho MỘT nơi nhận (phase 9): lượt mới `attempt_no + 1` → `dedupeKey sendcmd:t<id>:a<lượt>` nên khởi động
// lại / «đồng ý» hai lần không gửi trùng. Việc cùng lệnh chạy tuần tự (`serialKey send:<lệnh>`) nhờ giãn cách gửi sẵn có.

/** true = đã xếp (hoặc job đã có sẵn); false = nơi nhận không ở trạng thái mở lượt được, hoặc xếp việc lỗi (nơi đó thành Failed). */
export async function queueTargetJob(deps: SendCommandDeps, commandId: number, targetId: number, runAfter: Date | undefined): Promise<boolean> {
  const attempt = await beginTargetAttempt(deps.db, targetId);
  if (attempt === null) return false;
  try {
    const jobId = await enqueueJob(deps.db, {
      kind: JobKind.SendCommandTarget, payload: { targetId }, dedupeKey: `sendcmd:t${targetId}:a${attempt}`, serialKey: `send:${commandId}`,
      runAfter, expiresInMs: SCHEDULED_JOB_GRACE_MS, maxAttempts: 3,
    });
    if (jobId !== null) await setTargetJob(deps.db, targetId, jobId);
    return true;
  } catch (error) {
    await markTarget(deps.db, targetId, SendTargetStatus.Failed, `không xếp được việc gửi: ${describeError(error)}`);
    return false;
  }
}
