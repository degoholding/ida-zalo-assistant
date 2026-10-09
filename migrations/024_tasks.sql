-- Phase 7 (N5) — checklist công việc (IDA câu 22, 23). Việc vào từ lệnh / câu tự nhiên với bot, recap họp, hoặc AI tự bắt
-- câu giao việc trong nhóm (đề xuất, chờ người giao / sếp xác nhận). Bot nhắc người phụ trách 3 mốc (trước hạn 1 ngày làm
-- việc, đúng hạn, quá hạn); quá hạn báo thêm người giao + sếp. Plan: plans/261009-1416-phase-07-checklist/.
--
-- Người phụ trách / người giao là người trên Zalo (contact) — giữ cả mã Zalo để nhắn mà không cần nối bảng; người giao làm
-- trên web không có mã Zalo thì chỉ có tên. Cờ «thiếu người / thiếu hạn» suy ra từ cột NULL, không lưu riêng.

CREATE TABLE task (
  id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id           INT UNSIGNED    NOT NULL DEFAULT 1,
  -- «V-0012»; đặt sau khi có id
  code                VARCHAR(20)     NOT NULL,
  -- TaskStatus / TaskPriority / TaskSource ở src/constants.ts
  status              SMALLINT        NOT NULL,
  priority            SMALLINT        NOT NULL DEFAULT 2,
  title               VARCHAR(300)    NOT NULL,
  assignee_contact_id INT UNSIGNED    NULL,
  assignee_uid        VARCHAR(40)     NULL,
  assignee_name       VARCHAR(255)    NOT NULL DEFAULT '',
  assigner_contact_id INT UNSIGNED    NULL,
  assigner_uid        VARCHAR(40)     NULL,
  assigner_name       VARCHAR(255)    NOT NULL DEFAULT '',
  source              SMALLINT        NOT NULL,
  -- Cuộc + tin nơi việc được giao (nhóm / tin riêng); bot nhắc vào đúng nhóm này, tag người phụ trách
  source_thread_id    INT UNSIGNED    NULL,
  source_message_id   BIGINT UNSIGNED NULL,
  -- Đề xuất của AI: «ai:<id tin>:<thứ tự>» — một câu giao việc chỉ sinh một đề xuất dù lượt AI chạy lại
  dedupe_key          VARCHAR(80)     NULL,
  due_at              DATETIME(3)     NULL,
  -- 0 = hạn chỉ có ngày (nhắc theo giờ vào làm), 1 = hạn có giờ
  due_has_time        TINYINT(1)      NOT NULL DEFAULT 0,
  -- Mốc nhắc đã gửi (TaskRemindStage); dời hạn / mở lại thì về 0
  remind_stage        TINYINT         NOT NULL DEFAULT 0,
  resolution          TEXT            NULL,
  created_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  confirmed_at        DATETIME(3)     NULL,
  closed_at           DATETIME(3)     NULL,
  UNIQUE KEY ux_task_code (tenant_id, code),
  UNIQUE KEY ux_task_dedupe (dedupe_key),
  KEY ix_task_status_due (tenant_id, status, due_at),
  KEY ix_task_assignee (assignee_uid, status),
  KEY ix_task_assigner (assigner_uid, status),
  KEY ix_task_thread (source_thread_id, status),
  -- Lượt AI bắt câu giao việc bỏ tin đã có việc (NOT EXISTS mỗi 5 phút)
  KEY ix_task_source_message (source_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nhật ký: tạo, xác nhận, bỏ, xong, mở lại, dời hạn, giao lại, hủy, ghi chú, nhắc, hết hạn xác nhận (TaskEventKind)
CREATE TABLE task_event (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  task_id    INT UNSIGNED    NOT NULL,
  kind       SMALLINT        NOT NULL,
  actor_name VARCHAR(255)    NOT NULL DEFAULT '',
  -- «zalo» / «web» / «system»
  via        VARCHAR(10)     NOT NULL DEFAULT '',
  note       TEXT            NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_task_event_task (task_id, id),
  CONSTRAINT fk_task_event_task FOREIGN KEY (task_id) REFERENCES task (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
