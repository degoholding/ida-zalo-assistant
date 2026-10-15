-- Ảnh Zalo («chat.photo» / «chat.doodle» / «chat.gif», kind = 1 Image) tới không tên, không đuôi → kho cất «tep.bin», trợ
-- lý phân loại theo đuôi nên từ chối đọc («chưa được phép đọc tệp .bin»). Từ nay bộ tải tự ghi đuôi nhận ra từ đầu tệp;
-- dòng cũ điền «jpg» («gif» cho chat.gif) — bộ đọc vẫn dò lại chữ ký đầu tệp để báo đúng loại ảnh cho mô hình.
UPDATE attachment a
JOIN message m ON m.id = a.message_id
SET a.file_ext = IF(m.zalo_msg_type LIKE 'chat.gif%', 'gif', 'jpg')
WHERE a.file_ext = '' AND a.file_name = '' AND m.kind = 1;

-- Việc nền tự đọc ảnh (src/alerts/image-auto-read.ts) quét ảnh cất trong 24 giờ mỗi 2 phút — lọc theo mốc cất kho
ALTER TABLE attachment ADD KEY ix_attachment_stored_at (stored_at);
