-- 01/10/2026: dm_count bị cộng dôi — mỗi lần bot kết nối lại, phần "bù tin lỡ" gửi lại cả tin đã có;
-- tin trùng không lưu lần hai nhưng bộ đếm vẫn cộng. Đếm lại từ chính kho tin.
UPDATE contact c
SET c.dm_count = (
  SELECT COUNT(*) FROM message m JOIN zalo_group g ON g.id = m.group_id
  WHERE g.thread_type = 0 AND g.zalo_group_id = c.zalo_uid AND m.sender_uid = c.zalo_uid
);
