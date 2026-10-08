-- 08/10/2026: báo ticket qua bot (đại ca chốt: việc chung của IDA, chỉ trong bot, không nối ERP). Nhân viên nhắn bot
-- «báo lỗi: …» (kèm ảnh) trong tin riêng hoặc gọi bot trong nhóm → có ticket; bot nhắn Zalo cho những người xử lý; người
-- xử lý «nhận T-12» / «xong T-12 …» trên Zalo hoặc trên web; bot báo lại người gửi ở đúng chỗ họ đã báo.

CREATE TABLE ticket (
  id                   INT UNSIGNED    NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id            INT UNSIGNED    NOT NULL DEFAULT 1,
  -- «T-0012»; đặt sau khi có id
  code                 VARCHAR(20)     NOT NULL,
  -- TicketStatus ở src/constants.ts
  status               SMALLINT        NOT NULL DEFAULT 1,
  title                VARCHAR(200)    NOT NULL,
  body                 TEXT            NULL,
  requester_contact_id INT UNSIGNED    NULL,
  requester_uid        VARCHAR(40)     NOT NULL,
  requester_name       VARCHAR(255)    NOT NULL DEFAULT '',
  -- Cuộc nơi người gửi báo (tin riêng hoặc nhóm) — bot báo lại vào đúng cuộc này
  source_thread_id     INT UNSIGNED    NULL,
  source_message_id    BIGINT UNSIGNED NULL,
  bot_account_id       INT UNSIGNED    NULL,
  handler_contact_id   INT UNSIGNED    NULL,
  handler_name         VARCHAR(255)    NOT NULL DEFAULT '',
  resolution           TEXT            NULL,
  created_at           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  accepted_at          DATETIME(3)     NULL,
  closed_at            DATETIME(3)     NULL,
  UNIQUE KEY ux_ticket_code (tenant_id, code),
  KEY ix_ticket_status (tenant_id, status, created_at),
  KEY ix_ticket_requester (requester_uid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ảnh / tệp người gửi kèm (tệp đã có trong bảng attachment — bot lưu như mọi tin)
CREATE TABLE ticket_attachment (
  ticket_id     INT UNSIGNED    NOT NULL,
  attachment_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (ticket_id, attachment_id),
  CONSTRAINT fk_ticket_attachment_ticket FOREIGN KEY (ticket_id) REFERENCES ticket (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nhật ký: tạo, nhận, bổ sung, xong, hủy, mở lại (TicketEventKind)
CREATE TABLE ticket_event (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id  INT UNSIGNED    NOT NULL,
  kind       SMALLINT        NOT NULL,
  actor_name VARCHAR(255)    NOT NULL DEFAULT '',
  -- «zalo» / «web»
  via        VARCHAR(10)     NOT NULL DEFAULT '',
  note       TEXT            NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_ticket_event_ticket (ticket_id, id),
  CONSTRAINT fk_ticket_event_ticket FOREIGN KEY (ticket_id) REFERENCES ticket (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Người xử lý ticket: nhận tin báo ticket mới qua Zalo, được «nhận / xong / hủy» trên Zalo
CREATE TABLE ticket_handler (
  tenant_id  INT UNSIGNED NOT NULL DEFAULT 1,
  contact_id INT UNSIGNED NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, contact_id),
  CONSTRAINT fk_ticket_handler_contact FOREIGN KEY (contact_id) REFERENCES contact (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
