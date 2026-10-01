-- 01/10/2026: người chỉ nhắn riêng cho bot (không ở nhóm nào) mặc định là Khách hàng — người lạ nhắn
-- vào tài khoản Zalo công ty phần lớn là khách. Luật đầy đủ ở contact-repository.recomputeContactKinds.
UPDATE contact SET kind = 1 WHERE kind_source = 0 AND kind = 0 AND dm_count > 0;
