import { SendActionKind, SendCommandSource, SendCommandStatus } from "../constants.js";
import type { SendActionResult, SendCommandActor, SendCommandDeps } from "./send-command-deps.js";
import {
  countTargetsByCommand, expirePendingJobs, findLatestLiveDraft, setCommandStatusIf,
} from "./send-command-lifecycle-queries.js";
import { MAX_CONFIRMED_PER_HOUR, MIN_REMINDER_LEAD_MS } from "./send-command-limits.js";
import { canIssueSendCommand } from "./send-command-permissions.js";
import { describeCommandStatus, formatCommandCode, formatRequesterList, formatSendTime } from "./send-command-preview.js";
import { queueTargetJob } from "./send-command-queueing.js";
import {
  cancelCommand as cancelCommandRow, claimConfirm, countRecent, findCommand, listRecentByRequester, listScheduledByRequester, listTargets,
} from "./send-command-repository.js";
import type { SendCommandRow, SendRequester } from "./send-command-types.js";
import { checkTargetStillAllowed, loadGroupScope } from "./send-target-resolver.js";

// Thao tác trên lệnh gửi đã có (phase 9): xác nhận → xếp job, hủy, danh sách. Một service cho lệnh gõ, công cụ AI và web.
// Xác nhận CHỈ đi qua đây (lệnh gõ «đồng ý»), mô hình AI không có công cụ xác nhận.

const NOT_FOUND = (id: number) => `Em không tìm thấy lệnh ${formatCommandCode(id)} của anh/chị.`;

/** Lệnh của chính người này trên Zalo (không lộ lệnh của người khác). */
async function findOwnCommand(deps: SendCommandDeps, uid: string, id: number): Promise<SendCommandRow | null> {
  const command = await findCommand(deps.db, id);
  return command && command.source === SendCommandSource.Zalo && command.requesterUid === uid ? command : null;
}

function explainNotConfirmable(command: SendCommandRow): string {
  const code = formatCommandCode(command.id);
  // Nháp quá hạn mà việc nền chưa kịp đánh Expired vẫn là «quá hạn»
  if (command.status === SendCommandStatus.Expired || command.status === SendCommandStatus.Draft) return `Lệnh ${code} đã quá hạn xác nhận — anh/chị nhắn lại lệnh gửi giúp em.`;
  if (command.status === SendCommandStatus.Cancelled) return `Lệnh ${code} đã hủy.`;
  return `Lệnh ${code} đã được xác nhận rồi (${describeCommandStatus(command.status)}).`;
}

/** «đồng ý» (trần = nháp mới nhất) hoặc «đồng ý G-12». Kiểm lại quyền + từng nơi nhận trước khi xếp job. */
export async function confirmDraft(deps: SendCommandDeps, requester: SendRequester, which: number | "latest", now: Date = new Date()): Promise<SendActionResult> {
  const command = which === "latest" ? await findLatestLiveDraft(deps.db, requester.uid, now) : await findOwnCommand(deps, requester.uid, which);
  if (!command) return which === "latest" ? { handled: false, reply: "" } : { handled: true, reply: NOT_FOUND(which as number) };
  const reply = (text: string): SendActionResult => ({ handled: true, reply: text, commandId: command.id });
  if (command.status !== SendCommandStatus.Draft || !command.confirmExpiresAt || command.confirmExpiresAt <= now) return reply(explainNotConfirmable(command));
  if (!canIssueSendCommand(requester)) return reply("Anh/chị không còn quyền ra lệnh gửi tin — em không gửi.");
  if (await countRecent(deps.db, requester.uid, "confirmed", new Date(now.getTime() - 3_600_000)) >= MAX_CONFIRMED_PER_HOUR) {
    return reply("Anh/chị đã xác nhận khá nhiều lệnh gửi trong một giờ qua — thử lại sau giúp em nhé.");
  }
  if (command.scheduledAt && command.scheduledAt.getTime() <= now.getTime()) {
    await setCommandStatusIf(deps.db, command.id, [SendCommandStatus.Draft], SendCommandStatus.Expired);
    return reply(`Giờ hẹn của lệnh ${formatCommandCode(command.id)} đã qua — anh/chị nhắn lại lệnh gửi giúp em.`);
  }
  const isReminder = command.actionKind === SendActionKind.Reminder;
  // Nhắc hẹn: giờ nhắc phải còn ở tương lai lúc tạo (Zalo không nhận nhắc hẹn đã qua)
  if (isReminder && (!command.reminderAt || command.reminderAt.getTime() < now.getTime() + MIN_REMINDER_LEAD_MS)) {
    await setCommandStatusIf(deps.db, command.id, [SendCommandStatus.Draft], SendCommandStatus.Expired);
    return reply(`Giờ nhắc của lệnh ${formatCommandCode(command.id)} đã qua hoặc quá sát — anh/chị nhắn lại lệnh nhắc hẹn giúp em.`);
  }
  // Vai trò / loại nhóm / phạm vi có thể đã đổi từ lúc dựng nháp
  const scope = await loadGroupScope(deps.db, requester.recipientId);
  const targets = await listTargets(deps.db, command.id);
  const problems: string[] = [];
  for (const target of targets) {
    const refusal = await checkTargetStillAllowed(deps.db, target, scope, isReminder);
    if (refusal) problems.push(`${target.displayName}: ${refusal}`);
  }
  if (problems.length) return reply(`Em không ${isReminder ? "tạo" : "gửi"} lệnh ${formatCommandCode(command.id)} vì:\n${problems.map((line) => `- ${line}`).join("\n")}\nAnh/chị nhắn lại lệnh giúp em.`);

  const scheduled = Boolean(command.scheduledAt);
  if (!(await claimConfirm(deps.db, command.id, now, scheduled ? SendCommandStatus.Scheduled : SendCommandStatus.Sending))) {
    return reply(`Lệnh ${formatCommandCode(command.id)} đã được xác nhận hoặc hết hạn rồi ạ.`);
  }
  let queued = 0;
  for (const target of targets) {
    if (await queueTargetJob(deps, command.id, target.id, command.scheduledAt ?? undefined)) queued += 1;
  }
  deps.wakeJobs?.();
  const code = formatCommandCode(command.id);
  if (!queued) return reply(`Lệnh ${code} không xếp được việc ${isReminder ? "tạo nhắc hẹn" : "gửi"} nào — xem lỗi ở màn Gửi tin.`);
  if (isReminder) return { ...reply(`Đã nhận lệnh ${code}: tạo nhắc hẹn cho ${queued} nhóm. Tạo xong em báo kết quả.`), ok: true };
  const when = command.scheduledAt ? `sẽ gửi lúc ${formatSendTime(command.scheduledAt)}` : "đang gửi";
  return { ...reply(`Đã nhận lệnh ${code}: ${queued} nơi, ${when}. Gửi xong em báo kết quả.${scheduled ? ` Muốn hủy nhắn «hủy ${code}».` : ""}`), ok: true };
}

/**
 * Hủy lệnh Nháp / đang hẹn. Zalo: chỉ lệnh của mình; web: quyền kiểm ở API (nơi gọi). Nơi chưa gửi → Cancelled, job còn
 * chờ → bỏ. Lệnh đang gửi / đã xong thì không hủy được.
 */
export async function cancelSendCommand(deps: SendCommandDeps, actor: SendCommandActor, id: number, now: Date = new Date()): Promise<SendActionResult> {
  const command = actor.via === "zalo" ? await findOwnCommand(deps, actor.uid, id) : await findCommand(deps.db, id);
  if (!command) return { handled: true, reply: NOT_FOUND(id) };
  const code = formatCommandCode(id);
  const reply = (text: string): SendActionResult => ({ handled: true, reply: text, commandId: id });
  if (command.status === SendCommandStatus.Cancelled) return reply(`Lệnh ${code} đã hủy từ trước.`);
  if (![SendCommandStatus.Draft, SendCommandStatus.Scheduled].includes(command.status)) {
    return reply(`Lệnh ${code} ${describeCommandStatus(command.status)} — không hủy được nữa.`);
  }
  const targets = await listTargets(deps.db, id);
  if (!(await cancelCommandRow(deps.db, id, actor.name, now))) return reply(`Lệnh ${code} vừa chuyển sang đang gửi — không hủy được nữa.`);
  await expirePendingJobs(deps.db, targets.flatMap((target) => (target.jobId ? [target.jobId] : [])), "lệnh bị hủy");
  return { ...reply(`Đã hủy lệnh ${code}.`), ok: true };
}

/** «hủy» trần: hủy nháp còn sống mới nhất; không có nháp thì `handled` = false để nơi gọi thử việc khác. */
export async function cancelLatestDraft(deps: SendCommandDeps, requesterUid: string, requesterName: string, now: Date = new Date()): Promise<SendActionResult> {
  const draft = await findLatestLiveDraft(deps.db, requesterUid, now);
  if (!draft) return { handled: false, reply: "" };
  return cancelSendCommand(deps, { via: "zalo", uid: requesterUid, name: requesterName }, draft.id, now);
}

/** «lệnh gửi»: lệnh đang hẹn + 5 lệnh gần nhất của chính người này. */
export async function listForRequester(deps: SendCommandDeps, requesterUid: string): Promise<string> {
  const [scheduled, recent] = await Promise.all([listScheduledByRequester(deps.db, requesterUid), listRecentByRequester(deps.db, requesterUid, 5)]);
  const counts = await countTargetsByCommand(deps.db, [...new Set([...scheduled, ...recent].map((command) => command.id))]);
  const item = (command: SendCommandRow) => ({ command, targetCount: counts.get(command.id) ?? 0 });
  const scheduledIds = new Set(scheduled.map((command) => command.id));
  return formatRequesterList(scheduled.map(item), recent.filter((command) => !scheduledIds.has(command.id)).map(item));
}
