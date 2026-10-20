-- Nháp của trợ lý gắn theo liên hệ Zalo (contact_id luôn có ở Zalo); user_id lưu thêm khi người đó có tài khoản web (phase 5).
-- Có kiểm information_schema (chạy lại không lỗi).
SET @has_column := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mcp_write_draft' AND COLUMN_NAME = 'contact_id');
SET @ddl := IF(@has_column = 0,
  'ALTER TABLE mcp_write_draft ADD COLUMN contact_id INT UNSIGNED NULL AFTER user_id, ADD KEY ix_mcp_write_draft_contact (contact_id, created_at)', 'DO 0');
PREPARE add_column FROM @ddl;
EXECUTE add_column;
DEALLOCATE PREPARE add_column;
