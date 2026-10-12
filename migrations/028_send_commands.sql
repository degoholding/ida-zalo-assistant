-- Phase 9 (N7) — gửi tin theo lệnh (IDA câu 26). Quản lý nhắn bot «gửi nhóm A, anh B: …» → nháp xem trước → «đồng ý» →
-- mỗi nơi nhận một job `SendCommandTarget` (JobKind 6). Mã hiển thị «G-<id>». Dòng web (source = 2) chỉ ghi nhật ký tin
-- quản trị gửi từ màn web. Plan: plans/261012-0854-phase-09-send-on-command/.

CREATE TABLE send_command (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id            INT UNSIGNED    NOT NULL DEFAULT 1,
  -- SendCommandSource ở src/constants.ts (Zalo / Web)
  source               SMALLINT        NOT NULL,
  -- SendCommandStatus ở src/constants.ts
  status               SMALLINT        NOT NULL,
  -- Người ra lệnh (Zalo): liên hệ + mã Zalo; lệnh từ web thì dùng created_by_user_id
  requester_contact_id INT UNSIGNED    NULL,
  requester_uid        VARCHAR(40)     NOT NULL DEFAULT '',
  requester_name       VARCHAR(255)    NOT NULL DEFAULT '',
  created_by_user_id   INT UNSIGNED    NULL,
  bot_account_id       INT UNSIGNED    NULL,
  -- Cuộc riêng nơi ra lệnh — báo kết quả về đây
  source_thread_id     INT UNSIGNED    NULL,
  source_message_id    BIGINT UNSIGNED NULL,
  -- Nội dung nguyên văn (không sửa)
  body                 MEDIUMTEXT      NOT NULL,
  -- [attachment.id] tệp / ảnh người ra lệnh vừa gửi bot (tối đa 5)
  attachment_ids       JSON            NULL,
  -- NULL = gửi ngay
  scheduled_at         DATETIME(3)     NULL,
  -- Cảnh báo giờ yên lặng / ngày nghỉ của giờ hẹn (vẫn cho gửi)
  off_hours_note       VARCHAR(200)    NOT NULL DEFAULT '',
  -- Hạn «đồng ý» của nháp
  confirm_expires_at   DATETIME(3)     NULL,
  confirmed_at         DATETIME(3)     NULL,
  cancelled_at         DATETIME(3)     NULL,
  cancelled_by         VARCHAR(100)    NOT NULL DEFAULT '',
  -- Đã báo kết quả về người ra lệnh
  reported_at          DATETIME(3)     NULL,
  created_at           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_send_command_tenant (tenant_id, created_at),
  KEY ix_send_command_requester (requester_uid, created_at),
  KEY ix_send_command_status (status, scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE send_command_target (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  command_id   BIGINT UNSIGNED NOT NULL,
  -- SendTargetKind ở src/constants.ts (nhóm / người)
  target_kind  SMALLINT        NOT NULL,
  -- «g:<threadId>» | «u:<zaloUid>» — chống trùng nơi nhận trong một lệnh
  target_key   VARCHAR(80)     NOT NULL,
  -- Đúng hình ContactMessagePayload: có cuộc thì threadId, chưa có thì zaloUid
  thread_id    INT UNSIGNED    NULL,
  zalo_uid     VARCHAR(40)     NULL,
  display_name VARCHAR(255)    NOT NULL DEFAULT '',
  -- SendTargetStatus ở src/constants.ts
  status       SMALLINT        NOT NULL,
  -- Số lần xếp job (gửi lại +1) — nằm trong dedupeKey `sendcmd:t<id>:a<lần>`
  attempt_no   SMALLINT        NOT NULL DEFAULT 0,
  job_id       BIGINT UNSIGNED NULL,
  error        VARCHAR(500)    NOT NULL DEFAULT '',
  sent_at      DATETIME(3)     NULL,
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_send_target_key (command_id, target_key),
  KEY ix_send_target_status (status),
  KEY ix_send_target_job (job_id),
  CONSTRAINT fk_send_target_command FOREIGN KEY (command_id) REFERENCES send_command (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
