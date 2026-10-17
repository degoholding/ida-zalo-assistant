-- Cờ «Xem nhóm Mật» cấp riêng cho từng người (mọi vai trò, mặc định tắt). Chỉ chi phối AI / MCP; web người thật giữ nguyên.
-- MySQL 8.4 không có ADD COLUMN IF NOT EXISTS → kiểm information_schema rồi PREPARE (chạy lại không lỗi). Một DDL / tệp.
SET @has_column := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'can_view_confidential');
SET @ddl := IF(@has_column = 0,
  'ALTER TABLE app_user ADD COLUMN can_view_confidential TINYINT(1) NOT NULL DEFAULT 0 AFTER all_groups', 'DO 0');
PREPARE add_column FROM @ddl;
EXECUTE add_column;
DEALLOCATE PREPARE add_column;
