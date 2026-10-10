import { HEAVY_MODEL_ALIAS } from "../assistant/key-chain-client.js";
import { loadGroupMemberNames } from "../assistant/group-context.js";
import { audioMimeFor } from "../assistant/file-reader.js";
import type { AudioSource, ModelClient } from "../assistant/gemini-client.js";
import { systemTokensToday } from "../alerts/ai-review.js";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/pool.js";
import { DriveClient } from "../google/drive-client.js";
import { createLogger } from "../logger.js";
import { normalizeRecap } from "../reports/meeting-recap-input.js";
import { ReportExporter, type GeneratedReportFile } from "../reports/report-exporter.js";
import { quietDelayMs } from "../schedule/quiet-delay.js";
import type { WorkCalendar } from "../schedule/work-calendar.js";
import { vnLocalTime } from "../schedule/work-calendar.js";
import type { FileStorage } from "../storage/file-storage.js";
import { findThreadById } from "../sync/group-repository.js";
import { formatDue } from "../tasks/task-format.js";
import { findTask, shortTaskCode, type TaskParty, type TaskRow } from "../tasks/task-repository.js";
import {
  buildConfirmLine, composeRecapMessage, enqueueRecapDelivery, enqueueRecapNotice, proposeRecapTasks, resolveRecapAskName,
  resolveRecapAssigner, type ProposedRecapTask, type RecapDestination,
} from "./meeting-recap-delivery.js";
import { checkRecordingGuards, estimateRecapTokens, exceedsDailyCap } from "./meeting-recap-guard.js";
import { buildRecapInstruction, parseRecapJson, RecapJsonParseError } from "./meeting-recap-prompt.js";
import {
  addTokens, deferForTokenCap, markDone, markFailed, markSkipped, recordFailure, saveFiles, saveRecapJson, saveTaskIds,
  type ClaimedRecording,
} from "./meeting-recording-repository.js";

// Dòng recap (phase 4): claimNext (watcher) → processRecording → guard (Mật / cỡ / khóa AI) → ước token so trần ngày
// → gỡ băng MỘT LƯỢT ra JSON (hoặc dùng recap_json đã lưu nếu đang thử lại) → PDF → đề xuất việc → xếp tin + PDF vào
// hàng đợi → Done. Lỗi ở bước AI/PDF/việc/gửi: Queued thử lại tới `MEETING_RECAP_MAX_ATTEMPTS` lần rồi Failed + báo đích.

const log = createLogger("meeting-recap");

/** Hết số lần thử này mà vẫn lỗi thì dừng hẳn (Failed) — khớp `maxAttempts` truyền cho `claimNext` ở watcher. */
export const MEETING_RECAP_MAX_ATTEMPTS = 3;
/** M6: JSON recap hỏng thì chỉ thử lại MỘT lần (không theo trần chung 3 lần) — mỗi lần thử lại là một lượt nghe lại
 * TOÀN BỘ ghi âm (tốn token thật), một lỗi định dạng hệ thống thường lặp lại y hệt ở các lần sau. */
const RECAP_PARSE_MAX_ATTEMPTS = 2;

export interface MeetingRecapDeps {
  db: Db;
  config: AppConfig;
  storage: FileStorage;
  /** null = lịch làm việc cấu hình sai — không hoãn giờ yên lặng, gửi ngay còn hơn im lặng mãi. */
  calendar: WorkCalendar | null;
  /** Dựng MỖI LẦN gọi (không cache) — đổi Khóa AI trên web có hiệu lực ngay, giống mọi nơi khác dùng chuỗi khóa. */
  buildModel: () => Promise<ModelClient | null>;
  wakeJobs?: () => void;
}

const describeErr = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Tên khác `resolveDestination` của meeting-recording-matcher.ts (L10: hai hàm trùng tên, khác nghĩa) — hàm đó quyết
// định đích gửi LÚC QUÉT từ BotMeeting; hàm này đọc lại đích đã LƯU SẴN trên dòng `meeting_recording` lúc xử lý.
function destinationOfRecording(row: ClaimedRecording): RecapDestination | null {
  if (row.targetThreadId) return { threadId: row.targetThreadId };
  if (row.requesterUid) return { zaloUid: row.requesterUid };
  return null;
}

/** M7: mốc tính hạn tương đối trong recap — giờ HỌP, lùi về `driveCreatedAt` (lúc Drive ghi nhận tệp) khi cuộc họp cũ
 * không có `meeting_start` — KHÔNG BAO GIỜ dùng lúc xử lý (`now`), tránh lệch ngày khi tệp tải trễ / bị hoãn trần token. Hàm thuần. */
export function dueAnchorFor(row: Pick<ClaimedRecording, "meetingStart" | "driveCreatedAt">): Date {
  return row.meetingStart ?? row.driveCreatedAt;
}

/** «dd/mm/yyyy» theo lịch (không theo lời AI nói trong ghi âm — máy chủ ghi đè, chốt phase-04). */
function formatMeetingDate(start: Date | null): string {
  if (!start) return "";
  const [year, month, day] = vnLocalTime(start).date.split("-");
  return `${day}/${month}/${year}`;
}

/** «~45 phút» / «~1 giờ 30 phút» từ giờ bắt đầu/kết thúc theo lịch. */
function formatMeetingDuration(start: Date | null, end: Date | null): string {
  if (!start || !end) return "";
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  if (minutes < 60) return `~${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `~${hours} giờ ${rest} phút` : `~${hours} giờ`;
}

/** Thử lại đã có `task_ids` (tạo việc xong rồi mới lỗi ở bước sau) → đọc lại việc đã có, KHÔNG tạo đôi. */
async function loadOrProposeTasks(deps: MeetingRecapDeps, row: ClaimedRecording, recap: ReturnType<typeof normalizeRecap>, assigner: TaskParty, now: Date): Promise<ProposedRecapTask[]> {
  if (row.taskIds?.length) {
    const existing = await Promise.all((row.taskIds as number[]).map((id) => findTask(deps.db, id)));
    return existing.filter((task): task is TaskRow => Boolean(task)).map((task) => ({
      row: task, line: { code: shortTaskCode(task), owner: task.assignee?.name || "(chưa rõ)", title: task.title, due: formatDue(task.due_at, task.due_has_time, now) },
    }));
  }
  const proposed = await proposeRecapTasks({ db: deps.db, wakeJobs: deps.wakeJobs }, recap.tasks, {
    // M7: hạn «mai» / «thứ 6» nói TRONG họp phải tính từ giờ HỌP (driveCreatedAt khi cuộc họp cũ không có mốc bắt đầu),
    // không tính từ lúc xử lý (tệp có thể tải / bị hoãn trần token tới cả ngày sau mới gỡ băng)
    recordingId: row.id, groupId: row.targetThreadId, sourceThreadId: row.targetThreadId, assigner, now,
    dueAnchor: dueAnchorFor(row),
  });
  if (proposed.length) await saveTaskIds(deps.db, row.id, proposed.map((item) => item.row.id));
  return proposed;
}

/** Thử lại đã có `files` (PDF xuất rồi mới lỗi ở bước sau) → dùng lại, không xuất đôi tệp vào kho. */
async function loadOrExportPdf(deps: MeetingRecapDeps, row: ClaimedRecording, recap: ReturnType<typeof normalizeRecap>, now: Date): Promise<GeneratedReportFile> {
  const existing = (row.files as GeneratedReportFile[] | null)?.[0];
  if (existing?.storageKey) return existing;
  const exporter = new ReportExporter(deps.storage, () => deps.config.google);
  const exported = await exporter.exportRecapPdf(recap, now);
  if (!exported.file) throw new Error("Không xuất được PDF recap");
  await saveFiles(deps.db, row.id, [exported.file]);
  return exported.file;
}

async function notifyGuardFailure(deps: MeetingRecapDeps, row: ClaimedRecording, destination: RecapDestination | null, notice: string | null, notifyRequesterOnly: boolean, tag: string, now: Date): Promise<void> {
  if (!notice) {
    // Nhóm Mật nhưng cuộc họp cũ không có requester_uid — không biết báo ai, chỉ ghi log (chốt phase-04).
    if (notifyRequesterOnly) log.info(`bỏ qua recap #${row.id} «${row.fileName}» (nhóm Mật, cuộc họp cũ không có người đặt để báo riêng)`);
    return;
  }
  const target = notifyRequesterOnly ? (row.requesterUid ? { zaloUid: row.requesterUid } : null) : destination;
  // L7: tin báo cũng hoãn qua giờ yên lặng như tin recap thành công, không nhắn đêm
  if (target) await enqueueRecapNotice({ db: deps.db, wakeJobs: deps.wakeJobs }, row.id, target, notice, tag, quietDelayMs(deps.calendar, now));
}

async function notifyFailure(deps: MeetingRecapDeps, row: ClaimedRecording, logError: string, now: Date): Promise<void> {
  const destination = destinationOfRecording(row);
  if (!destination) return;
  // L3: KHÔNG chép lỗi nội bộ (Google Drive / Gemini) thô ra Zalo — câu cố định cho người dùng, chi tiết thật chỉ ở log + cột `error`
  const text = `Không recap tự động được ghi âm «${row.fileName}» — gửi tệp vào nhóm rồi «bot recap cuộc họp», hoặc gửi link Drive.`;
  await enqueueRecapNotice({ db: deps.db, wakeJobs: deps.wakeJobs }, row.id, destination, text, "failed", quietDelayMs(deps.calendar, now)).catch((sendError) =>
    log.error(`báo lỗi recap #${row.id} thất bại (lỗi gốc: ${logError})`, describeErr(sendError)));
}

async function run(deps: MeetingRecapDeps, row: ClaimedRecording, now: Date): Promise<void> {
  const group = row.targetThreadId ? await findThreadById(deps.db, row.targetThreadId) : null;
  const destination = destinationOfRecording(row);
  // M5: KHÔNG nuốt lỗi thật ở đây — DB chập / AiKeyStore lỗi phải NÉM lên để processRecording ghi Queued thử lại /
  // Failed theo số lần, chứ không bị coi nhầm là «chưa có khóa AI» rồi Skipped vĩnh viễn. null (không ném) mới đúng
  // là «chưa cấu hình khóa Gemini».
  const model = await deps.buildModel();
  const hasAudioModel = Boolean(model && typeof model.readAudioSource === "function");

  const guardFailure = checkRecordingGuards(row, {
    isConfidentialGroup: Boolean(group?.is_confidential), maxBytes: deps.config.meetingRecap.maxBytes, hasAudioModel,
  });
  if (guardFailure) {
    await markSkipped(deps.db, row.id, guardFailure.note, now);
    await notifyGuardFailure(deps, row, destination, guardFailure.notice, guardFailure.notifyRequesterOnly, guardFailure.reason, now);
    return;
  }
  if (!destination) {
    // Không nên xảy ra (phase 3 chỉ Queued khi đã rõ đích) — vẫn chặn ở đây để không mất ghi âm trong trạng thái lỡ dở.
    await markSkipped(deps.db, row.id, "không rõ nơi gửi", now);
    return;
  }

  const durationMinutes = row.meetingStart && row.meetingEnd ? (row.meetingEnd.getTime() - row.meetingStart.getTime()) / 60_000 : 0;
  if (!row.recapJson) {
    // H1: ước LỚN HƠN giữa thời lượng lịch và cỡ tệp thật — họp đặt ngắn nhưng ghi âm dài hơn nhiều không còn bị ước thiếu
    const estimate = estimateRecapTokens(durationMinutes, row.sizeBytes);
    const dailyCap = deps.config.assistant.dailyTokenCap;
    if (exceedsDailyCap(estimate, 0, dailyCap)) {
      // M2: ước MỘT MÌNH đã vượt cả trần ngày — hoãn sang hôm sau cũng không bao giờ lọt qua được, dừng hẳn + báo rõ
      // thay vì Queued mãi mãi không ai biết
      await markFailed(deps.db, row.id, "ước token nghe vượt cả trần AI của một ngày", now);
      await notifyFailure(deps, row, "ghi âm quá dài/nặng — ước tính vượt trần token AI của cả ngày", now);
      return;
    }
    const usedToday = await systemTokensToday(deps.db, now);
    if (exceedsDailyCap(estimate, usedToday, dailyCap)) {
      // Hoãn tới đầu ngày mai giờ VN (M2) — retry_after chặn claimNext giành lại dòng này mỗi 5 phút
      const retryAfter = new Date(vnLocalTime(now).dayStartMs + 24 * 60 * 60_000);
      await deferForTokenCap(deps.db, row.id, "chờ trần token ngày mai", retryAfter);
      return;
    }
  }

  let recapJson = row.recapJson;
  if (!recapJson) {
    const memberNames = row.targetThreadId ? await loadGroupMemberNames(deps.db, row.targetThreadId) : [];
    const instruction = buildRecapInstruction(memberNames);
    const drive = new DriveClient(() => deps.config.google, deps.config.meetingRecap.folderId);
    const source: AudioSource = {
      // H2: Drive hay trả `application/octet-stream` cho mp3 — audioMimeFor đoán lại theo đuôi tên tệp, Gemini từ
      // chối thẳng octet-stream (3 lần thử, mỗi lần tải lại cả tệp, rồi Failed oan)
      mime: audioMimeFor(row.mime, row.fileName)?.mime ?? "audio/mpeg", size: row.sizeBytes, displayName: row.fileName,
      open: () => drive.openDownload(row.driveFileId).then((download) => download.body),
    };
    const startedAt = Date.now();
    const result = await model!.readAudioSource!(source, instruction, HEAVY_MODEL_ALIAS);
    // M6: cộng token NGAY sau lượt nghe — parse JSON hỏng ở dưới vẫn không làm mất phần đã tính vào trần ngày, và thử
    // lại (nếu còn lượt) không phải "nghe free" vì tiền AI thật đã trả rồi
    await addTokens(deps.db, row.id, { input: result.inputTokens, output: result.outputTokens });
    // H1: ghi vào system_ai_usage (khuôn task-proposals.ts) — trước đây chỉ cộng vào meeting_recording, trần token
    // ngày (systemTokensToday) không thấy phần đã tiêu cho recap, recap thứ 2/3 trong ngày vẫn lọt qua kiểm trần
    await deps.db.query(
      "INSERT INTO system_ai_usage (purpose, model, item_count, input_tokens, output_tokens, duration_ms) VALUES ('meeting-recap', ?, ?, ?, ?, ?)",
      [String((model as { lastModel?: string }).lastModel ?? "").slice(0, 80), 1, result.inputTokens, result.outputTokens, Date.now() - startedAt],
    );
    recapJson = parseRecapJson(result.text);
    await saveRecapJson(deps.db, row.id, recapJson);
  }

  const recap = normalizeRecap({
    ...recapJson,
    title: row.meetingTitle || String(recapJson.title ?? ""),
    meeting_date: formatMeetingDate(row.meetingStart),
    duration: formatMeetingDuration(row.meetingStart, row.meetingEnd),
    format: "Google Meet",
    source: row.fileName,
  }, now, "meeting");

  const file = await loadOrExportPdf(deps, row, recap, now);
  const assigner = await resolveRecapAssigner(deps.db, row.requesterUid);
  const proposed = await loadOrProposeTasks(deps, row, recap, assigner, now);

  const { askName, mentionUids } = await resolveRecapAskName(deps.db, row.targetThreadId, row.requesterUid);
  const text = composeRecapMessage({
    title: recap.title, meetingDate: recap.meetingDate, duration: recap.duration, fileName: row.fileName, tldr: recap.tldr,
    tasks: proposed.map((item) => item.line), confirmLine: proposed.length ? buildConfirmLine(proposed[0].line.code, askName) : null,
  });
  await enqueueRecapDelivery({ db: deps.db, wakeJobs: deps.wakeJobs }, row.id, destination, text, mentionUids, file, quietDelayMs(deps.calendar, now));
  await markDone(deps.db, row.id, now);
}

/** Điểm vào duy nhất — không bao giờ ném: lỗi thật được ghi lại trên dòng (Queued thử lại / Failed + báo đích). */
export async function processRecording(deps: MeetingRecapDeps, row: ClaimedRecording, now: Date): Promise<void> {
  try {
    await run(deps, row, now);
  } catch (error) {
    const message = describeErr(error);
    // M6: JSON recap hỏng có trần lần thử RIÊNG, thấp hơn trần chung — mỗi lần thử lại là một lượt nghe lại tốn token thật
    const maxAttempts = error instanceof RecapJsonParseError ? RECAP_PARSE_MAX_ATTEMPTS : MEETING_RECAP_MAX_ATTEMPTS;
    log.warn(`xử lý ghi âm #${row.id} «${row.fileName}» lỗi (lần ${row.attempts}/${maxAttempts}): ${message}`);
    const { failed } = await recordFailure(deps.db, row.id, row.attempts, maxAttempts, message, now);
    if (failed) await notifyFailure(deps, row, message, now);
  }
}
