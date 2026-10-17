-- Loại tài khoản bot: 0 = Trợ lý (mặc định, như trước), 1 = Normal (chỉ gom dữ liệu, không gửi / tác động gì lên Zalo).
-- Cùng mẫu ALTER có kiểm information_schema như 036 / 037.
SET @has_column := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_account' AND COLUMN_NAME = 'kind');
SET @ddl := IF(@has_column = 0,
  'ALTER TABLE bot_account ADD COLUMN kind SMALLINT NOT NULL DEFAULT 0 AFTER is_active', 'DO 0');
PREPARE add_column FROM @ddl;
EXECUTE add_column;
DEALLOCATE PREPARE add_column;
