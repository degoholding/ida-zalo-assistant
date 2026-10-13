import type { RowDataPacket } from "mysql2";
import { ConversationType, SendCommandSource, SendCommandStatus, SendTargetKind, SendTargetStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import type { SendActionResult, SendCommandActor, SendCommandDeps } from "./send-command-deps.js";
import { setCommandStatusIf } from "./send-command-lifecycle-queries.js";
import { formatCommandCode } from "./send-command-preview.js";
import { queueTargetJob } from "./send-command-queueing.js";
import { finalizeIfDone } from "./send-command-finalize.js";
import { canIssueSendCommand } from "./send-command-permissions.js";
import { findCommand, insertDraft, listTargets, markReported, markTarget } from "./send-command-repository.js";
import { checkTargetStillAllowed, loadGroupScope, loadSendRequester } from "./send-target-resolver.js";

// Phần dành cho màn web «Gửi tin» (phase 9): gửi lại nơi lỗi + ghi nhật ký tin quản trị gửi từ web. Quyền (chỉ quản trị gửi
// lại) kiểm ở API — hàm ở đây không biết tài khoản web.

const log = createLogger("send-command");
/** Tin web có kèm tệp: tệp không giữ lại nên không gửi lại được. Dòng này nằm cuối `body` của dòng nhật ký. */
const WEB_FILE_MARK = /\n?\(đính kèm tệp: [^)\n]*\)$/;

export interface WebSendRecord {
  userId: number;
  /** Tên hiển thị của tài khoản web */
  userName: string;
  threadId: number;
  body: string;
  fileName?: string;
  ok: boolean;
  error?: string;
}

/**
 * Ghi MỘT dòng nhật ký cho tin quản trị gửi từ màn Hội thoại (đã gửi xong hoặc lỗi) — KHÔNG đi qua xác nhận, không xếp job.
 * Không bao giờ ném: ghi nhật ký lỗi không được làm hỏng việc gửi. Trả mã lệnh hoặc null.
 */
export async function recordWebSend(db: Db, record: WebSendRecord): Promise<number | null> {
  try {
    const [rows] = await db.query<RowDataPacket[]>("SELECT thread_type, zalo_group_id, name, label FROM zalo_group WHERE id = ? LIMIT 1", [record.threadId]);
    if (!rows[0]) return null;
    const isGroup = Number(rows[0].thread_type) === ConversationType.Group;
    const displayName = String(rows[0].label || rows[0].name || rows[0].zalo_group_id);
    const body = record.fileName ? `${record.body}${record.body ? "\n" : ""}(đính kèm tệp: ${record.fileName})` : record.body;
    const commandId = await insertDraft(db, {
      source: SendCommandSource.Web, status: SendCommandStatus.Done, createdByUserId: record.userId, requesterName: record.userName,
      sourceThreadId: record.threadId, body, confirmExpiresAt: null,
      targets: [{
        kind: isGroup ? SendTargetKind.Group : SendTargetKind.Person, key: isGroup ? `g:${record.threadId}` : `u:${rows[0].zalo_group_id}`,
        threadId: record.threadId, zaloUid: null, displayName,
      }],
    });
    const [target] = await listTargets(db, commandId);
    await markTarget(db, target.id, record.ok ? SendTargetStatus.Sent : SendTargetStatus.Failed, record.ok ? "" : (record.error ?? "gửi lỗi"));
    return commandId;
  } catch (error) {
    log.error("ghi nhật ký tin gửi từ web lỗi", describeError(error));
    return null;
  }
}

/**
 * Gửi lại các nơi Failed của một lệnh (quản trị, từ web): mỗi nơi mở lượt mới + job gửi ngay. KHÔNG báo lại người ra lệnh
 * (đánh dấu đã báo). Lệnh Zalo: kiểm lại người ra lệnh còn quyền + nơi nhận còn hợp lệ; lệnh web có tệp thì từ chối.
 */
export async function resendFailedTargets(deps: SendCommandDeps, _actor: SendCommandActor, commandId: number, now: Date = new Date()): Promise<SendActionResult> {
  const code = formatCommandCode(commandId);
  const reply = (text: string): SendActionResult => ({ handled: true, reply: text, commandId });
  const command = await findCommand(deps.db, commandId);
  if (!command) return reply(`Không tìm thấy lệnh ${code}.`);
  if (![SendCommandStatus.Done, SendCommandStatus.Sending].includes(command.status)) return reply(`Lệnh ${code} chưa xong — chỉ gửi lại được khi lệnh đã chạy xong.`);
  if (command.source === SendCommandSource.Web && WEB_FILE_MARK.test(command.body)) return reply(`Lệnh ${code} có tệp đính kèm — tệp không được giữ lại nên không gửi lại được.`);
  const failed = (await listTargets(deps.db, commandId)).filter((target) => target.status === SendTargetStatus.Failed);
  if (!failed.length) return reply(`Lệnh ${code} không có nơi nào lỗi.`);

  let scope = { selectedGroupIds: [] as number[] };
  if (command.source === SendCommandSource.Zalo) {
    const requester = await loadSendRequester(deps.db, command.requesterUid);
    if (!requester || !canIssueSendCommand(requester)) return reply(`Người ra lệnh ${code} không còn quyền gửi tin — không gửi lại.`);
    scope = await loadGroupScope(deps.db, requester.recipientId);
  }
  // Lệnh đã xong (đã báo kết quả): gửi lại không báo lại người ra lệnh, lệnh quay lại «đang gửi» tới khi xong. Lệnh còn đang gửi
  // (chưa báo) thì giữ nguyên — tin báo kết quả duy nhất sẽ gồm cả nơi gửi lại.
  if (command.status === SendCommandStatus.Done) {
    await markReported(deps.db, commandId, now);
    await setCommandStatusIf(deps.db, commandId, [SendCommandStatus.Done], SendCommandStatus.Sending);
  }
  let queued = 0;
  const skipped: string[] = [];
  for (const target of failed) {
    const refusal = command.source === SendCommandSource.Zalo
      ? await checkTargetStillAllowed(deps.db, target, scope, command.actionKind) : null;
    if (refusal) {
      skipped.push(`${target.displayName}: ${refusal}`);
      continue;
    }
    if (await queueTargetJob(deps, commandId, target.id, undefined)) queued += 1;
  }
  deps.wakeJobs?.();
  // Không xếp được nơi nào: chốt lại theo số nơi còn chờ (KHÔNG ép Done — lệnh đang gửi có thể còn nơi khác chưa xong)
  if (!queued) await finalizeIfDone(deps, commandId, now);
  return { ...reply([`Đã xếp gửi lại ${queued}/${failed.length} nơi của lệnh ${code}.`, ...skipped.map((line) => `Bỏ qua — ${line}`)].join("\n")), ok: queued > 0 };
}
