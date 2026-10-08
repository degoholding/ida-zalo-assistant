-- 08/10/2026 (phase 4): tài khoản web theo vai trò + đăng nhập Google, phạm vi nhóm theo người, người nhận cảnh báo /
-- bản tin (IDA câu 1: Trưởng phòng, CEO, trưởng nhóm — cùng lúc), khung tách theo công ty dùng nền tảng (tenant).

-- Công ty dùng nền tảng (khác bảng `company` — danh mục công ty khách hàng / đối tác trong Danh bạ). Hiện chỉ IDA; sau
-- gom nhiều bên vào một nền tảng thì mỗi bên một dòng, bảng mới mang tenant_id ngay từ đầu.
CREATE TABLE tenant (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(30)  NOT NULL,
  name       VARCHAR(200) NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_tenant_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tenant (id, code, name) VALUES (1, 'IDA', 'IDA Global');

-- Người dùng giao diện quản trị. Đăng nhập bằng Google (email phải có ở đây và đang bật); mật khẩu quản trị
-- (ADMIN_PASSWORD) vẫn là đường dự phòng, không gắn với dòng nào.
CREATE TABLE app_user (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT UNSIGNED NOT NULL DEFAULT 1,
  email         VARCHAR(191) NOT NULL,
  full_name     VARCHAR(150) NOT NULL DEFAULT '',
  -- UserRole ở src/constants.ts
  role          SMALLINT     NOT NULL,
  -- Người này trên Zalo (Danh bạ) — để biết «tin của tôi», nhắn riêng cho đúng người
  contact_id    INT UNSIGNED NULL,
  -- 1 = thấy mọi nhóm; 0 = chỉ các nhóm ở user_group_scope (quản trị luôn thấy hết)
  all_groups    TINYINT(1)   NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_app_user_email (email),
  KEY ix_app_user_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nhóm một người dùng (không phải quản trị) được xem trên web.
CREATE TABLE user_group_scope (
  user_id  INT UNSIGNED NOT NULL,
  group_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, group_id),
  CONSTRAINT fk_user_group_scope_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Phiên đăng nhập (lưu CSDL — khởi động lại / deploy không văng mọi người). Chỉ lưu BĂM của mã phiên.
CREATE TABLE web_session (
  token_hash CHAR(64)     NOT NULL PRIMARY KEY,
  -- NULL = đăng nhập bằng mật khẩu quản trị
  user_id    INT UNSIGNED NULL,
  expires_at DATETIME(3)  NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_web_session_expires (expires_at),
  CONSTRAINT fk_web_session_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Người nhận cảnh báo + bản tin (IDA câu 1, 5, 9, 24). Bot nhắn riêng cho người này qua Zalo (contact_id).
CREATE TABLE recipient (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id        INT UNSIGNED NOT NULL DEFAULT 1,
  -- Người trên Zalo nhận tin riêng của bot (bắt buộc — không có thì không có kênh báo)
  contact_id       INT UNSIGNED NOT NULL,
  -- Tài khoản web của người này (nếu có) — để màn hình biết «tôi là người nhận nào»
  user_id          INT UNSIGNED NULL,
  name             VARCHAR(150) NOT NULL,
  -- Chức danh hiện trong bản tin, vd «Trưởng phòng DVKH», «CEO», «Trưởng nhóm»
  title            VARCHAR(100) NOT NULL DEFAULT '',
  -- Thứ tự ưu tiên (1 trước) — IDA trả lời «theo thứ tự ưu tiên»
  rank_order       SMALLINT     NOT NULL DEFAULT 1,
  -- 1 = theo dõi mọi nhóm đang đọc; 0 = chỉ các nhóm ở recipient_group
  all_groups       TINYINT(1)   NOT NULL DEFAULT 0,
  -- Giờ gửi bản tin sáng / cuối ngày (HH:MM giờ VN), rỗng = không gửi
  morning_brief_at VARCHAR(5)   NOT NULL DEFAULT '07:30',
  evening_brief_at VARCHAR(5)   NOT NULL DEFAULT '17:30',
  -- Nhận báo ngay tin KHẨN / VIP (kể cả giờ yên lặng)
  notify_urgent    TINYINT(1)   NOT NULL DEFAULT 1,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_recipient_contact (tenant_id, contact_id),
  KEY ix_recipient_rank (tenant_id, rank_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE recipient_group (
  recipient_id INT UNSIGNED NOT NULL,
  group_id     INT UNSIGNED NOT NULL,
  PRIMARY KEY (recipient_id, group_id),
  CONSTRAINT fk_recipient_group_recipient FOREIGN KEY (recipient_id) REFERENCES recipient (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Người VIP của từng người nhận (IDA câu 5: 20–30 người) — tin của họ lên đầu và được báo ngay.
CREATE TABLE recipient_vip (
  recipient_id INT UNSIGNED NOT NULL,
  contact_id   INT UNSIGNED NOT NULL,
  PRIMARY KEY (recipient_id, contact_id),
  CONSTRAINT fk_recipient_vip_recipient FOREIGN KEY (recipient_id) REFERENCES recipient (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nhật ký thao tác: thêm loại thực thể người dùng / người nhận ở tầng mã (cột entity là chuỗi, không đổi lược đồ).
