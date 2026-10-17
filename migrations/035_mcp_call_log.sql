-- Nhật ký MỖI lời gọi công cụ MCP / trợ lý (khối lượng lớn nên không trộn vào audit_log). Không lưu nội dung trả về, chỉ
-- băm + bản xem trước của tham số đã che dữ liệu cá nhân. Ghi thật dữ liệu thì còn ghi thêm audit_log.
CREATE TABLE IF NOT EXISTS mcp_call_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT UNSIGNED NOT NULL DEFAULT 1,
  user_id       INT UNSIGNED NULL,
  key_id        INT UNSIGNED NULL,
  source        SMALLINT     NOT NULL,
  tool          VARCHAR(64)  NOT NULL,
  entity        VARCHAR(40)  NULL,
  args_hash     CHAR(64)     NOT NULL,
  args_preview  VARCHAR(500) NOT NULL DEFAULT '',
  row_count     INT          NOT NULL DEFAULT 0,
  result_chars  INT          NOT NULL DEFAULT 0,
  duration_ms   INT          NOT NULL DEFAULT 0,
  status        SMALLINT     NOT NULL,
  error_code    VARCHAR(64)  NULL,
  client_ip     VARCHAR(64)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_mcp_call_log_key (key_id, created_at),
  KEY ix_mcp_call_log_user (user_id, created_at),
  KEY ix_mcp_call_log_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
