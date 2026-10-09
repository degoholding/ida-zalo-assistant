-- Phase 6 (N4) — tìm tin nhắn (IDA câu 21): bảng tìm riêng message_search (bản sao chữ của tin) có chỉ mục toàn văn.
--
-- VÌ SAO BẢNG RIÊNG, không thêm FULLTEXT thẳng vào message: thêm chỉ mục toàn văn đầu tiên (và đổi collation) vào một bảng
-- có sẵn bắt InnoDB dựng lại CẢ bảng và CHẶN GHI suốt lúc dựng (đo: 1 triệu tin ~25 giây, hai lần dựng) — bảng message
-- càng lớn thì bot càng «đứng» lâu, tiến trình thứ hai chờ khóa migration quá 120 giây thì chết. Ở đây bảng mới tạo RỖNG
-- kèm chỉ mục (tức thời, không đụng bảng message); tin mới được ghi vào ngay lúc lưu (src/sync/message-ingest.ts), tin cũ
-- do việc nền «search-index» chép dần theo lô, mới trước cũ sau (src/search/message-search-index.ts). Không dùng trigger:
-- binlog bật thì user ứng dụng (không SUPER) không tạo được trigger nếu chưa nới log_bin_trust_function_creators.
--
-- Bộ tách MẶC ĐỊNH (theo khoảng trắng → mỗi âm tiết một từ), KHÔNG dùng ngram: đo 09/10/2026 trên 1 triệu tin, ngram tách
-- thành cặp 2 ký tự mà tiếng Việt có những cặp nằm trong gần như mọi tin («ng», «nh») → một câu tìm làm MySQL hết 768 MB
-- và bị giết. Cấu hình MySQL đi kèm (docker-compose.yml): innodb_ft_min_token_size=1 (nhận cả «nợ», «xe»),
-- innodb_ft_enable_stopword=OFF, innodb_ft_result_cache_limit=32 MB (vượt thì câu tìm báo lỗi, ứng dụng tự lùi về quét
-- LIKE trong 90 ngày — src/search/message-search.ts). Máy chưa đổi cấu hình thì ứng dụng tự nhận ra và lùi về LIKE.
--
-- Collation utf8mb4_0900_ai_ci cho message_search.text: gõ không dấu khớp có dấu KỂ CẢ «đ» = «d» («dai ly» → «đại lý»);
-- message.text giữ nguyên utf8mb4_unicode_ci. group_id / sent_at chép sang để lọc + sắp theo giờ ngay trên bảng tìm.
-- Xóa tin (dọn quá hạn, xóa nhóm) thì khóa ngoại tự xóa dòng tìm; thu hồi tin thì mã ứng dụng xóa.
--
-- search_index_meta: min_token_size = innodb_ft_min_token_size lúc tạo (từ ngắn hơn KHÔNG có trong chỉ mục — ứng dụng dùng
-- max(lúc tạo, hiện tại)); backfill_next_id = tin cũ còn phải chép từ id này trở xuống (NULL = chưa bắt đầu, 0 = xong).
SET SESSION innodb_ft_enable_stopword = 0;
CREATE TABLE message_search (
  message_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  group_id   INT UNSIGNED    NOT NULL,
  sent_at    DATETIME(3)     NOT NULL,
  text       MEDIUMTEXT      NOT NULL,
  KEY ix_message_search_sent (sent_at),
  KEY ix_message_search_group_sent (group_id, sent_at),
  FULLTEXT KEY ft_message_search_text (text),
  CONSTRAINT fk_message_search_message FOREIGN KEY (message_id) REFERENCES message (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE search_index_meta (
  name             VARCHAR(64)      NOT NULL PRIMARY KEY,
  min_token_size   TINYINT UNSIGNED NOT NULL,
  backfill_next_id BIGINT UNSIGNED  NULL,
  built_at         DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  backfilled_at    DATETIME(3)      NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO search_index_meta (name, min_token_size) VALUES ('message_search', @@innodb_ft_min_token_size);
