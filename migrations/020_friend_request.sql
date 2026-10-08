-- 08/10/2026: tab «Kết bạn» ở trang tài khoản bot — nhân sự kết bạn với bot để kéo bot vào nhóm Zalo công việc.
-- Một dòng cho mỗi (bot, người, chiều): gửi lại / nhận lại lời mời thì cập nhật dòng cũ.

CREATE TABLE friend_request (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bot_account_id INT UNSIGNED    NOT NULL,
  -- Mã Zalo của người kia (bot mời họ, hoặc họ mời bot)
  zalo_uid       VARCHAR(40)     NOT NULL,
  display_name   VARCHAR(255)    NOT NULL DEFAULT '',
  avatar_url     VARCHAR(500)    NOT NULL DEFAULT '',
  -- Lời nhắn kèm lời mời
  message        VARCHAR(500)    NOT NULL DEFAULT '',
  -- FriendRequestDirection ở src/constants.ts: 1 = người khác mời bot, 2 = bot mời
  direction      SMALLINT        NOT NULL,
  -- FriendRequestStatus: 0 chờ, 1 đã đồng ý, 2 bị từ chối, 3 đã rút lại
  status         SMALLINT        NOT NULL DEFAULT 0,
  -- Lần gửi / nhận lời mời gần nhất — đếm trần lời mời bot gửi mỗi ngày
  requested_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_friend_request (bot_account_id, zalo_uid, direction),
  KEY ix_friend_request_list (bot_account_id, direction, status, requested_at),
  CONSTRAINT fk_friend_request_bot FOREIGN KEY (bot_account_id) REFERENCES bot_account (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
