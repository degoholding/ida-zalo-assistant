-- 03/10/2026 (phase B): cài đặt sửa trên web, phủ lên .env. Không có dòng = dùng .env / mặc định.
-- Khóa bí mật (khóa Gemini, JSON service account) lưu đã mã hóa bằng SESSION_ENCRYPTION_KEY.
CREATE TABLE app_setting (
  setting_key  VARCHAR(80)  NOT NULL PRIMARY KEY,
  -- Giá trị dạng JSON (số, chuỗi, mảng, true/false); khóa bí mật: chuỗi "v1.<iv>.<tag>.<body>" của encryptJson
  value        MEDIUMTEXT   NOT NULL,
  is_secret    TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by   VARCHAR(100) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
