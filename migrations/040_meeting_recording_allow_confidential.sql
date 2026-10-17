-- Vá review phase 4–6 (17/10/2026, quyết định 7): recap ghi âm THEO YÊU CẦU CHAT trong nhóm Mật chỉ chạy khi người hỏi có tài khoản web +
-- cờ «Xem nhóm Mật». Việc nền gỡ băng đọc cờ này trên chính dòng recap; recap TỰ ĐỘNG (không người hỏi) luôn 0 = vẫn chặn nhóm Mật.
ALTER TABLE meeting_recording ADD COLUMN allow_confidential TINYINT(1) NOT NULL DEFAULT 0;
