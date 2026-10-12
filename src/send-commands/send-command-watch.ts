import { SendTargetStatus } from "../constants.js";
import { createLogger, describeError } from "../logger.js";
import type { SendCommandDeps } from "./send-command-deps.js";
import { finalizeIfDone } from "./send-command-finalize.js";
import { listFinalizeCandidates, listStaleTargets } from "./send-command-lifecycle-queries.js";
import { expireStaleDrafts, markTarget } from "./send-command-repository.js";

// Việc nền mỗi phút của lệnh gửi (phase 9, phase 4 đăng ký vào background): lưới đỡ khi handler chết giữa chừng, job bị
// bỏ (quá giờ hẹn 2 giờ, bot tắt khẩn), hoặc xác nhận bị ngắt giữa lúc xếp job.

const log = createLogger("send-command");

export interface SendWatchResult {
  expiredDrafts: number;
  failedTargets: number;
  finalizedCommands: number;
}

export async function runSendCommandWatch(deps: SendCommandDeps, now: Date = new Date()): Promise<SendWatchResult> {
  const expiredDrafts = await expireStaleDrafts(deps.db, now);
  const stale = await listStaleTargets(deps.db, now);
  for (const target of stale) await markTarget(deps.db, target.id, SendTargetStatus.Failed, target.error);

  // Chốt cả những lệnh vừa có nơi bị đánh Failed, lẫn lệnh handler chưa kịp chốt / báo kết quả
  const toFinalize = new Set([...stale.map((target) => target.commandId), ...(await listFinalizeCandidates(deps.db, now))]);
  let finalizedCommands = 0;
  for (const commandId of toFinalize) {
    try {
      if (await finalizeIfDone(deps, commandId, now)) finalizedCommands += 1;
    } catch (error) {
      log.error(`chốt lệnh G-${commandId} lỗi`, describeError(error));
    }
  }
  if (expiredDrafts || stale.length) log.info(`việc nền lệnh gửi: ${expiredDrafts} nháp hết hạn, ${stale.length} nơi mắc kẹt → lỗi, ${finalizedCommands} lệnh chốt`);
  return { expiredDrafts, failedTargets: stale.length, finalizedCommands };
}
