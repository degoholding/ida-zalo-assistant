-- 01/10/2026: đếm tin và giờ tin gần nhất NGAY TRÊN zalo_group, cập nhật lúc ghi tin.
-- Trước đây màn Hội thoại / Nhóm tính bằng GROUP BY cả bảng message mỗi lần mở — vài nhóm thì không
-- sao, vài chục nhóm với hàng triệu tin là mỗi lần làm mới quét cả bảng.
ALTER TABLE zalo_group
  ADD COLUMN message_count   INT         NOT NULL DEFAULT 0 AFTER member_count,
  ADD COLUMN last_message_at DATETIME(3) NULL AFTER message_count;

UPDATE zalo_group g
  LEFT JOIN (SELECT group_id, COUNT(*) AS n, MAX(sent_at) AS last_at FROM message GROUP BY group_id) x ON x.group_id = g.id
  SET g.message_count = COALESCE(x.n, 0), g.last_message_at = x.last_at;
