-- 01/10/2026: loại nhóm quyết định loại người trong Danh bạ.
--   zalo_group.group_kind: 1 = nhóm khách hàng (mặc định), 2 = nhóm nội bộ / công việc
--   contact.kind_source:   0 = tự động theo nhóm, 1 = quản trị chỉnh tay (tự động không ghi đè)
-- Luật tự động: ở ÍT NHẤT một nhóm nội bộ → Nhân sự; không thì ở nhóm khách hàng → Khách hàng;
-- không ở nhóm nào (chỉ nhắn riêng bot) → giữ nguyên.

ALTER TABLE zalo_group ADD COLUMN group_kind SMALLINT NOT NULL DEFAULT 1 AFTER thread_type;
ALTER TABLE contact ADD COLUMN kind_source SMALLINT NOT NULL DEFAULT 0 AFTER kind;

-- Người đã có loại khác "chưa phân loại" trước bản này là do quản trị chọn tay — giữ nguyên
UPDATE contact SET kind_source = 1 WHERE kind <> 0;

UPDATE contact c
SET c.kind = CASE
  WHEN EXISTS (SELECT 1 FROM group_member gm JOIN zalo_group g ON g.id = gm.group_id
               WHERE gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL AND g.thread_type = 1 AND g.group_kind = 2) THEN 2
  WHEN EXISTS (SELECT 1 FROM group_member gm JOIN zalo_group g ON g.id = gm.group_id
               WHERE gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL AND g.thread_type = 1) THEN 1
  ELSE c.kind END
WHERE c.kind_source = 0;
