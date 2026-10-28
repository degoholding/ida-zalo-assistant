-- Link chia sẻ trong tin (phase 13.2, 28/10/2026): mỗi URL http/https bóc từ chữ của tin (và từ thẻ link của Zalo) là một dòng.
-- kind (SharedLinkKind ở src/constants.ts): 1 Google Drive tệp · 2 Google Sheets · 3 Google Docs · 4 Google Slides ·
-- 5 Google Drive thư mục · 9 web khác. url đã chuẩn hóa qua WHATWG URL nên chỉ còn ký tự ASCII (tên miền punycode, đường dẫn
-- mã hóa %) — cột ascii cho chỉ mục UNIQUE (message_id, url) vừa trần 3072 byte của InnoDB. Tin trùng giữa hai tài khoản bot
-- đã bị bảng message bỏ qua; UNIQUE ở đây để lệnh nạp lại tin cũ chạy bao nhiêu lần cũng không sinh trùng.
-- title: để dành (tiêu đề tệp Google khi chụp nội dung); thẻ link Zalo có sẵn tiêu đề thì ghi luôn.
-- Xóa tin (hết hạn giữ tin, xóa nhóm) thì link đi theo (khóa ngoại CASCADE); tin thu hồi thì xóa link ngay lúc thu hồi.

CREATE TABLE IF NOT EXISTS shared_link (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id      BIGINT UNSIGNED NOT NULL,
  group_id        INT UNSIGNED    NOT NULL,
  url             VARCHAR(2000)   CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  host            VARCHAR(255)    CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT '',
  kind            SMALLINT        NOT NULL,
  google_file_id  VARCHAR(128)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  title           VARCHAR(500)    NULL,
  sender_uid      VARCHAR(40)     NOT NULL,
  sender_name     VARCHAR(255)    NOT NULL DEFAULT '',
  sent_at         DATETIME(3)     NOT NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_shared_link_message_url (message_id, url),
  KEY ix_shared_link_group_sent (group_id, sent_at),
  KEY ix_shared_link_kind (kind, sent_at),
  KEY ix_shared_link_sent (sent_at),
  CONSTRAINT fk_shared_link_message FOREIGN KEY (message_id) REFERENCES message (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
