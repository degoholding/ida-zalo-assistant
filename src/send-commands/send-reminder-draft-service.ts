import { REPEAT_MODES, parseVnTime } from "../assistant/group-action-tools.js";
import { SendActionKind, SendCommandSource } from "../constants.js";
import type { SendCommandDeps } from "./send-command-deps.js";
import { expireRequesterDrafts } from "./send-command-lifecycle-queries.js";
import { CONFIRM_TTL_MS, MAX_REMINDER_AHEAD_DAYS, MAX_REMINDER_TITLE_CHARS, MIN_REMINDER_LEAD_MS } from "./send-command-limits.js";
import { insertDraft } from "./send-command-repository.js";
import type { ReminderRepeat } from "./send-command-types.js";
import { precheckGroupAction, refuse, resolveGroupActionTargets, type GroupActionDraftInput } from "./send-group-action-draft-common.js";
import { formatReminderPreview } from "./send-reminder-preview.js";
import type { CreateDraftResult } from "./send-command-draft-service.js";

// Dựng NHÁP nhắc hẹn nhóm từ tin riêng (công cụ AI propose_group_reminder): kiểm quyền + trần → nhóm đích (CHỈ nhóm) → tiêu đề
// → giờ nhắc → ghi nháp (action_kind = 2) → bản xem trước. Dùng chung nháp / «đồng ý» / báo kết quả với lệnh gửi tin.

const DAY_MS = 86_400_000;

export interface CreateReminderDraftInput extends GroupActionDraftInput {
  groupNames: string[];
  /** Tiêu đề nhắc — mô hình được tóm gọn, nhưng ≤ 200 ký tự và hiện nguyên trong bản xem trước */
  title: string;
  /** ISO 8601 (có +07:00; thiếu múi giờ thì hiểu là giờ Việt Nam) */
  startTime: string;
  /** none | daily | weekly | monthly — bỏ trống = không lặp */
  repeat: string;
}

/** Cảnh báo (vẫn cho tạo) khi giờ nhắc rơi vào ngày nghỉ / giờ yên lặng — Zalo vẫn nhắc đúng giờ. */
function reminderOffHoursNote(deps: SendCommandDeps, at: Date): string {
  if (!deps.calendar.isWorkingDay(at)) return "Giờ nhắc rơi vào ngày nghỉ.";
  return deps.calendar.isQuietTime(at) ? "Giờ nhắc rơi vào giờ yên lặng." : "";
}

/** Giờ nhắc + kiểu lặp → giá trị hợp lệ, hoặc câu lỗi cho người dùng. Cũng là mức kiểm lại ở các bước sau (xác nhận / giao). */
export function planReminder(startTimeText: string, repeatText: string, now: Date): { at: Date; repeat: ReminderRepeat } | { error: string } {
  const parsedMs = parseVnTime(startTimeText);
  // Bản xem trước chỉ hiện giờ:phút — cắt giây / mili-giây để giờ Zalo nhận ĐÚNG giờ người dùng thấy (và khớp khi bỏ trùng lúc thử lại)
  const startMs = parsedMs === null ? null : Math.floor(parsedMs / 60_000) * 60_000;
  if (startMs === null) return { error: "Em chưa hiểu giờ nhắc — anh/chị ghi cả ngày và giờ, ví dụ «8h sáng mai»." };
  if (startMs < now.getTime() + MIN_REMINDER_LEAD_MS) return { error: "Giờ nhắc đã qua hoặc quá sát — anh/chị chọn giờ muộn hơn." };
  if (startMs > now.getTime() + MAX_REMINDER_AHEAD_DAYS * DAY_MS) return { error: `Chỉ đặt nhắc hẹn trong ${MAX_REMINDER_AHEAD_DAYS} ngày tới.` };
  const key = repeatText.trim().toLowerCase() || "none";
  // Object.hasOwn: «constructor» / «toString»… không được lọt qua thành mã lặp
  const repeat = Object.hasOwn(REPEAT_MODES, key) ? REPEAT_MODES[key] : undefined;
  if (repeat === undefined) return { error: "Kiểu lặp chỉ có: không lặp, hằng ngày, hằng tuần, hằng tháng." };
  return { at: new Date(startMs), repeat };
}

export async function createReminderDraft(deps: SendCommandDeps, input: CreateReminderDraftInput, now: Date = new Date()): Promise<CreateDraftResult> {
  const { requester } = input;
  const pre = await precheckGroupAction(deps, SendActionKind.Reminder, requester, input.question, input.groupNames, now);
  if ("refusal" in pre) return pre.refusal;
  const title = input.title.normalize("NFC").trim().replace(/\s+\n/g, "\n");
  if (!title) return refuse("Anh/chị cho em biết nhắc việc gì — nội dung nhắc đang trống.");
  if (title.length > MAX_REMINDER_TITLE_CHARS) return refuse(`Nội dung nhắc dài ${title.length} ký tự — tối đa ${MAX_REMINDER_TITLE_CHARS}. Anh/chị rút gọn giúp em.`);
  const plan = planReminder(input.startTime, input.repeat, now);
  if ("error" in plan) return refuse(plan.error);

  const resolved = await resolveGroupActionTargets(deps, SendActionKind.Reminder, requester, pre.names);
  if ("refusal" in resolved) return resolved.refusal;
  const { targets } = resolved;

  const note = reminderOffHoursNote(deps, plan.at);
  // Mỗi người MỘT nháp sống: nháp cũ (gửi tin hay nhắc hẹn) hết hiệu lực để «đồng ý» không trỏ nhầm
  await expireRequesterDrafts(deps.db, requester.uid);
  const commandId = await insertDraft(deps.db, {
    source: SendCommandSource.Zalo, requesterContactId: input.requesterContactId ?? null, requesterUid: requester.uid,
    requesterName: requester.name, botAccountId: input.botAccountId ?? null, sourceThreadId: input.sourceThreadId,
    sourceMessageId: input.sourceMessageId ?? null, body: title, actionKind: SendActionKind.Reminder, reminderAt: plan.at,
    reminderRepeat: plan.repeat, offHoursNote: note, confirmExpiresAt: new Date(now.getTime() + CONFIRM_TTL_MS),
    targets: targets.map((candidate) => candidate.target),
  });
  const reply = formatReminderPreview({
    id: commandId, title, reminderAt: plan.at, repeat: plan.repeat, offHoursNote: note,
    targets: targets.map((candidate) => ({ displayName: candidate.target.displayName, secret: candidate.secret })),
  });
  return { reply, commandId };
}
