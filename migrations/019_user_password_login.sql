-- 08/10/2026: bỏ mật khẩu quản trị chung (ADMIN_PASSWORD) — mỗi người đăng nhập bằng TÊN ĐĂNG NHẬP + MẬT KHẨU của riêng
-- mình (hoặc nút Google theo email). Đại ca chốt: tài khoản IDA lấy email ở ERP, tên đăng nhập = email; thêm tài khoản
-- «admin» quyền cao nhất.

ALTER TABLE app_user
  -- Người chỉ có tên đăng nhập (vd «admin») thì không có email — email chỉ cần cho nút Google
  MODIFY COLUMN email VARCHAR(191) NULL,
  ADD COLUMN username      VARCHAR(100) NULL AFTER email,
  -- Băm scrypt «scrypt$N$r$p$muối$băm» (src/auth/password.ts); NULL = chỉ đăng nhập bằng Google
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER username,
  ADD UNIQUE KEY ux_app_user_username (username);

-- Phiên của mật khẩu quản trị cũ (user_id NULL) không còn hợp lệ
DELETE FROM web_session WHERE user_id IS NULL;
