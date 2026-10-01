-- 01/10/2026: nhật ký thay đổi cho giao diện mới (khung ERP v2 có mục «Lịch sử» ở mọi trang chi tiết).
-- Ghi mỗi lần quản trị sửa hồ sơ / nhóm / công ty / tài khoản bot: ai, lúc nào, đổi những ô nào.
CREATE TABLE audit_log (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entity         VARCHAR(40)     NOT NULL,
  entity_id      BIGINT UNSIGNED NOT NULL,
  action         VARCHAR(30)     NOT NULL,
  message        VARCHAR(500)    NOT NULL DEFAULT '',
  changed_fields VARCHAR(500)    NOT NULL DEFAULT '',
  change_count   SMALLINT        NOT NULL DEFAULT 0,
  actor          VARCHAR(100)    NOT NULL DEFAULT '',
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_audit_log_entity (entity, entity_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
