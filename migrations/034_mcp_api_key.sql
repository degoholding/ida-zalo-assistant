-- Khóa truy cập MCP do người dùng tự tạo (AI ngoài như Claude / Codex gọi /mcp bằng Bearer). Chỉ lưu băm SHA-256 của khóa
-- (lộ bảng cũng không dùng được); quyền khi gọi = quyền hiện tại của chủ khóa, khóa chỉ có thể HẠ mức (đọc / đọc + ghi).
CREATE TABLE IF NOT EXISTS mcp_api_key (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id            INT UNSIGNED NOT NULL DEFAULT 1,
  user_id              INT UNSIGNED NOT NULL,
  name                 VARCHAR(100) NOT NULL,
  prefix               CHAR(8)      NOT NULL,
  token_hash           CHAR(64)     NOT NULL,
  access_level         SMALLINT     NOT NULL DEFAULT 1,
  include_confidential TINYINT(1)   NOT NULL DEFAULT 0,
  expires_at           DATETIME(3)  NULL,
  last_used_at         DATETIME(3)  NULL,
  last_used_ip         VARCHAR(64)  NULL,
  revoked_at           DATETIME(3)  NULL,
  revoked_by           VARCHAR(100) NULL,
  created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_mcp_api_key_hash (token_hash),
  UNIQUE KEY ux_mcp_api_key_prefix (prefix),
  KEY ix_mcp_api_key_user (user_id),
  CONSTRAINT fk_mcp_api_key_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
