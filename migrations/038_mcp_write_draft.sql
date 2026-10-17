-- Nháp ghi dữ liệu qua MCP / trợ lý (phase 8): công cụ propose_* chỉ tạo nháp, confirm_write mới thực hiện. Mã xác nhận chỉ lưu BĂM;
-- payload_hash khóa nội dung nháp (sửa tay trong DB thì xác nhận thất bại); dùng một lần bằng used_at.
CREATE TABLE IF NOT EXISTS mcp_write_draft (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT UNSIGNED NOT NULL DEFAULT 1,
  user_id       INT UNSIGNED NOT NULL,
  key_id        INT UNSIGNED NULL,
  source        SMALLINT      NOT NULL,
  tool          VARCHAR(64)   NOT NULL,
  target_entity VARCHAR(40)   NOT NULL,
  target_id     INT UNSIGNED  NULL,
  payload_json  JSON          NOT NULL,
  payload_hash  CHAR(64)      NOT NULL,
  preview       VARCHAR(2000) NOT NULL DEFAULT '',
  code_hash     CHAR(64)      NOT NULL,
  expires_at    DATETIME(3)   NOT NULL,
  used_at       DATETIME(3)   NULL,
  result_json   JSON          NULL,
  created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_mcp_write_draft_user (user_id, created_at),
  KEY ix_mcp_write_draft_code (code_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
