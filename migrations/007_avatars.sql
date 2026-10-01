-- 01/10/2026: ảnh đại diện Zalo của người và nhóm.
--   avatar_url    = link ảnh Zalo mới nhất bot thấy
--   avatar_source = link đã tải về kho (khác avatar_url = ảnh đổi, cần tải lại)
--   avatar_key    = khóa trong kho (đĩa / R2); giao diện lấy ảnh qua máy chủ bot, không gọi thẳng Zalo
ALTER TABLE contact
  ADD COLUMN avatar_url    VARCHAR(500) NOT NULL DEFAULT '' AFTER zalo_name,
  ADD COLUMN avatar_source VARCHAR(500) NOT NULL DEFAULT '' AFTER avatar_url,
  ADD COLUMN avatar_key    VARCHAR(300) NULL AFTER avatar_source;

ALTER TABLE zalo_group
  ADD COLUMN avatar_url    VARCHAR(500) NOT NULL DEFAULT '' AFTER label,
  ADD COLUMN avatar_source VARCHAR(500) NOT NULL DEFAULT '' AFTER avatar_url,
  ADD COLUMN avatar_key    VARCHAR(300) NULL AFTER avatar_source;
