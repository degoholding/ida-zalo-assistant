-- Phase 9 mở rộng — nhắc hẹn nhóm từ tin riêng. Quản lý nhắn bot «tạo nhắc hẹn nhóm A lúc 8h mai: …» → nháp xem trước → «đồng ý» →
-- mỗi nhóm một job `SendCommandTarget` tạo nhắc hẹn Zalo (thay vì gửi tin). Dùng chung luồng nháp / xác nhận / báo kết quả của
-- lệnh gửi. Plan: plans/261012-1042-dm-group-reminder-and-no-fake-actions/.

ALTER TABLE send_command
  -- SendActionKind ở src/constants.ts: 1 gửi tin · 2 nhắc hẹn Zalo (body = tiêu đề nhắc)
  ADD COLUMN action_kind     SMALLINT    NOT NULL DEFAULT 1 AFTER status,
  -- Giờ nhắc của nhắc hẹn (action_kind = 2); NULL với lệnh gửi tin
  ADD COLUMN reminder_at     DATETIME(3) NULL AFTER scheduled_at,
  -- 0 không lặp · 1 hằng ngày · 2 hằng tuần · 3 hằng tháng (mã của Zalo)
  ADD COLUMN reminder_repeat SMALLINT    NOT NULL DEFAULT 0 AFTER reminder_at;
