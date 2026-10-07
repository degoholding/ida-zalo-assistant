-- 07/10/2026: màn «Khóa AI» — danh sách khóa có thứ tự. Bot dùng khóa số 1 (priority nhỏ nhất); khóa đó hết tiền,
-- hết hạn mức, sai, quá tải hay quá thời gian thì tự chuyển sang khóa kế. Bảng rỗng = bot chạy bằng cài đặt cũ
-- (ai_provider, gemini_api_key, openai_api_key… trong app_setting / .env). Khởi động lần đầu với bảng rỗng mà cài đặt
-- cũ có khóa thì máy chủ tự chép thành các dòng ở đây (src/assistant/ai-key-store.ts → migrateLegacyKeys).
CREATE TABLE ai_key (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  -- AiKeyProvider ở src/constants.ts
  provider      SMALLINT      NOT NULL,
  -- Chỉ hãng «Tương thích OpenAI (tùy chỉnh)»; hãng khác dùng địa chỉ chuẩn trong mã
  base_url      VARCHAR(300)  NOT NULL DEFAULT '',
  -- Rỗng = mô hình mặc định của hãng
  model         VARCHAR(120)  NOT NULL DEFAULT '',
  -- Rỗng = việc nặng dùng chính `model`
  model_heavy   VARCHAR(120)  NOT NULL DEFAULT '',
  -- Khóa đã mã hóa bằng SESSION_ENCRYPTION_KEY (chuỗi "v1.<iv>.<tag>.<body>" của encryptJson)
  secret        TEXT          NOT NULL,
  -- 4 ký tự cuối để màn hình nhận ra khóa — không bao giờ trả khóa đầy đủ
  key_tail      VARCHAR(8)    NOT NULL DEFAULT '',
  priority      INT           NOT NULL,
  -- Trần lượt gọi AI mỗi ngày (giờ Việt Nam); 0 = không giới hạn
  daily_cap     INT UNSIGNED  NOT NULL DEFAULT 0,
  -- Lỗi gần nhất khiến bot bỏ qua khóa này (vd «hết tiền (402)») — để màn hình hiện «lỗi lúc hh:mm»
  last_error    VARCHAR(200)  NOT NULL DEFAULT '',
  last_error_at DATETIME(3)   NULL,
  verified_at   DATETIME(3)   NULL,
  -- Gỡ khóa = đánh dấu, giữ dòng để biết bảng đã từng có khóa (không chép lại từ cài đặt cũ)
  deleted_at    DATETIME(3)   NULL,
  created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by    VARCHAR(100)  NOT NULL DEFAULT '',
  KEY ix_ai_key_priority (deleted_at, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Số lượt gọi AI thành công của từng khóa theo ngày giờ Việt Nam — áp trần `daily_cap`, hiện «hôm nay n lượt».
CREATE TABLE ai_key_usage (
  ai_key_id  INT UNSIGNED NOT NULL,
  usage_date DATE         NOT NULL,
  call_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (ai_key_id, usage_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
