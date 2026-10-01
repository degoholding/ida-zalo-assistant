-- 01/10/2026: Zalo cấp MÃ KHÁC NHAU cho cùng một người ở hai ngữ cảnh — trong nhóm (thành viên) và
-- khi nhắn riêng cho bot (đo thật: «Gia Bảo» nhóm 4890…, nhắn riêng 6312…). globalId trong hồ sơ Zalo
-- là mã chung để nối hai mã đó.
ALTER TABLE contact
  ADD COLUMN global_id VARCHAR(40) NULL AFTER zalo_uid,
  ADD KEY ix_contact_global (global_id);
