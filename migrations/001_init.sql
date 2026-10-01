-- Bản đồng bộ cơ bản: tài khoản bot, công ty, nhóm, bot–nhóm, thành viên, tin nhóm, file, nhật ký phiên.
-- Trạng thái / loại lưu SMALLINT, nghĩa khai ở src/constants.ts.

CREATE TABLE bot_account (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  label             VARCHAR(100) NOT NULL,
  zalo_uid          VARCHAR(40)  NULL,
  display_name      VARCHAR(255) NOT NULL DEFAULT '',
  -- Phiên đăng nhập Zalo (cookie + imei + userAgent) đã mã hóa AES-256-GCM
  session_cipher    TEXT         NULL,
  status            SMALLINT     NOT NULL DEFAULT 0,
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  last_connected_at DATETIME(3)  NULL,
  last_heartbeat_at DATETIME(3)  NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_bot_account_label (label),
  UNIQUE KEY ux_bot_account_zalo_uid (zalo_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Công ty / pháp nhân trong cùng một bộ cài (khách có nhiều công ty con). Nhóm Zalo gắn vào công ty;
-- quản lý của công ty nào chỉ thấy nhóm của công ty đó. Khách hàng KHÁC thì dựng bộ cài + DB riêng.
CREATE TABLE company (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(30)  NOT NULL,
  name       VARCHAR(255) NOT NULL,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_company_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE zalo_group (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  zalo_group_id     VARCHAR(40)  NOT NULL,
  -- NULL = chưa gán công ty: chỉ quản trị chung thấy
  company_id        INT UNSIGNED NULL,
  name              VARCHAR(255) NOT NULL DEFAULT '',
  label             VARCHAR(100) NOT NULL DEFAULT '',
  member_count      INT          NOT NULL DEFAULT 0,
  read_messages     TINYINT(1)   NOT NULL DEFAULT 0,
  capture_files     TINYINT(1)   NOT NULL DEFAULT 0,
  retention_days    INT          NOT NULL DEFAULT 730,
  first_seen_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  members_synced_at DATETIME(3)  NULL,
  UNIQUE KEY ux_zalo_group_zalo_id (zalo_group_id),
  KEY ix_zalo_group_company (company_id),
  CONSTRAINT fk_zalo_group_company FOREIGN KEY (company_id) REFERENCES company (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bot nào đang ở nhóm nào. Nhiều bot cùng một nhóm thì tin vẫn lưu MỘT lần (khóa duy nhất của
-- message); bảng này chỉ trả lời "nhóm còn bot nào đọc không" và "khóa bot X thì mất những nhóm nào".
CREATE TABLE bot_group (
  bot_account_id INT UNSIGNED NOT NULL,
  group_id       INT UNSIGNED NOT NULL,
  joined_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  left_at        DATETIME(3)  NULL,
  PRIMARY KEY (bot_account_id, group_id),
  KEY ix_bot_group_group (group_id),
  CONSTRAINT fk_bot_group_bot FOREIGN KEY (bot_account_id) REFERENCES bot_account (id) ON DELETE CASCADE,
  CONSTRAINT fk_bot_group_group FOREIGN KEY (group_id) REFERENCES zalo_group (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Thành viên nhóm — nguồn phạm vi hỏi của trưởng phòng (chỉ hỏi nhóm mình có mặt)
CREATE TABLE group_member (
  group_id      INT UNSIGNED NOT NULL,
  zalo_uid      VARCHAR(40)  NOT NULL,
  display_name  VARCHAR(255) NOT NULL DEFAULT '',
  zalo_name     VARCHAR(255) NOT NULL DEFAULT '',
  is_admin      TINYINT(1)   NOT NULL DEFAULT 0,
  first_seen_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  left_at       DATETIME(3)  NULL,
  PRIMARY KEY (group_id, zalo_uid),
  KEY ix_group_member_uid (zalo_uid),
  CONSTRAINT fk_group_member_group FOREIGN KEY (group_id) REFERENCES zalo_group (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE message (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id      INT UNSIGNED    NOT NULL,
  zalo_msg_id   VARCHAR(40)     NOT NULL,
  cli_msg_id    VARCHAR(40)     NOT NULL DEFAULT '',
  -- Mã loại tin nguyên gốc của Zalo (vd chat.photo, share.file) — giữ để dò loại lạ
  zalo_msg_type VARCHAR(50)     NOT NULL DEFAULT '',
  kind          SMALLINT        NOT NULL,
  sender_uid    VARCHAR(40)     NOT NULL,
  sender_name   VARCHAR(255)    NOT NULL DEFAULT '',
  sent_at       DATETIME(3)     NOT NULL,
  text          MEDIUMTEXT      NULL,
  raw_content   JSON            NULL,
  quote_msg_id  VARCHAR(40)     NULL,
  quote_text    TEXT            NULL,
  mentions      JSON            NULL,
  recalled_at   DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_message_group_msg (group_id, zalo_msg_id),
  KEY ix_message_group_sent (group_id, sent_at),
  KEY ix_message_sender_sent (sender_uid, sent_at),
  CONSTRAINT fk_message_group FOREIGN KEY (group_id) REFERENCES zalo_group (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attachment (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id   BIGINT UNSIGNED NOT NULL,
  group_id     INT UNSIGNED    NOT NULL,
  file_name    VARCHAR(255)    NOT NULL DEFAULT '',
  file_ext     VARCHAR(20)     NOT NULL DEFAULT '',
  declared_size BIGINT         NULL,
  source_url   TEXT            NOT NULL,
  storage_key  VARCHAR(500)    NULL,
  stored_bytes BIGINT          NULL,
  status       SMALLINT        NOT NULL,
  attempts     SMALLINT        NOT NULL DEFAULT 0,
  last_error   VARCHAR(500)    NOT NULL DEFAULT '',
  stored_at    DATETIME(3)     NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_attachment_message (message_id),
  KEY ix_attachment_status (status),
  KEY ix_attachment_group (group_id, created_at),
  CONSTRAINT fk_attachment_message FOREIGN KEY (message_id) REFERENCES message (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nhật ký phiên Zalo — đo độ ổn định: kết nối, mất kết nối, bị đá, đăng nhập lại
CREATE TABLE session_event (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bot_account_id INT UNSIGNED    NOT NULL,
  event          SMALLINT        NOT NULL,
  code           INT             NULL,
  detail         VARCHAR(500)    NOT NULL DEFAULT '',
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_session_event_bot (bot_account_id, created_at),
  CONSTRAINT fk_session_event_bot FOREIGN KEY (bot_account_id) REFERENCES bot_account (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
