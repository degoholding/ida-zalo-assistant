-- 08/10/2026 (phase 3, bước 3.2–3.4): nền cho bot TỰ theo dõi — cờ trên từng tin, cảm xúc thả lên tin, bộ lập lịch;
-- nhãn Mật cho nhóm; hạn giữ tệp gốc tách khỏi hạn giữ tin.

-- Cờ trên một tin: mức ưu tiên + trạng thái chờ trả lời. Phase 5 (check tin, N1) ghi cờ khi phân loại tin; ở đây chỉ
-- có chỗ chứa và các hàm đọc / ghi (src/flags/message-flags.ts). Không có dòng = tin thường, không cần trả lời.
CREATE TABLE message_flag (
  message_id         BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  group_id           INT UNSIGNED    NOT NULL,
  -- MessagePriority ở src/constants.ts
  priority           SMALLINT        NOT NULL DEFAULT 0,
  -- ReplyState ở src/constants.ts
  reply_state        SMALLINT        NOT NULL DEFAULT 0,
  -- FlagSource ở src/constants.ts — ai / cái gì gắn cờ
  source             SMALLINT        NOT NULL DEFAULT 0,
  -- Vì sao gắn (từ khóa nào, người VIP nào, AI nói gì) — để người nhận hiểu vì sao bị báo
  reason             VARCHAR(300)    NOT NULL DEFAULT '',
  -- Mốc nhắc nếu vẫn chưa ai trả lời (đồng hồ chờ tính theo giờ làm việc)
  due_at             DATETIME(3)     NULL,
  seen_at            DATETIME(3)     NULL,
  seen_by_uid        VARCHAR(40)     NULL,
  handled_at         DATETIME(3)     NULL,
  handled_by_uid     VARCHAR(40)     NULL,
  -- Tin trả lời làm tin này «đã xử lý» (NULL = đánh dấu tay)
  handled_message_id BIGINT UNSIGNED NULL,
  created_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_message_flag_open (reply_state, due_at),
  KEY ix_message_flag_group (group_id, reply_state),
  CONSTRAINT fk_message_flag_message FOREIGN KEY (message_id) REFERENCES message (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cảm xúc thả lên tin (IDA câu 8: thả cảm xúc = «đã xem», chưa phải đã xử lý). Mỗi người một cảm xúc trên một tin;
-- gỡ cảm xúc thì xóa dòng.
CREATE TABLE message_reaction (
  message_id  BIGINT UNSIGNED NOT NULL,
  reactor_uid VARCHAR(40)     NOT NULL,
  icon        VARCHAR(40)     NOT NULL,
  reacted_at  DATETIME(3)     NOT NULL,
  PRIMARY KEY (message_id, reactor_uid),
  CONSTRAINT fk_message_reaction_message FOREIGN KEY (message_id) REFERENCES message (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bộ lập lịch (src/schedule/scheduler.ts): mỗi việc theo lịch một dòng. `last_slot` = lượt đã nhận (vd ngày
-- «2026-10-08» với việc hằng ngày) — cập nhật có điều kiện nên hai tiến trình không chạy trùng một lượt, và tiến trình
-- tắt qua giờ chạy thì bật lên chạy bù lượt hôm đó.
CREATE TABLE schedule_run (
  task             VARCHAR(64)   NOT NULL PRIMARY KEY,
  last_slot        VARCHAR(40)   NULL,
  last_started_at  DATETIME(3)   NULL,
  last_finished_at DATETIME(3)   NULL,
  -- 0 chưa chạy · 1 đang chạy · 2 xong · 3 lỗi (ScheduleRunStatus)
  last_status      SMALLINT      NOT NULL DEFAULT 0,
  last_error       VARCHAR(500)  NOT NULL DEFAULT '',
  last_duration_ms INT UNSIGNED  NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nhóm «Mật» (IDA câu 4): bot vẫn đọc + lưu để nhắc, nhưng KHÔNG gửi nội dung nhóm sang AI và không đưa vào báo cáo
-- cho người khác.
ALTER TABLE zalo_group
  ADD COLUMN is_confidential     TINYINT(1)        NOT NULL DEFAULT 0 AFTER retention_days,
  -- Tệp gốc (ảnh, PDF, Excel…) giữ ngần này ngày rồi xóa, chỉ giữ chữ đã bóc (IDA câu 20: 6 tháng). Tin vẫn theo
  -- retention_days (24 tháng).
  ADD COLUMN file_retention_days SMALLINT UNSIGNED NOT NULL DEFAULT 180 AFTER is_confidential;

-- Tệp được đánh dấu «giữ»: không xóa tệp gốc khi hết file_retention_days (vẫn theo hạn của tin).
ALTER TABLE attachment
  ADD COLUMN keep_file TINYINT(1) NOT NULL DEFAULT 0 AFTER status;
