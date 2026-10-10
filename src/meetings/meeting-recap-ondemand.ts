import { MeetingRecordingStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { DriveClient, isAudioFile, type DriveFileInfo } from "../google/drive-client.js";
import type { MeetingScheduler } from "../google/calendar-meetings.js";
import type { GeneratedReportFile } from "../reports/report-exporter.js";
import { LONGEST_MEETING_MS, MATCH_WINDOW_AFTER_END_MS, normalizeForMatch, pickMeetingForFile, toRecordingCandidate } from "./meeting-recording-matcher.js";
import { findByDriveFileId, insertDiscovered, requeueOndemand } from "./meeting-recording-repository.js";

// Recap ghi âm trong thư mục Drive THEO YÊU CẦU CHAT (phase 6, 10/10/2026) — «recap cuộc họp», «recap file hop-giao-
// ban» khi người hỏi KHÔNG gửi kèm ghi âm / link trong tin. Tái dùng bảng + việc nền xử lý của recap tự động (phase
// 3/4): tìm hoặc tạo đúng MỘT dòng `meeting_recording` cho tệp Drive, đích gửi = CUỘC ĐANG HỎI (nhóm hay tin riêng),
// rồi để `runMeetingRecapProcessing` (1 phút/lần, meeting-recording-watcher.ts) gỡ băng như bình thường — KHÔNG tự
// gọi AI ở đây. Công cụ AI (`recap_drive_recording`) + khai báo nằm ở src/assistant/drive-recap-tool.ts; file này
// KHÔNG phụ thuộc tầng assistant/ (tránh vòng import, và vì đây là nghiệp vụ, không phải khai báo công cụ).

/** Không nói tên tệp → chỉ xét ghi âm tải lên trong ngần này gần đây (rộng hơn cửa sổ quét tự động 48h — người hỏi có
 * thể chủ động nhắc tới ghi âm của vài hôm trước). */
const ONDEMAND_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
/** Nhiều ghi âm tên gần giống → chỉ đưa ngần này cho mô hình chọn, tránh tin quá dài. */
const MAX_CANDIDATES_SHOWN = 8;

export function ondemandCutoff(now: Date): Date {
  return new Date(now.getTime() - ONDEMAND_LOOKBACK_MS);
}

export type AudioPickResult =
  | { kind: "empty" }
  | { kind: "not-found"; query: string }
  | { kind: "ambiguous"; files: DriveFileInfo[] }
  | { kind: "single"; file: DriveFileInfo };

/** Tên tệp Drive hay nối chữ bằng gạch dưới / gạch ngang («giao-ban-k52.mp3») trong khi người hỏi gõ cách nhau bằng
 * khoảng trắng («giao ban k52») — đổi cả hai về cùng một dạng trước khi so khớp. Riêng cho việc CHỌN TỆP (không dùng
 * `normalizeForMatch` dùng chung với khớp TÊN CUỘC HỌP lịch ở matcher.ts, tránh ảnh hưởng hành vi phase 3/4). */
function normalizeFileQuery(text: string): string {
  return normalizeForMatch(text).replace(/[-_]+/g, " ");
}

/**
 * Chọn tệp ghi âm (THUẦN, test bảng được): không nói tên → tệp MỚI NHẤT; có tên → tên tệp chứa chữ đã gõ (bỏ dấu,
 * không phân biệt hoa thường, gạch dưới / gạch ngang coi như khoảng trắng) — một kết quả thì dùng luôn, nhiều kết quả
 * thì trả `ambiguous` để hỏi lại, không kết quả thì `not-found`; thư mục không có ghi âm nào (bất kể tên) → `empty`.
 */
export function pickAudioFile(files: DriveFileInfo[], nameQuery?: string): AudioPickResult {
  const sorted = [...files].sort((a, b) => Date.parse(b.createdTime) - Date.parse(a.createdTime));
  if (!sorted.length) return { kind: "empty" };
  const query = nameQuery?.trim();
  if (!query) return { kind: "single", file: sorted[0] };
  const normalizedQuery = normalizeFileQuery(query);
  const matches = sorted.filter((file) => normalizeFileQuery(file.name).includes(normalizedQuery));
  if (!matches.length) return { kind: "not-found", query };
  if (matches.length > 1) return { kind: "ambiguous", files: matches };
  return { kind: "single", file: matches[0] };
}

export interface OndemandDestination {
  /** null = tin riêng — đích gửi là chính người hỏi (`requesterUid`). */
  targetThreadId: number | null;
  requesterUid: string;
}

/** Đích gửi = CUỘC ĐANG HỎI (THUẦN): trong nhóm → nhóm đó; tin riêng → chính người hỏi. Người hỏi luôn là
 * `requesterUid` (kể cả trong nhóm) — để «ok hết» tag đúng người, giống cuộc họp bot tự tạo (phase 3). */
export function buildOndemandDestination(scopeGroupId: number | undefined, askerUid: string): OndemandDestination {
  return { targetThreadId: scopeGroupId ?? null, requesterUid: askerUid };
}

/** Tên cuộc họp suy từ tên tệp khi không khớp lịch nào — bỏ đuôi tệp, đổi gạch dưới / gạch ngang thành khoảng trắng. */
export function titleFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[_-]+/g, " ").trim();
  return base || fileName;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
/** «dd/mm HH:mm» giờ Việt Nam — bản rút gọn riêng cho tệp này (trùng công thức `formatVn` của assistant/tools.ts;
 * KHÔNG import chéo sang assistant/ để meetings/ không phụ thuộc ngược vào tầng công cụ AI). */
function formatVnShort(iso: string): string {
  const local = new Date(Date.parse(iso) + VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

export interface OndemandRecapOutcome {
  /** Những gì mô hình thấy — hoặc để trả lời ngay («reply»: trả ĐÚNG NGUYÊN VĂN), hoặc để hỏi lại («candidates»), hoặc lỗi. */
  response: Record<string, unknown>;
  /** Chỉ có khi TRẢ LẠI PDF đã có sẵn (dòng đã Done) — assistant-service.ts đẩy vào `reportFiles` để gửi kèm câu trả lời. */
  file?: GeneratedReportFile;
}

interface OndemandDeps {
  drive: DriveClient;
  /** null = chưa «Kết nối Google» (Lịch) — vẫn recap được, chỉ không khớp được tên / giờ cuộc họp thật, dùng tên tệp. */
  calendar: MeetingScheduler | null;
}

/** Khớp cuộc họp bot tạo (như phase 3) quanh giờ tải tệp lên — có thì dùng tên / giờ HỌP thật, không thì dùng tên tệp
 * + giờ Drive ghi nhận. Lỗi Calendar (mạng, hết hạn kết nối) KHÔNG được chặn yêu cầu recap chủ động của người dùng. */
async function resolveMeetingFields(
  calendar: MeetingScheduler | null, file: DriveFileInfo,
): Promise<{ eventId?: string; meetingTitle: string; meetingStart: Date; meetingEnd?: Date }> {
  const createdAtMs = Date.parse(file.createdTime);
  if (calendar?.connected) {
    try {
      const timeMin = new Date(createdAtMs - MATCH_WINDOW_AFTER_END_MS - LONGEST_MEETING_MS);
      const timeMax = new Date(createdAtMs);
      const meetings = (await calendar.listMeetingsBetween(timeMin, timeMax)).map(toRecordingCandidate);
      const { meeting } = pickMeetingForFile({ name: file.name, createdAtMs }, meetings);
      if (meeting) {
        return { eventId: meeting.id, meetingTitle: meeting.title, meetingStart: new Date(meeting.startTime), meetingEnd: new Date(meeting.endTime) };
      }
    } catch {
      // Bỏ qua — lùi về tên tệp bên dưới, không để lỗi Calendar chặn yêu cầu recap chủ động của người dùng
    }
  }
  return { meetingTitle: titleFromFileName(file.name), meetingStart: new Date(file.createdTime) };
}

/**
 * Điểm vào duy nhất của tính năng — gọi từ công cụ `recap_drive_recording` (assistant-service.ts đóng `deps` theo cấu
 * hình hiện hành + `destination` theo cuộc đang hỏi). KHÔNG ném lỗi hệ thống ra ngoài: Drive lỗi trả `{ error }` cho mô
 * hình, không làm hỏng lượt hỏi.
 */
export async function runOndemandRecap(
  db: Db, deps: OndemandDeps, args: Record<string, unknown>, destination: OndemandDestination, now: Date,
): Promise<OndemandRecapOutcome> {
  const fileId = typeof args.file_id === "string" ? args.file_id.trim() : "";
  const nameQuery = typeof args.name === "string" ? args.name.trim() : "";

  let file: DriveFileInfo;
  try {
    if (fileId) {
      file = await deps.drive.getFileMeta(fileId);
      if (!isAudioFile(file)) return { response: { error: `Tệp «${file.name}» không phải ghi âm.` } };
    } else {
      const files = (await deps.drive.listNewFiles(ondemandCutoff(now))).filter(isAudioFile);
      const pick = pickAudioFile(files, nameQuery || undefined);
      if (pick.kind === "empty") return { response: { error: "Thư mục ghi âm họp đang trống trong 7 ngày gần đây (hoặc chưa cấu hình thư mục)." } };
      if (pick.kind === "not-found") return { response: { error: `Không thấy ghi âm nào tên gần giống «${pick.query}» trong 7 ngày gần đây.` } };
      if (pick.kind === "ambiguous") {
        return {
          response: {
            need_user_choice: "Vài ghi âm tên gần giống — hỏi người dùng muốn recap tệp nào rồi gọi lại kèm file_id đã chọn",
            candidates: pick.files.slice(0, MAX_CANDIDATES_SHOWN).map((f) => ({
              file_id: f.id, name: f.name, uploaded_at: formatVnShort(f.createdTime), size_kb: Math.round(f.size / 1024),
            })),
          },
        };
      }
      file = pick.file;
    }
  } catch (error) {
    return { response: { error: error instanceof Error ? error.message : String(error) } };
  }

  const existing = await findByDriveFileId(db, file.id);
  if (existing?.status === MeetingRecordingStatus.Processing) {
    return { response: { status: "processing", reply: `Dạ ghi âm «${file.name}» đang được em xử lý, anh/chị chờ thêm chút ạ.` } };
  }
  if (existing?.status === MeetingRecordingStatus.Done) {
    const doneFiles = (existing.files as GeneratedReportFile[] | null) ?? [];
    if (doneFiles.length) {
      return {
        response: { status: "done", reply: `Dạ đây là recap cuộc họp «${existing.meetingTitle || file.name}» em gửi lại ạ.` },
        file: doneFiles[0],
      };
    }
    // Done mà không có tệp (không nên xảy ra) — rơi xuống nhánh requeue bên dưới như các trạng thái dở dang khác
  }

  const meetingFields = await resolveMeetingFields(deps.calendar, file);
  const targetThreadId = destination.targetThreadId ?? undefined;
  if (existing) {
    await requeueOndemand(db, existing.id, { targetThreadId, requesterUid: destination.requesterUid, ...meetingFields });
  } else {
    await insertDiscovered(db, {
      driveFileId: file.id, fileName: file.name, mime: file.mimeType, sizeBytes: file.size,
      driveCreatedAt: new Date(file.createdTime), status: MeetingRecordingStatus.Queued,
      targetThreadId, requesterUid: destination.requesterUid, ...meetingFields,
    });
  }
  return { response: { status: "queued", reply: `Dạ em đang nghe bản ghi «${file.name}», khoảng vài phút em gửi recap ạ.` } };
}
