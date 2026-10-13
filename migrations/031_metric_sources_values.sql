-- Phase 10 (N3) — khung số liệu: đọc bảng Google Sheets định kỳ (IDA câu 13–18). Nguồn (link, tab, ánh xạ cột) cấu hình trên
-- web; số lưu DẠNG DÀI (1 dòng = ngày × nhân viên × khu vực × chỉ tiêu) để IDA thêm cột không phải sửa bảng.

CREATE TABLE metric_source (
  id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id          INT UNSIGNED  NOT NULL DEFAULT 1,
  name               VARCHAR(150)  NOT NULL,
  spreadsheet_id     VARCHAR(80)   NOT NULL DEFAULT '',
  sheet_title        VARCHAR(150)  NOT NULL DEFAULT '',
  header_row         SMALLINT      NOT NULL DEFAULT 1,
  -- Ánh xạ cột → ngày / nhân viên / khu vực / chỉ tiêu (hình ở phase 4)
  mapping            JSON          NULL,
  -- 1 = bảng báo hằng ngày: tính «chưa báo» sau 18:00 ngày làm việc
  daily_report       TINYINT(1)    NOT NULL DEFAULT 0,
  is_active          TINYINT(1)    NOT NULL DEFAULT 1,
  -- MetricSourceStatus ở src/constants.ts
  status             SMALLINT      NOT NULL DEFAULT 0,
  last_sync_at       DATETIME(3)   NULL,
  last_ok_at         DATETIME(3)   NULL,
  last_error         VARCHAR(500)  NOT NULL DEFAULT '',
  last_row_count     INT           NOT NULL DEFAULT 0,
  last_warning_count INT           NOT NULL DEFAULT 0,
  -- Tối đa 20 câu cảnh báo theo dòng của lượt đọc gần nhất
  last_warnings      JSON          NULL,
  -- Khóa đọc: chống việc nền và nút «Đọc ngay» chạy trùng
  sync_started_at    DATETIME(3)   NULL,
  created_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_metric_source_tenant (tenant_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE metric_value (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_id        INT UNSIGNED    NOT NULL,
  metric_date      DATE            NOT NULL,
  -- «e:<catalog id>» (khớp danh mục) | «n:<tên gấp dấu>» (chỉ có tên trong bảng)
  staff_key        VARCHAR(80)     NOT NULL,
  staff_name       VARCHAR(150)    NOT NULL DEFAULT '',
  catalog_entry_id INT UNSIGNED    NULL,
  area_key         VARCHAR(80)     NOT NULL DEFAULT '',
  area_name        VARCHAR(150)    NOT NULL DEFAULT '',
  -- Mã chỉ tiêu do cấu hình ánh xạ đặt
  metric_code      VARCHAR(40)     NOT NULL,
  value            DECIMAL(18,2)   NULL,
  -- Chữ gốc trong ô (khi không đọc được thành số vẫn giữ để đối chiếu)
  raw_text         VARCHAR(100)    NOT NULL DEFAULT '',
  -- Bit MetricFlag ở src/constants.ts
  flags            SMALLINT        NOT NULL DEFAULT 0,
  sheet_row        INT             NOT NULL DEFAULT 0,
  -- Giờ bot thấy dòng lần đầu — tính «báo muộn»
  first_seen_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- Lượt đọc gần nhất còn thấy dòng — dòng đã xóa trên bảng thì seen_at cũ đi và bị dọn
  seen_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_metric_value_cell (source_id, metric_date, staff_key, area_key, metric_code),
  KEY ix_metric_value_date_code (metric_date, metric_code),
  KEY ix_metric_value_entry (catalog_entry_id, metric_date),
  CONSTRAINT fk_metric_value_source FOREIGN KEY (source_id) REFERENCES metric_source (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
