-- Tài khoản THỬ (27/10/2026): bot_account.is_test = 1 thì quản trị được "Xóa kèm dữ liệu" (chat riêng của nó + nhóm chỉ có
-- mình nó). Tài khoản thật (0) chỉ Tắt, API từ chối xóa. Cùng mẫu ALTER có kiểm information_schema như 041.
SET @has_column := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_account' AND COLUMN_NAME = 'is_test');
SET @ddl := IF(@has_column = 0,
  'ALTER TABLE bot_account ADD COLUMN is_test TINYINT(1) NOT NULL DEFAULT 0 AFTER kind', 'DO 0');
PREPARE add_column FROM @ddl;
EXECUTE add_column;
DEALLOCATE PREPARE add_column;

-- Tệp trong kho (đĩa / R2) xóa hỏng sau khi phần DB đã xong — giữ khóa lại để việc nền dọn lại sau, không bỏ dở phần DB.
CREATE TABLE IF NOT EXISTS storage_cleanup (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  storage_key VARCHAR(500)    NOT NULL,
  reason      VARCHAR(200)    NOT NULL DEFAULT '',
  attempts    SMALLINT        NOT NULL DEFAULT 0,
  last_error  VARCHAR(500)    NOT NULL DEFAULT '',
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_storage_cleanup_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
