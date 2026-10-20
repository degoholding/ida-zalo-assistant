-- Nhật ký gọi công cụ ghi thêm liên hệ Zalo đang nhắn bot (phase 5): lượt trợ lý của người không có tài khoản web vẫn truy được về ai.
-- Mỗi tệp một DDL, ALTER có kiểm information_schema (chạy lại không lỗi) như 041.
SET @has_column := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mcp_call_log' AND COLUMN_NAME = 'contact_id');
SET @ddl := IF(@has_column = 0,
  'ALTER TABLE mcp_call_log ADD COLUMN contact_id INT UNSIGNED NULL AFTER user_id, ADD KEY ix_mcp_call_log_contact (contact_id, created_at)', 'DO 0');
PREPARE add_column FROM @ddl;
EXECUTE add_column;
DEALLOCATE PREPARE add_column;
