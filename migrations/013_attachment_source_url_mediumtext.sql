-- 02/10/2026: ảnh nhập từ Zalo Web đến dưới dạng data URL (web chỉ giữ blob, máy chủ không tải được bằng
-- link) — ảnh thật 150-300 KB, base64 vượt trần 64 KB của TEXT ("Data too long for column 'source_url'").
-- MEDIUMTEXT (16 MB) đủ cho trần 2 MB / ảnh của bookmarklet. Bộ tải tệp xóa data URL sau khi cất xong
-- nên bảng không phình lâu dài.
ALTER TABLE attachment MODIFY source_url MEDIUMTEXT NOT NULL;
