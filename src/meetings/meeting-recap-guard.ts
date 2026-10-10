// Điều kiện trước khi gỡ băng (phase 4, recap họp tự động): nhóm Mật / cỡ tệp / có khóa AI nghe được không, rồi ước
// token so trần ngày. THUẦN — nhận dữ liệu đã tải sẵn, không gọi mạng / CSDL; `meeting-recap-pipeline.ts` mới là nơi
// gọi DB / Drive / AI thật và quyết định hành động theo kết quả các hàm này.

const MB = 1024 * 1024;

export interface GuardInput {
  fileName: string;
  meetingTitle: string | null;
  sizeBytes: number;
  requesterUid: string | null;
}

export interface GuardConfig {
  /** Nhóm đích (nếu gửi vào nhóm) đang đặt Mật. */
  isConfidentialGroup: boolean;
  maxBytes: number;
  /** Có khóa AI (Gemini) nghe được ghi âm dài không — đã build model + kiểm `readAudioSource`. */
  hasAudioModel: boolean;
}

export type GuardFailureReason = "confidential" | "too_large" | "no_ai_key";

export interface GuardFailure {
  reason: GuardFailureReason;
  /** Ghi vào cột `note` của dòng `meeting_recording` (Skipped). */
  note: string;
  /** Tin gửi ra Zalo — null = không gửi tin nào (cuộc họp cũ không có người đặt, chỉ ghi log). */
  notice: string | null;
  /** true = tin phải gửi RIÊNG người đặt họp (không gửi vào nhóm) — chỉ `confidential`. */
  notifyRequesterOnly: boolean;
}

const mbOf = (bytes: number) => Math.round(bytes / MB);

/** Kiểm theo đúng thứ tự chốt ở phase-04: Mật → cỡ tệp → có khóa nghe được không. null = qua hết, xử lý tiếp. */
export function checkRecordingGuards(row: GuardInput, config: GuardConfig): GuardFailure | null {
  if (config.isConfidentialGroup) {
    const notice = row.requesterUid
      ? `Có ghi âm «${row.fileName}» của cuộc họp «${row.meetingTitle ?? ""}» (nhóm đặt Mật) — bot không gửi ghi âm nhóm Mật cho AI nên không recap tự động. Recap tay hoặc bỏ Mật rồi gửi lại tệp.`
      : null;
    return { reason: "confidential", note: "nhóm Mật — không recap tự động", notice, notifyRequesterOnly: true };
  }
  if (row.sizeBytes > config.maxBytes) {
    const notice = `Ghi âm ${mbOf(row.sizeBytes)} MB, quá mức ${mbOf(config.maxBytes)} MB — cắt nhỏ hoặc nâng trần ở Cài đặt.`;
    return { reason: "too_large", note: `ghi âm ${mbOf(row.sizeBytes)} MB, quá mức ${mbOf(config.maxBytes)} MB`, notice, notifyRequesterOnly: false };
  }
  if (!config.hasAudioModel) {
    return { reason: "no_ai_key", note: "chưa có khóa Gemini nghe ghi âm dài", notice: "Chưa có khóa Gemini nghe ghi âm dài — recap tay hoặc thêm khóa ở Cài đặt.", notifyRequesterOnly: false };
  }
  return null;
}

const TOKENS_PER_AUDIO_SECOND = 32; // chốt phase-04: ~32 token / giây âm thanh
const MIN_DURATION_MINUTES = 30;
const SAFETY_FACTOR = 1.5;
const FIXED_OVERHEAD_TOKENS = 20_000;
/** Bitrate THẤP coi là nghe được (ước AN TOÀN — tệp nén cao hơn thì giây thật còn ít hơn số này tính ra, không bao giờ ước thiếu). */
const CONSERVATIVE_BYTES_PER_SECOND = 16 * 1024;

const tokensForMinutes = (minutes: number): number =>
  Math.round(minutes * 60 * TOKENS_PER_AUDIO_SECOND * SAFETY_FACTOR) + FIXED_OVERHEAD_TOKENS;

/**
 * Ước token lượt nghe — LỚN HƠN giữa (1) thời lượng họp theo LỊCH (tối thiểu 30 phút) và (2) thời lượng suy ra từ CỠ
 * TỆP ở bitrate thấp 16 KB/s (H1 review 10/10/2026: họp đặt 30 phút nhưng ghi âm thật dài hơn nhiều — vd 150 MB ghi âm
 * ~2,5 giờ — ước theo lịch bị thấp 3–5 lần). `sizeBytes` bỏ trống / 0 = chỉ xét thời lượng lịch. Hàm thuần.
 */
export function estimateRecapTokens(meetingDurationMinutes: number, sizeBytes = 0): number {
  const byDuration = tokensForMinutes(Math.max(MIN_DURATION_MINUTES, meetingDurationMinutes));
  if (sizeBytes <= 0) return byDuration;
  const bySize = tokensForMinutes(sizeBytes / CONSERVATIVE_BYTES_PER_SECOND / 60);
  return Math.max(byDuration, bySize);
}

/** Ước token cộng phần đã dùng hôm nay có vượt trần ngày không. `dailyCap <= 0` = không giới hạn. Hàm thuần. */
export function exceedsDailyCap(estimateTokens: number, usedTodayTokens: number, dailyCap: number): boolean {
  return dailyCap > 0 && usedTodayTokens + estimateTokens > dailyCap;
}
