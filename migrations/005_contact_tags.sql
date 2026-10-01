-- 01/10/2026: thẻ (tag) riêng cho từng người trong Danh bạ — gõ tự do, sửa ở khung hồ sơ màn Hội thoại.
CREATE TABLE contact_tag (
  contact_id INT UNSIGNED NOT NULL,
  tag        VARCHAR(50)  NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (contact_id, tag),
  KEY ix_contact_tag_tag (tag),
  CONSTRAINT fk_contact_tag_contact FOREIGN KEY (contact_id) REFERENCES contact (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
