-- Phase 8 (N6) — bản tin sáng / cuối ngày + báo cáo tuần / tháng (IDA câu 24, 25). Nhật ký MỖI LẦN soạn / gửi một dòng,
-- chống gửi trùng khi worker khởi động lại bằng `dedupe_key` (chỉ lượt theo lịch mới có — gọi tay NULL vì không cần
-- chống trùng). Plan: plans/261009-1555-phase-08-briefs-reports/.

CREATE TABLE brief_log (
  id             INT UNSIGNED    NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id      INT UNSIGNED    NOT NULL DEFAULT 1,
  recipient_id   INT UNSIGNED    NOT NULL,
  -- BriefKind ở src/constants.ts (sáng / cuối ngày / tuần / tháng)
  kind           SMALLINT        NOT NULL,
  -- BriefTrigger ở src/constants.ts (theo lịch / câu chat / nút «Gửi thử» trên web)
  trigger_source SMALLINT        NOT NULL,
  -- Kỳ dữ liệu: «2026-10-09» (ngày), «2026-W41» (tuần ISO), «2026-09» (tháng) — xem brief-period.ts
  period_key     VARCHAR(20)     NOT NULL,
  period_label   VARCHAR(80)     NOT NULL DEFAULT '',
  -- BriefStatus ở src/constants.ts
  status         SMALLINT        NOT NULL,
  -- Chống trùng CHỈ cho lượt theo lịch: «r<id>:<kind>:<period_key>» — INSERT IGNORE giành lượt soạn. Gọi tay/nút web
  -- không chống trùng (NULL) vì mỗi lần gọi là một lần xem lại, không phải lượt lịch.
  dedupe_key     VARCHAR(80)     NULL,
  body           MEDIUMTEXT      NULL,
  -- [{fileName, storageKey, bytes}] — báo cáo tuần / tháng kèm PDF + Excel (phase 3)
  files          JSON            NULL,
  -- Vì sao mục điểm tin AI bị bỏ (tắt cài đặt / chưa khóa / chạm trần / lỗi) — rỗng = có điểm tin
  ai_note        VARCHAR(200)    NOT NULL DEFAULT '',
  error          VARCHAR(500)    NOT NULL DEFAULT '',
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at        DATETIME(3)     NULL,
  UNIQUE KEY ux_brief_log_dedupe (dedupe_key),
  KEY ix_brief_log_tenant (tenant_id, created_at),
  KEY ix_brief_log_recipient (recipient_id, kind, created_at),
  CONSTRAINT fk_brief_log_recipient FOREIGN KEY (recipient_id) REFERENCES recipient (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
