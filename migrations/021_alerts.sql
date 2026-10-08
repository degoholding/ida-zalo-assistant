-- 08/10/2026 (phase 5, N1 — check tin nhắn và cảnh báo): bot tự phân loại tin, báo KHẨN / VIP cho người nhận, nhắc tin
-- chờ quá giờ, báo khi phiên Zalo văng.

ALTER TABLE message_flag
  -- Cờ dành cho riêng một người (tin nhắc tên / trả lời đúng người nhận đó); NULL = mọi người nhận theo dõi nhóm
  ADD COLUMN for_uid    VARCHAR(40) NULL AFTER reason,
  -- Ứng viên khẩn chờ AI xác nhận (từ «nghiêm» như «la», «liền», «ngay»; từ khẩn một chữ trong tin không dấu)
  ADD COLUMN pending_ai TINYINT(1)  NOT NULL DEFAULT 0 AFTER for_uid,
  ADD KEY ix_message_flag_pending_ai (pending_ai, created_at);

-- Đã báo gì cho ai: chống báo trùng, đếm trần «tin thường tối đa 3 lần báo / ngày» (IDA câu 9).
CREATE TABLE alert_log (
  recipient_id INT UNSIGNED    NOT NULL,
  message_id   BIGINT UNSIGNED NOT NULL,
  -- AlertKind ở src/constants.ts
  kind         SMALLINT        NOT NULL,
  -- Mã lượt gửi (mọi tin gộp trong một thông báo chung một mã) — đếm số LẦN báo trong ngày
  batch_id     CHAR(16)        NOT NULL,
  sent_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (recipient_id, message_id, kind),
  KEY ix_alert_log_recipient (recipient_id, kind, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mốc «đã cho AI xét tới tin nào» của bộ phân loại bằng AI (gom lô 5 phút / lần).
CREATE TABLE alert_cursor (
  name            VARCHAR(40)     NOT NULL PRIMARY KEY,
  last_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Token AI của việc HỆ THỐNG (không gắn bot / người hỏi) — AI xét lô cảnh báo. Cộng vào trần token ngày.
CREATE TABLE system_ai_usage (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  purpose       VARCHAR(40)     NOT NULL,
  model         VARCHAR(80)     NOT NULL DEFAULT '',
  item_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  input_tokens  INT UNSIGNED    NOT NULL DEFAULT 0,
  output_tokens INT UNSIGNED    NOT NULL DEFAULT 0,
  duration_ms   INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_system_ai_usage_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Phiên Zalo văng đã báo lúc nào (NULL = đang ổn / chưa báo) — báo một lần khi văng, một lần khi nối lại.
ALTER TABLE bot_account ADD COLUMN alerted_down_at DATETIME(3) NULL;
