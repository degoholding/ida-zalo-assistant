-- 01/10/2026: chữ bóc ra từ tệp (xlsx, docx, pdf, ảnh, txt…) — bot đọc một lần rồi cất, lần sau tìm
-- và tóm tắt dùng lại; màn Tệp tìm được trong nội dung; báo cáo sau này dựng trên bảng này.
CREATE TABLE attachment_text (
  attachment_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  -- text | xlsx | docx | gemini (pdf, ảnh — nhờ mô hình đọc) | unsupported
  method        VARCHAR(20)     NOT NULL,
  char_count    INT             NOT NULL DEFAULT 0,
  -- Tiêu đề / bố cục nếu bóc được (tên sheet, số dòng…), để hiển thị
  summary       VARCHAR(500)    NOT NULL DEFAULT '',
  text          MEDIUMTEXT      NULL,
  input_tokens  INT             NOT NULL DEFAULT 0,
  output_tokens INT             NOT NULL DEFAULT 0,
  extracted_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_attachment_text_attachment FOREIGN KEY (attachment_id) REFERENCES attachment (id) ON DELETE CASCADE,
  FULLTEXT KEY ft_attachment_text (text)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
