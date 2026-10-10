import type { ModelClient } from "../assistant/gemini-client.js";
import type { AppConfig } from "../config.js";
import { MeetingRecordingStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { DriveClient, type DriveFileInfo } from "../google/drive-client.js";
import { hasDriveScope } from "../google/google-oauth.js";
import type { MeetingScheduler } from "../google/calendar-meetings.js";
import { createLogger, describeError } from "../logger.js";
import type { WorkCalendar } from "../schedule/work-calendar.js";
import type { FileStorage } from "../storage/file-storage.js";
import { isAudioFile, LONGEST_MEETING_MS, MATCH_WINDOW_AFTER_END_MS, pickMeetingForFile, resolveDestination, scanCutoff, toRecordingCandidate } from "./meeting-recording-matcher.js";
import { MEETING_RECAP_MAX_ATTEMPTS, processRecording } from "./meeting-recap-pipeline.js";
import { claimNext, existingDriveFileIds, insertDiscovered, releaseStale } from "./meeting-recording-repository.js";

// Việc nền «meeting-recordings» (5 phút, src/schedule/background-tasks.ts + src/background.ts): (1) quét thư mục Drive
// «Ghi âm họp», ghi mỗi tệp mới MỘT dòng vào `meeting_recording` — Queued (đã khớp cuộc họp + rõ nơi gửi), Unmatched
// (không khớp), hoặc Skipped (không phải ghi âm / không rõ nơi gửi); (2) giành + xử lý TỐI ĐA MỘT dòng Queued (phase 4,
// `meeting-recap-pipeline.ts`) — mỗi lượt một ghi âm, lượt sau xử lý tiếp dòng kế (không cần đợi tệp mới).
//
// Lỗi gọi Drive / Calendar lúc QUÉT (mạng, hết hạn kết nối, chưa bật API…) được NÉM THẲNG ra ngoài (không bắt ở đây) để
// bộ lập lịch (Scheduler.execute) ghi `schedule_run.last_error» — hiện ở thẻ trạng thái việc nền màn Cài đặt — ĐỒNG
// THỜI không ghi dòng nào cho lô tệp âm thanh đang xét, để lượt sau (kết nối lại) thử lại đúng những tệp đó. Lỗi lúc XỬ
// LÝ một dòng đã Queued thì KHÔNG ném — `processRecording` tự ghi lại trên dòng đó (Queued thử lại / Failed + báo đích).
// L5 (review 10/10/2026): xử lý dòng Queued TRƯỚC khi quét — Calendar/Drive lỗi kéo dài (ném ra ngoài) không còn chặn
// luôn các ghi âm ĐÃ Queued từ lượt trước tới lượt xử lý.

const log = createLogger("meeting-recordings");

/** Phụ thuộc của phần xử lý (phase 4) — tách khỏi deps quét (Drive/Calendar) vì watcher tự dựng `DriveClient` riêng. */
export interface MeetingRecapRunDeps {
  storage: FileStorage;
  calendar: WorkCalendar | null;
  buildModel: () => Promise<ModelClient | null>;
  wakeJobs?: () => void;
}

export interface RunMeetingRecordingsResult {
  /** Tệp mới (chưa có dòng) xét trong lượt này — 0 khi tắt tính năng / chưa cấu hình / không có tệp mới. */
  scanned: number;
  queued: number;
  unmatched: number;
  skipped: number;
  /** Dòng Processing kẹt quá 45 phút được trả về Queued ở ĐẦU lượt này. */
  released: number;
  /** Có giành + xử lý một dòng Queued ở CUỐI lượt này không (phase 4). */
  processed: boolean;
}

const DISABLED_RESULT: RunMeetingRecordingsResult = { scanned: 0, queued: 0, unmatched: 0, skipped: 0, released: 0, processed: false };

/** Hạ tầng xử lý (gỡ băng) sẵn sàng chưa — CHỈ cần thư mục + quyền Drive, ĐỘC LẬP với cờ bật QUÉT tự động
 * (`meeting_auto_recap_enabled`): recap theo yêu cầu chat (phase 6, meeting-recap-ondemand.ts) vẫn phải xử lý được dù
 * quản trị tắt quét tự động — chỉ phần SCAN mới cần cờ đó. */
function recapInfraReady(config: AppConfig): boolean {
  return Boolean(config.meetingRecap.folderId) && hasDriveScope(config.google.calendarAccount);
}

/**
 * Giành + xử lý TỐI ĐA MỘT dòng `Queued` — KHÔNG quét Drive. Việc nền riêng (1 phút/lần, nhanh hơn lượt quét 5 phút)
 * để ghi âm xếp hàng qua chat (phase 6) được gỡ băng sớm; `runMeetingRecordings` (5 phút) cũng gọi lại hàm này trước
 * khi quét — `claimNext` giành bằng UPDATE có điều kiện nên hai việc nền cùng gọi không xử lý trùng một dòng.
 */
export async function runMeetingRecapProcessing(
  db: Db, config: AppConfig, recap: MeetingRecapRunDeps, now: Date = new Date(),
): Promise<{ released: number; processed: boolean }> {
  if (!recapInfraReady(config)) return { released: 0, processed: false };

  const released = await releaseStale(db, now);
  if (released) log.info(`${released} ghi âm kẹt Processing quá 45 phút, đã trả về Queued`);

  const claimed = await claimNext(db, now, MEETING_RECAP_MAX_ATTEMPTS);
  if (claimed) {
    await processRecording({ db, config, storage: recap.storage, calendar: recap.calendar, buildModel: recap.buildModel, wakeJobs: recap.wakeJobs }, claimed, now)
      .catch((error) => log.error(`xử lý ghi âm #${claimed.id} lỗi (ngoài dự kiến, processRecording lẽ ra tự bắt)`, describeError(error)));
  }
  return { released, processed: Boolean(claimed) };
}

export async function runMeetingRecordings(
  db: Db, config: AppConfig, calendar: MeetingScheduler, recap: MeetingRecapRunDeps, now: Date = new Date(),
): Promise<RunMeetingRecordingsResult> {
  // Tắt QUÉT tự động / chưa cấu hình / chưa kết nối Google / chưa có quyền Drive → thoát sớm, không đụng DB (rollback
  // "tắt cài đặt → việc nền thoát sớm"). Phần XỬ LÝ (runMeetingRecapProcessing) có việc nền riêng, không phụ thuộc
  // `enabled` — recap theo yêu cầu chat vẫn chạy dù tắt quét tự động.
  if (!config.meetingRecap.enabled || !recapInfraReady(config)) return DISABLED_RESULT;
  if (!calendar.connected) return DISABLED_RESULT;

  // L5: giành + xử lý TỐI ĐA MỘT dòng Queued TRƯỚC khi quét Drive/Calendar — lượt quét bên dưới có thể ném lỗi (mạng,
  // hết hạn kết nối), không được để lỗi đó chặn luôn ghi âm ĐÃ Queued từ lượt trước.
  const { released, processed } = await runMeetingRecapProcessing(db, config, recap, now);

  const scan = await scanNewRecordings(db, config, calendar, now);
  return { ...scan, released, processed };
}

/** Quét Drive + khớp cuộc họp — không đụng dòng Queued cũ, chỉ ghi dòng cho tệp MỚI thấy lần này. */
async function scanNewRecordings(db: Db, config: AppConfig, calendar: MeetingScheduler, now: Date): Promise<Omit<RunMeetingRecordingsResult, "released" | "processed">> {
  const empty = { scanned: 0, queued: 0, unmatched: 0, skipped: 0 };
  const drive = new DriveClient(() => config.google, config.meetingRecap.folderId);
  const files = await drive.listNewFiles(scanCutoff(now));
  // size = 0 = Drive chưa ghi nhận xong dung lượng (upload còn dở) — bỏ qua, KHÔNG ghi dòng, lượt sau xét lại.
  const withSize = files.filter((file) => file.size > 0);
  if (!withSize.length) return empty;

  const known = await existingDriveFileIds(db, withSize.map((file) => file.id));
  const newFiles = withSize.filter((file) => !known.has(file.id));
  if (!newFiles.length) return empty;

  let queued = 0;
  let unmatched = 0;
  let skipped = 0;

  const nonAudio = newFiles.filter((file) => !isAudioFile(file));
  for (const file of nonAudio) {
    if (await insertRow(db, file, MeetingRecordingStatus.Skipped, { note: "không phải ghi âm" })) skipped += 1;
  }

  const audioFiles = newFiles.filter((file) => isAudioFile(file));
  if (audioFiles.length) {
    const createdTimes = audioFiles.map((file) => Date.parse(file.createdTime));
    const timeMin = new Date(Math.min(...createdTimes) - MATCH_WINDOW_AFTER_END_MS - LONGEST_MEETING_MS);
    const timeMax = new Date(Math.max(...createdTimes));
    // Lỗi ở đây KHÔNG được bắt — xem ghi chú đầu tệp: ném thẳng ra ngoài, không ghi dòng nào cho audioFiles.
    const meetings = (await calendar.listMeetingsBetween(timeMin, timeMax)).map(toRecordingCandidate);

    for (const file of audioFiles) {
      const createdAtMs = Date.parse(file.createdTime);
      const { meeting, candidates } = pickMeetingForFile({ name: file.name, createdAtMs }, meetings);
      if (!meeting) {
        if (await insertRow(db, file, MeetingRecordingStatus.Unmatched, { note: "không khớp cuộc họp nào trong cửa sổ 24 giờ" })) unmatched += 1;
        continue;
      }
      const destination = resolveDestination(meeting);
      const meetingFields = { eventId: meeting.id, meetingTitle: meeting.title, meetingStart: new Date(meeting.startTime), meetingEnd: new Date(meeting.endTime) };
      if (destination.kind === "unresolved") {
        if (await insertRow(db, file, MeetingRecordingStatus.Skipped, { ...meetingFields, note: "không rõ nơi gửi (cuộc họp riêng không có người đặt)" })) skipped += 1;
        continue;
      }
      const inserted = await insertRow(db, file, MeetingRecordingStatus.Queued, {
        ...meetingFields,
        targetThreadId: destination.kind === "group" ? destination.targetThreadId : undefined,
        requesterUid: destination.requesterUid,
      });
      if (inserted) {
        queued += 1;
        log.info(`ghi âm «${file.name}» khớp cuộc họp «${meeting.title}» (${candidates.length} ứng viên trong cửa sổ) → Queued`);
      }
    }
  }
  return { scanned: newFiles.length, queued, unmatched, skipped };
}

function insertRow(
  db: Db, file: DriveFileInfo, status: MeetingRecordingStatus,
  extra: { note?: string; eventId?: string; meetingTitle?: string; meetingStart?: Date; meetingEnd?: Date; targetThreadId?: number; requesterUid?: string },
): Promise<boolean> {
  return insertDiscovered(db, {
    driveFileId: file.id, fileName: file.name, mime: file.mimeType, sizeBytes: file.size,
    driveCreatedAt: new Date(file.createdTime), status, ...extra,
  });
}
