-- Phase 10 (N2) — thư viện mẫu tin trả lời (IDA câu 10–12). Nhân viên web soạn → «Chờ duyệt» → Quản trị / Quản lý duyệt;
-- bot CHỈ dùng mẫu «Đã duyệt» để soạn 2–3 bản nháp (số chưa chắc để «[cần bổ sung]»). Plan: plans/261012-1420-phase-10-reply-suggestions-and-metrics/.

CREATE TABLE reply_template (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id        INT UNSIGNED  NOT NULL DEFAULT 1,
  name             VARCHAR(150)  NOT NULL,
  -- Tình huống dùng mẫu (mô tả tự do) + từ khóa cách nhau dấu phẩy — bot chọn mẫu theo hai trường này
  situation        VARCHAR(500)  NOT NULL DEFAULT '',
  keywords         VARCHAR(500)  NOT NULL DEFAULT '',
  -- Nội dung có chỗ trống «[...]» cho số liệu (giá, số lượng, ngày)
  body             TEXT          NOT NULL,
  -- ReplyTone ở src/constants.ts
  tone             SMALLINT      NOT NULL DEFAULT 1,
  -- ReplyTemplateStatus ở src/constants.ts
  status           SMALLINT      NOT NULL DEFAULT 1,
  author_user_id   INT UNSIGNED  NULL,
  author_name      VARCHAR(150)  NOT NULL DEFAULT '',
  reviewer_user_id INT UNSIGNED  NULL,
  reviewer_name    VARCHAR(150)  NOT NULL DEFAULT '',
  -- Ghi chú khi trả lại
  review_note      VARCHAR(500)  NOT NULL DEFAULT '',
  submitted_at     DATETIME(3)   NULL,
  reviewed_at      DATETIME(3)   NULL,
  created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_reply_template_status (tenant_id, status),
  KEY ix_reply_template_author (author_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5 mẫu ví dụ do dev gieo: trạng thái Nháp (1) nên bot chưa dùng; tông Lịch sự (1). IDA sửa rồi gửi duyệt hoặc ngừng dùng.
INSERT INTO reply_template (name, situation, keywords, body, tone, status, author_name) VALUES
('Báo giá sản phẩm', 'Khách hỏi giá, xin báo giá sản phẩm', 'giá, báo giá, bao nhiêu, bảng giá',
 'Dạ em chào anh/chị [tên khách]. Em gửi anh/chị giá [tên sản phẩm] quy cách [quy cách]: [giá] /[đơn vị], áp dụng đến [ngày]. Anh/chị cần thêm thông tin gì em hỗ trợ ngay ạ.', 1, 1, 'Mẫu ví dụ (dev)'),
('Khiếu nại chất lượng', 'Khách phản ánh sản phẩm lỗi, kém chất lượng', 'khiếu nại, lỗi, hỏng, kém, vón, chất lượng',
 'Dạ em rất tiếc về sự cố với lô [số lô] anh/chị phản ánh. Em đã ghi nhận và chuyển bộ phận kỹ thuật kiểm tra, trong [thời hạn] em phản hồi kết quả cho anh/chị. Anh/chị gửi giúp em ảnh bao bì và số lô để xử lý nhanh hơn ạ.', 1, 1, 'Mẫu ví dụ (dev)'),
('Giao hàng trễ', 'Khách hỏi hoặc phàn nàn đơn giao chậm', 'giao trễ, chưa nhận, chậm, khi nào giao',
 'Dạ em xin lỗi anh/chị vì đơn [mã đơn] giao chậm. Em đã kiểm tra với kho, dự kiến hàng tới anh/chị [ngày giao]. Có thay đổi em báo anh/chị ngay ạ.', 1, 1, 'Mẫu ví dụ (dev)'),
('Nhắc công nợ', 'Nhắc khách đối chiếu và thanh toán công nợ', 'công nợ, thanh toán, đối chiếu, nợ',
 'Dạ em chào anh/chị [tên khách]. Em gửi anh/chị đối chiếu công nợ đến [ngày]: còn [số tiền]. Anh/chị sắp xếp thanh toán giúp em trước [hạn] ạ. Cần đối chiếu chi tiết em gửi bảng kê ngay.', 1, 1, 'Mẫu ví dụ (dev)'),
('Cảm ơn đơn hàng', 'Khách vừa chốt hoặc đặt đơn mới', 'cảm ơn, đặt hàng, chốt đơn, đơn mới',
 'Dạ em cảm ơn anh/chị đã đặt đơn [mã đơn]. Em đã chuyển kho chuẩn bị, dự kiến giao [ngày giao]. Có gì cần hỗ trợ anh/chị nhắn em ạ.', 1, 1, 'Mẫu ví dụ (dev)');
