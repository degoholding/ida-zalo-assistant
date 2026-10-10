-- Phase 3 (10/10/2026, recap họp tự động từ Drive) — theo dõi thư mục «Ghi âm họp»: một dòng mỗi tệp Drive mới, chống
-- xử lý trùng bằng UNIQUE trên drive_file_id (INSERT IGNORE) + giành lượt xử lý bằng UPDATE có điều kiện trên status
-- (hai worker / khởi động lại không xử lý trùng một tệp). Phase 4 gỡ băng + recap + gửi, đọc / ghi tiếp trên CHÍNH dòng
-- này (recap_json, files, task_ids) để thử lại không tốn AI lần hai. Plan: plans/261010-0945-meeting-auto-recap-from-drive/.

CREATE TABLE meeting_recording (
  id                INT UNSIGNED      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id         INT UNSIGNED      NOT NULL DEFAULT 1,
  drive_file_id     VARCHAR(128)      NOT NULL,
  file_name         VARCHAR(255)      NOT NULL,
  mime              VARCHAR(100)      NOT NULL DEFAULT '',
  size_bytes        BIGINT UNSIGNED   NOT NULL DEFAULT 0,
  -- Lúc Drive ghi nhận tệp tải lên (không phải lúc ghi âm) — dùng khớp cửa sổ cuộc họp
  drive_created_at  DATETIME(3)       NOT NULL,
  -- MeetingRecordingStatus ở src/constants.ts
  status            SMALLINT          NOT NULL,
  -- Sự kiện Google Calendar đã khớp — NULL khi không có ứng viên nào (Unmatched)
  event_id          VARCHAR(255)      NULL,
  meeting_title     VARCHAR(200)      NULL,
  meeting_start     DATETIME(3)       NULL,
  meeting_end       DATETIME(3)       NULL,
  -- id zalo_group (cuộc họp đặt trong nhóm) — NULL khi gửi riêng người đặt hoặc chưa rõ nơi gửi
  target_thread_id  INT UNSIGNED      NULL,
  -- Mã Zalo người đặt họp (extendedProperties.private.requester, calendar-meetings.ts) — gửi riêng khi không có nhóm
  requester_uid     VARCHAR(64)       NULL,
  attempts          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  -- Mốc giành lượt Processing — kẹt quá 45 phút (tiến trình chết giữa chừng) thì lượt sau trả về Queued
  claimed_at        DATETIME(3)       NULL,
  -- M2 (review 10/10/2026): hoãn vì ước token vượt PHẦN CÒN LẠI của trần ngày — claimNext bỏ qua tới mốc này (đầu ngày
  -- mai giờ VN), không giành lại mỗi 5 phút làm nghẽn các dòng Queued SAU nó. NULL = giành ngay khi Queued.
  retry_after       DATETIME(3)       NULL,
  -- Recap JSON mô hình trả về (phase 4) — lưu ngay sau khi gọi AI, lỗi PDF / gửi thì thử lại không tốn AI lần hai
  recap_json        JSON              NULL,
  -- [{fileName, storageKey, bytes}] PDF recap đã xuất (phase 4)
  files             JSON              NULL,
  -- id các việc đã tạo từ recap (phase 4, TaskSource.Recap) — dùng cho lệnh «ok hết» / «bỏ hết»
  task_ids          JSON              NULL,
  -- Vì sao Skipped / Unmatched (nhóm Mật, quá cỡ, không rõ nơi gửi, không phải ghi âm, không khớp cuộc họp…)
  note              VARCHAR(200)      NOT NULL DEFAULT '',
  error             VARCHAR(500)      NOT NULL DEFAULT '',
  input_tokens      INT UNSIGNED      NOT NULL DEFAULT 0,
  output_tokens     INT UNSIGNED      NOT NULL DEFAULT 0,
  created_at        DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  done_at           DATETIME(3)       NULL,
  UNIQUE KEY ux_meeting_recording_drive_file (drive_file_id),
  KEY ix_meeting_recording_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
