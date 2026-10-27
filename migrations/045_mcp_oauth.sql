-- Đăng nhập OAuth cho cổng /mcp (27/10/2026): claude.ai / ChatGPT / Claude Desktop nối MCP bằng OAuth 2.1 (RFC 8414 + 9728 + 7591,
-- PKCE S256) thay vì dán khóa. Mỗi lần người dùng bấm «Cho phép» = MỘT dòng mcp_api_key loại OAuth (kind = 1) — cùng mức quyền,
-- cùng nhật ký mcp_call_log, cùng màn «Khóa MCP», thu hồi là cắt ngay. Có kiểm information_schema (chạy lại không lỗi).

CREATE TABLE IF NOT EXISTS mcp_oauth_client (
  id                          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id                   VARCHAR(64)  NOT NULL,
  client_name                 VARCHAR(200) NOT NULL,
  redirect_uris               JSON         NOT NULL,
  token_endpoint_auth_method  VARCHAR(32)  NOT NULL DEFAULT 'none',
  client_secret_hash          CHAR(64)     NULL,
  ip                          VARCHAR(64)  NOT NULL DEFAULT '',
  created_at                  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at                DATETIME(3)  NULL,
  UNIQUE KEY ux_mcp_oauth_client_id (client_id),
  KEY ix_mcp_oauth_client_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mcp_oauth_code (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code_hash             CHAR(64)     NOT NULL,
  client_pk             INT UNSIGNED NOT NULL,
  user_id               INT UNSIGNED NOT NULL,
  redirect_uri          VARCHAR(500) NOT NULL,
  code_challenge        VARCHAR(128) NOT NULL,
  resource              VARCHAR(500) NOT NULL DEFAULT '',
  access_level          SMALLINT     NOT NULL DEFAULT 1,
  include_confidential  TINYINT(1)   NOT NULL DEFAULT 0,
  expires_at            DATETIME(3)  NOT NULL,
  used_at               DATETIME(3)  NULL,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_mcp_oauth_code_hash (code_hash),
  KEY ix_mcp_oauth_code_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- mcp_api_key: kind (0 khóa dán tay · 1 kết nối OAuth), ứng dụng OAuth, băm mã làm mới (+ băm mã làm mới TRƯỚC — ai dùng lại mã
-- cũ là dấu mã bị lộ thì thu hồi cả kết nối, RFC 9700 §4.14), hạn mã truy cập (ngắn, 1 giờ)
SET @has_column := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mcp_api_key' AND COLUMN_NAME = 'kind');
SET @ddl := IF(@has_column = 0,
  'ALTER TABLE mcp_api_key ADD COLUMN kind SMALLINT NOT NULL DEFAULT 0 AFTER user_id,
     ADD COLUMN oauth_client_id INT UNSIGNED NULL AFTER kind,
     ADD COLUMN refresh_hash CHAR(64) NULL AFTER token_hash,
     ADD COLUMN prev_refresh_hash CHAR(64) NULL AFTER refresh_hash,
     ADD COLUMN access_expires_at DATETIME(3) NULL AFTER expires_at,
     ADD UNIQUE KEY ux_mcp_api_key_refresh (refresh_hash),
     ADD KEY ix_mcp_api_key_prev_refresh (prev_refresh_hash),
     ADD KEY ix_mcp_api_key_oauth_client (oauth_client_id)', 'DO 0');
PREPARE add_columns FROM @ddl;
EXECUTE add_columns;
DEALLOCATE PREPARE add_columns;
