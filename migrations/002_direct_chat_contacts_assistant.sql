-- Đợt A + B (01/10/2026): tin nhắn riêng 1-1 với bot, Danh bạ, nhật ký trợ lý AI.

-- Bảng zalo_group nay chứa CẢ nhóm lẫn cuộc trò chuyện riêng (giữ tên bảng cho đỡ đổi mã):
--   thread_type 1 = nhóm      → zalo_group_id = mã nhóm,          owner_bot_id = 0
--   thread_type 0 = riêng 1-1 → zalo_group_id = mã Zalo người kia, owner_bot_id = bot nhận tin
-- Mỗi cặp (bot, người) là một cuộc riêng: hai bot cùng nhắn với một người là hai cuộc khác nhau.
ALTER TABLE zalo_group
  ADD COLUMN thread_type  SMALLINT     NOT NULL DEFAULT 1 AFTER id,
  ADD COLUMN owner_bot_id INT UNSIGNED NOT NULL DEFAULT 0 AFTER zalo_group_id,
  DROP INDEX ux_zalo_group_zalo_id,
  ADD UNIQUE KEY ux_zalo_group_thread (thread_type, zalo_group_id, owner_bot_id);

-- Danh bạ: mọi người Zalo bot từng thấy — người nhắn riêng cho bot + thành viên các nhóm.
-- Một người một dòng theo mã Zalo (tên mỗi nhóm một kiểu, mã thì một).
-- role > 0 = được bot trả lời; role = 0 = chỉ lưu tin, bot không trả lời.
CREATE TABLE contact (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  zalo_uid      VARCHAR(40)  NOT NULL,
  display_name  VARCHAR(255) NOT NULL DEFAULT '',
  zalo_name     VARCHAR(255) NOT NULL DEFAULT '',
  kind          SMALLINT     NOT NULL DEFAULT 0,
  role          SMALLINT     NOT NULL DEFAULT 0,
  company_id    INT UNSIGNED NULL,
  note          TEXT         NULL,
  first_seen_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_dm_at    DATETIME(3)  NULL,
  dm_count      INT          NOT NULL DEFAULT 0,
  UNIQUE KEY ux_contact_uid (zalo_uid),
  KEY ix_contact_role (role),
  KEY ix_contact_last_dm (last_dm_at),
  CONSTRAINT fk_contact_company FOREIGN KEY (company_id) REFERENCES company (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nhật ký trợ lý: mỗi câu hỏi một dòng — để tính trần chi phí theo ngày, giới hạn số câu mỗi giờ,
-- và tra lại bot đã trả lời gì, tốn bao nhiêu.
CREATE TABLE assistant_turn (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bot_account_id INT UNSIGNED    NOT NULL,
  contact_id     INT UNSIGNED    NOT NULL,
  thread_id      INT UNSIGNED    NOT NULL,
  question_msg_id BIGINT UNSIGNED NULL,
  status         SMALLINT        NOT NULL,
  model          VARCHAR(100)    NOT NULL DEFAULT '',
  tool_calls     JSON            NULL,
  answer         MEDIUMTEXT      NULL,
  input_tokens   INT             NOT NULL DEFAULT 0,
  output_tokens  INT             NOT NULL DEFAULT 0,
  error          VARCHAR(500)    NOT NULL DEFAULT '',
  duration_ms    INT             NOT NULL DEFAULT 0,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_assistant_turn_created (created_at),
  KEY ix_assistant_turn_contact (contact_id, created_at),
  CONSTRAINT fk_assistant_turn_bot FOREIGN KEY (bot_account_id) REFERENCES bot_account (id) ON DELETE CASCADE,
  CONSTRAINT fk_assistant_turn_contact FOREIGN KEY (contact_id) REFERENCES contact (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
