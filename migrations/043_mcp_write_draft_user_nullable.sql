-- Nháp ghi theo QUAN HỆ do liên hệ Zalo không có tài khoản web tạo (phase 5) không có user_id: cho phép NULL.
-- HTTP / người có tài khoản vẫn luôn điền user_id. Có kiểm information_schema (chạy lại không lỗi).
SET @is_required := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mcp_write_draft' AND COLUMN_NAME = 'user_id' AND IS_NULLABLE = 'NO');
SET @ddl := IF(@is_required = 1,
  'ALTER TABLE mcp_write_draft MODIFY COLUMN user_id INT UNSIGNED NULL', 'DO 0');
PREPARE relax_column FROM @ddl;
EXECUTE relax_column;
DEALLOCATE PREPARE relax_column;
