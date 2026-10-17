-- Cờ «Xem Lịch sử thao tác» cấp được cho người không phải quản trị (chỉ thấy dòng của bản ghi trong phạm vi nhóm của mình).
-- Cùng mẫu ALTER có kiểm information_schema như 036.
SET @has_column := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'can_view_audit');
SET @ddl := IF(@has_column = 0,
  'ALTER TABLE app_user ADD COLUMN can_view_audit TINYINT(1) NOT NULL DEFAULT 0 AFTER can_view_confidential', 'DO 0');
PREPARE add_column FROM @ddl;
EXECUTE add_column;
DEALLOCATE PREPARE add_column;
