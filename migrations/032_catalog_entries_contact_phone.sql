-- Phase 10 (N3) — danh mục nhân viên / đại lý nạp từ Excel theo mẫu cột (IDA câu 17–18) + số điện thoại ở Danh bạ để khớp
-- danh mục theo SĐT (Zalo không trả SĐT thành viên nhóm nên nhập tay / khớp qua danh mục).

CREATE TABLE catalog_entry (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id        INT UNSIGNED  NOT NULL DEFAULT 1,
  -- CatalogKind ở src/constants.ts (nhân viên / đại lý)
  kind             SMALLINT      NOT NULL,
  code             VARCHAR(40)   NOT NULL,
  name             VARCHAR(200)  NOT NULL,
  -- Đã chuẩn hóa dạng 0xxxxxxxxx
  phone            VARCHAR(20)   NOT NULL DEFAULT '',
  region           VARCHAR(100)  NOT NULL DEFAULT '',
  sales_zone       VARCHAR(100)  NOT NULL DEFAULT '',
  -- Nhân viên: mã người quản lý; đại lý: mã nhân viên phụ trách
  owner_code       VARCHAR(40)   NOT NULL DEFAULT '',
  owner_entry_id   INT UNSIGNED  NULL,
  -- Chức danh, email, cấp đại lý, địa chỉ, tỉnh, ghi chú
  extra            JSON          NULL,
  is_active        TINYINT(1)    NOT NULL DEFAULT 1,
  -- 1 = nhân viên phải báo số hằng ngày
  expects_report   TINYINT(1)    NOT NULL DEFAULT 0,
  -- Liên hệ Zalo đã khớp (mỗi liên hệ tối đa một dòng danh mục)
  contact_id       INT UNSIGNED  NULL,
  -- CatalogMatchStatus ở src/constants.ts
  match_status     SMALLINT      NOT NULL DEFAULT 0,
  -- Ứng viên khi khớp không chắc: [{contactId, name, score}] — quản trị xác nhận
  match_candidates JSON          NULL,
  imported_at      DATETIME(3)   NULL,
  created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_catalog_entry_code (tenant_id, kind, code),
  UNIQUE KEY uq_catalog_entry_contact (contact_id),
  KEY ix_catalog_entry_region (kind, region)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE contact
  ADD COLUMN phone VARCHAR(20) NULL,
  ADD KEY ix_contact_phone (phone);
