-- 08/10/2026 (phase 3, bước 3.1): hàng đợi việc bền. Câu hỏi gửi bot (tin riêng / gọi trong nhóm) không chạy thẳng
-- trong lúc nhận tin nữa mà ghi thành một dòng ở đây; bộ chạy việc (src/jobs/job-runner.ts) lấy ra làm với trần số việc
-- song song. Bot tắt giữa chừng thì việc còn nguyên, bật lại chạy tiếp; việc lỗi tự thử lại có giãn cách.
-- Tiến trình nền (src/worker.ts) dùng chung bảng này cho các việc chạy theo lịch ở bước sau.
CREATE TABLE job (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  -- JobKind ở src/constants.ts
  kind         SMALLINT        NOT NULL,
  -- JobStatus ở src/constants.ts
  status       SMALLINT        NOT NULL DEFAULT 0,
  payload      JSON            NOT NULL,
  -- Cùng khóa = cùng một việc, ghi lần hai bị bỏ (vd mỗi tin nhóm chỉ một bot trả lời). NULL = không chống trùng
  dedupe_key   VARCHAR(191)    NULL,
  -- Cùng khóa thì chạy lần lượt, không song song (vd mỗi cuộc trò chuyện trả lời từng câu một). NULL = tự do
  serial_key   VARCHAR(191)    NULL,
  run_after    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- Quá mốc này mà chưa chạy thì bỏ (câu hỏi chờ quá lâu, trả lời muộn vô nghĩa). NULL = không hết hạn
  expires_at   DATETIME(3)     NULL,
  attempts     SMALLINT        NOT NULL DEFAULT 0,
  max_attempts SMALLINT        NOT NULL DEFAULT 3,
  -- Tiến trình đang giữ việc (vd «app:1234») + lúc nhận — tiến trình chết thì việc quá hạn giữ được trả về hàng
  locked_by    VARCHAR(100)    NULL,
  locked_at    DATETIME(3)     NULL,
  last_error   VARCHAR(1000)   NOT NULL DEFAULT '',
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at  DATETIME(3)     NULL,
  UNIQUE KEY ux_job_dedupe (dedupe_key),
  KEY ix_job_claim (status, kind, run_after),
  KEY ix_job_serial (serial_key, status),
  KEY ix_job_finished (finished_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
