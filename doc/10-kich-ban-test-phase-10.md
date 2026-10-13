# 10 — Kịch bản test tay phase 10 (Gợi ý trả lời, số liệu, danh mục NV / ĐL) + ghim từ tin riêng

> Bản 2.0 · 12/10/2026 · thay bản 1.0 cùng ngày (câu chữ chưa khớp mã). Chạy trên prod với **2 tài khoản Zalo** như
> [`09-kich-ban-test-phase-9.md`](09-kich-ban-test-phase-9.md) (dùng lại vai A / B, nhóm G1 / G2 / G3 TEST). Plan:
> [`plans/261012-1420-phase-10-reply-suggestions-and-metrics/`](../plans/261012-1420-phase-10-reply-suggestions-and-metrics/plan.md).
> **Câu chữ chép từ mã** (`src/reply-suggestions/*`, `src/metrics/metric-query-tool.ts`, `src/briefs/brief-metric-*.ts`,
> `src/send-commands/send-pin-*.ts`, `web/src/modules/{reply-templates,metrics,catalog}`). Lượt đi qua AI (câu tự nhiên): câu
> mở đầu của bot có thể khác chữ, nhưng **khối do máy chủ dựng** (gợi ý trả lời, xem trước ghim) là khuôn cố định.

## 0. Vai, quyền web

| Ký hiệu | Như doc 09 | Web |
|---|---|---|
| **A** | Người nhận «mọi nhóm», vai trò Quản lý | Quản trị |
| **B** | Nhân sự, vai trò Trưởng phòng (B2) | Tài khoản web **Nhân viên** (để thử quyền soạn mẫu); một lượt đổi sang **Quản lý** |

| Màn web | Quản trị | Quản lý | Nhân viên |
|---|---|---|---|
| Mẫu tin | Soạn, duyệt, trả lại, ngừng dùng | Soạn, duyệt (cả mẫu mình soạn), trả lại | Soạn, sửa mẫu của mình, gửi duyệt — **không** có Duyệt / Trả lại |
| Số liệu | Xem | Xem, xuất | **Không thấy menu** |
| Nguồn số liệu | Thêm / sửa / đọc thử / đọc ngay / xóa | Không | Không |
| Danh mục NV / ĐL | Tải mẫu, nạp, xác nhận, bỏ gắn | Xem | **Không thấy menu** |

## 1. Sau deploy

| # | Việc | Mong đợi | KQ |
|---|---|---|---|
| P-01 | Log app + worker | Đã chạy `030_reply_templates.sql`, `031_metric_sources_values.sql`, `032_catalog_entries_contact_phone.sql`; worker chạy | |
| P-02 | Cài đặt → Vận hành → việc nền | Có **metrics-sync** (30 phút) và **metrics-close** (18:00); chưa có nguồn thì chạy không lỗi | |
| P-03 | Menu A (quản trị) | Có «Mẫu tin», «Số liệu», «Nguồn số liệu», «Danh mục NV / ĐL» | |
| P-04 | Mẫu tin | 5 mẫu trạng thái **Nháp**: báo giá, khiếu nại chất lượng, giao hàng trễ, nhắc công nợ, cảm ơn đơn hàng; nội dung có chỗ trống «[...]» | |

## 2. Mẫu tin + gợi ý trả lời (N2)

### 2.1 Chưa có mẫu đã duyệt

| # | Ai · ở đâu | Gõ / làm | Mong đợi | KQ |
|---|---|---|---|---|
| R-01 | A · riêng | `gợi ý trả lời tin giá Flowertop của anh Sáu` | `Chưa có mẫu ĐÃ DUYỆT nào trong thư viện nên em chưa soạn gợi ý được. Anh/chị soạn mẫu ở màn Mẫu tin trên web (quản lý duyệt xong em mới dùng).` | |

### 2.2 Luồng duyệt (web)

| # | Ai | Làm | Mong đợi | KQ |
|---|---|---|---|---|
| T-01 | A (quản trị) | Mở mẫu «báo giá» → **Gửi duyệt** → **Duyệt** | Trạng thái Nháp → Chờ duyệt → **Đã duyệt**; Lịch sử thao tác có «Gửi duyệt», «Duyệt» | |
| T-02 | B (web Nhân viên) | Mẫu tin → tạo mẫu mới «Giao hàng đổi» (tình huống / từ khóa, nội dung có «[ngày giao]», tông Thân thiện) → Lưu | Mẫu vào **Chờ duyệt**; B **không** thấy nút Duyệt / Trả lại | |
| T-03 | B (web Nhân viên) | Mở mẫu «báo giá» (A đã duyệt, không phải của B) | Biểu mẫu khóa, **không** có nút Lưu | |
| T-04 | A | Mở mẫu của B → **Trả lại**, để trống ghi chú | Không cho trả lại khi thiếu ghi chú | |
| T-05 | A | **Trả lại** kèm ghi chú «Thêm câu chào» | Trạng thái **Bị trả lại**; ghi chú hiện ở mẫu | |
| T-06 | B | Sửa mẫu theo ghi chú → Lưu / **Gửi duyệt**; A **Duyệt** | Đã duyệt | |
| T-07 | A | Sửa mẫu «báo giá» đã duyệt (đổi một chữ) → Lưu | Quay về **Chờ duyệt** (bot thôi dùng tới khi duyệt lại); duyệt lại | |
| T-08 | A | Một mẫu ví dụ không dùng → **Ngừng dùng** | Danh sách mặc định ẩn mẫu «Ngừng dùng» (lọc trạng thái mới thấy) | |

### 2.3 Gợi ý trả lời (Zalo, tin riêng)

Chuẩn bị: B gõ trong **G2** (nhóm khách, B là Khách hàng như doc 08a, hoặc dùng tin khách thật cũ): `Giá Flowertop đợt này bao nhiêu vậy em? Bao giờ giao được?`

| # | Ai · ở đâu | Gõ | Mong đợi | KQ |
|---|---|---|---|---|
| S-01 | A · riêng | `gợi ý trả lời tin hỏi giá Flowertop trong nhóm TEST ĐL Thành Công` | Tin 1 (khuôn cố định): `GỢI Ý TRẢ LỜI — theo mẫu «…báo giá…»` / `Tin gốc: [TEST ĐL Thành Công · <B> · HH:MM …] «Giá Flowertop…»` / `Em gửi 3 bản nháp ngay dưới, mỗi bản một tin: (1) lịch sự · (2) thân thiện · (3) ngắn gọn — anh/chị bấm giữ để chép rồi tự gửi bằng Zalo của mình. Em KHÔNG gửi đi đâu.` / `Chỗ «[cần bổ sung]» (N chỗ): điền số đúng trước khi gửi.` — rồi **3 tin**, mỗi tin một bản nháp. Giá / ngày giao trong bản nháp là **«[cần bổ sung…]»**, không có con số bịa. **Không** có tin nào đăng vào G2 | |
| S-02 | A · riêng | Chép bản (2), tự gửi vào G2 bằng Zalo của A | Gửi được nguyên văn | |
| S-03 | A · riêng | `soạn giúp anh câu trả lời khách hỏi có xuất hóa đơn đỏ không` | Không mẫu đã duyệt hợp → `Chưa có mẫu ĐÃ DUYỆT hợp tình huống này. Mẫu đang dùng: «…». Anh/chị soạn mẫu mới ở màn Mẫu tin trên web (quản lý duyệt xong em mới dùng).` — bot **không** tự soạn | |
| S-04 | A · riêng | `gợi ý trả lời: khách hỏi Flowertop pha bao nhiêu ml một bình 16 lít` | Nếu có mẫu hợp: liều dùng thành **«[cần kỹ thuật xác nhận]»** và có dòng `Câu hỏi kỹ thuật — cần phòng kỹ thuật xác nhận trước khi trả lời khách.` / `Chỗ «[cần kỹ thuật xác nhận]» (N chỗ): hỏi phòng kỹ thuật trước khi gửi.`; không mẫu hợp → câu từ chối như S-03 | |
| S-05 | A · riêng | `gợi ý trả lời tin mới nhất trong nhóm TEST BGĐ Công nợ` | Nhóm Mật không đưa AI → bot nói không gợi ý được cho nhóm này (không có bản nháp) | |
| S-06 | A · G1 | `@bot gợi ý trả lời tin giá Flowertop` | Trong nhóm không có công cụ gợi ý → không có khối «GỢI Ý TRẢ LỜI»; bot không đăng bản nháp vào nhóm | |
| S-07 | B (B1: không vai trò, không người nhận) · riêng | `gợi ý trả lời tin giá Flowertop` | Bot không trả lời (người lạ chỉ lưu tin) | |

## 3. Số liệu (N3)

### 3.1 Chưa có nguồn

| # | Ai · ở đâu | Gõ | Mong đợi | KQ |
|---|---|---|---|---|
| M-01 | A · riêng | `doanh số tuần này bao nhiêu em` | `Chưa có số liệu từ bảng Drive (đang chờ IDA gửi link bảng).` (bot không bịa số) | |
| M-02 | A · web | Số liệu | 3 tab **Tổng hợp / Chi tiết / Chưa báo**, chưa có dữ liệu | |

### 3.2 Dựng nguồn thử (bảng tự tạo)

1. Tạo Google Sheet, tab `NKCV`, dòng 1: `Ngày | Nhân viên | Khu vực | Doanh số`; vài dòng: `12/10/2026 | Lê Văn Tám | Miền Tây | 1.200.000`,
   `12/10/2026 | Trần Thị Bảy | Miền Đông | 800.000`, `11/10/2026 | Lê Văn Tám | Miền Tây | 1.000.000`, `10/10/2026 | Trần Thị Bảy | Miền Đông | 900.000`.
2. **Chia sẻ quyền xem** bảng cho email service account hiện ở màn «Nguồn số liệu» (cần khóa service account ở Cài đặt → Google).

| # | Ai | Làm | Mong đợi | KQ |
|---|---|---|---|---|
| N-01 | A · web | Nguồn số liệu → **Thêm nguồn số liệu**: tên «BCSale thử», link bảng, tab `NKCV`, dòng tiêu đề 1, «báo hằng ngày» bật, ánh xạ `{"date":"Ngày","staff":"Nhân viên","area":"Khu vực","metrics":[{"code":"doanh_so","label":"Doanh số","column":"Doanh số","unit":"đ","aggregate":"sum"}]}` → **Kiểm tra đọc thử** (chưa lưu) | Hiện tiêu đề cột đọc được, cột khớp, ≤ 10 dòng mẫu; chưa ghi gì vào Số liệu | |
| N-02 | A · web | Đổi ánh xạ `"column":"Doanh thu"` (sai) → Kiểm tra đọc thử | Báo lỗi tại chỗ (cột không khớp tiêu đề), không lưu được số | |
| N-03 | A · web | Sửa lại đúng → Lưu → **Đọc ngay** | Trạng thái nguồn **Đọc tốt**; Số liệu → Chi tiết có 4 dòng | |
| N-04 | A · web | **Đọc ngay** lần nữa | Vẫn 4 dòng (đọc lại không nhân dòng) | |
| N-05 | Bảng | Sửa 1.200.000 → 1.500.000; xóa dòng 10/10; chờ ≤ 30 phút trong giờ làm (hoặc Đọc ngay) | Số đổi; dòng 10/10 biến mất | |
| N-06 | Bảng | Thêm dòng `12/10/2026 | Lê Văn Tám | Miền Tây | -50.000` → Đọc ngay | Dòng đó có cờ **Số âm** | |
| N-07 | Bảng | Dòng 11/10 của Tám đổi 100.000 (lệch > 30% so kỳ trước) → Đọc ngay | Cờ **Lệch quá 30% so kỳ trước** | |
| N-08 | Bảng | Xóa hơn nửa số dòng → chờ lượt tự đọc | Số cũ **giữ nguyên**, cảnh báo «Bảng đọc ra N số, quá ít so với lượt trước (…) — giữ nguyên số cũ, chưa xóa dòng nào. Kiểm tra lại tab / bảng; nếu bảng thật sự đã bớt dòng thì bấm «Đọc ngay» để chấp nhận.» → bấm **Đọc ngay** → dòng đã xóa biến mất. Xóa trắng bảng → Đọc ngay → số cũ vẫn giữ | |
| N-09 | A · riêng | `doanh số tuần này theo khu vực` | Tổng tuần này (T2 → hôm nay), kỳ so = **cùng số ngày tuần trước**, % đổi, dòng Miền Tây / Miền Đông, nguồn «BCSale thử, đọc lúc HH:MM» | |
| N-10 | A · riêng | `doanh số tháng này` · `doanh số tháng trước` | Tháng này = 01 → hôm nay, so 01 → cùng ngày tháng trước; tháng trước = cả tháng, so cả tháng trước nữa | |
| N-11 | A · riêng | `tồn kho tuần này` | `Không khớp chỉ tiêu «tồn kho».` kèm danh sách chỉ tiêu đang có (Doanh số) | |
| N-12 | A · web | Danh mục: nạp NV «Lê Văn Tám» (Phải báo số), «Trần Thị Bảy» (mục 4) → hôm sau 18:15 xem Số liệu → **Chưa báo** | Ai chưa có dòng ngày đó hiện «chưa báo»; nhập sau 18:15 hiện «báo muộn». Trước 18:00 tab không kết luận | |
| N-13 | A · Zalo | Bản tin sáng hôm sau (07:30) | Có mục **«6. Số liệu T2 12/10»** (ngày làm việc trước), dòng `- Doanh số: … (▲/▼N% so T7 10/10)`, dòng `N số cần xác nhận · N NV chưa báo` nếu có | |
| N-14 | A · Zalo | Bản tin cuối ngày (17:30) | Mục **«6. Số liệu hôm nay (tới …)»** chỉ số tuyệt đối + cờ, **không** có % / mũi tên | |
| N-15 | B (web Nhân viên) | Mở `/app/metrics` | Không có menu; vào thẳng URL bị chặn | |

## 4. Danh mục NV / ĐL

| # | Ai | Làm | Mong đợi | KQ |
|---|---|---|---|---|
| C-01 | A · web | Danh mục NV / ĐL → **Tải mẫu Excel** | Tệp có sheet `NhanVien`, `DaiLy`, `Hướng dẫn`; mỗi sheet 2 dòng ví dụ mã `VD-…` | |
| C-02 | A · web | **Nạp tệp** = chính tệp mẫu chưa sửa | 0 mục (dòng `VD-…` bị bỏ qua) | |
| C-03 | A · web | Điền NhanVien: 2 NV thật đúng tên Danh bạ (1 người có SĐT), 1 NV tên lạ; DaiLy: 1 đại lý → Nạp tệp | Đúng tên duy nhất → **Đã khớp**; tên gần giống → **Gợi ý, chờ xác nhận**; tên lạ → **Chưa khớp** | |
| C-04 | A · web | Mở mục «Gợi ý, chờ xác nhận» → chọn liên hệ → Xác nhận | **Đã xác nhận**; Danh bạ của liên hệ hiện Khu vực / Vùng sales / SĐT | |
| C-05 | A · web | Mở mục đã khớp → **Bỏ gắn** → **Khớp lại** | Mục ở **Đã bỏ gắn**, không tự gắn lại; vẫn chọn tay lại được | |
| C-06 | B (web Nhân viên) | Danh bạ | Không thấy cột SĐT, không lọc / tìm theo SĐT | |

## 5. Ghim lên nhóm từ tin riêng

| # | Ai · ở đâu | Gõ | Mong đợi | KQ |
|---|---|---|---|---|
| G-01 | A · riêng | `ghim lên nhóm TEST Sales Miền Tây: Giá Flowertop tuần này 450 nghìn một bao` | `XEM TRƯỚC GHIM G-<n>` / `Ghim lên 1 nhóm:` / `1. Nhóm «TEST Sales Miền Tây» (nội bộ)` / `Nội dung ghim: «…»` / `Nhắn «đồng ý» trong 15 phút để ghim, «hủy» để bỏ.` | |
| G-02 | A · riêng | `okee` | `Đã nhận lệnh G-<n>: ghim lên 1 nhóm. Ghim xong em báo kết quả.` → `KẾT QUẢ GHIM G-<n>: 1/1 nhóm thành công` / `1. nhóm «TEST Sales Miền Tây»: đã ghim`. Trong G1 có **ghi chú ghim** ở đầu nhóm | |
| G-03 | A · riêng | `đồng ý G-<n>` lần hai | `Lệnh G-<n> đã được xác nhận rồi (…)` — không ghim trùng | |
| G-04 | A · riêng | Tạo họp: `tạo cuộc họp Meet "Test ghim họp" lúc <giờ + 1> hôm nay` → `ghim cuộc họp Test ghim họp lên nhóm TEST Sales Miền Tây` → `okee` | Xem trước có `Nội dung ghim: «Cuộc họp: Test ghim họp` / `Lúc: HH:MM T2 12/10` / `Link Google Meet: https://meet.google.com/…»` (máy chủ dựng, đúng link) → G1 có ghi chú ghim. Xong `xóa cuộc họp Test ghim họp` | |
| G-05 | A · riêng | `ghim lên nhóm TEST ĐL Thành Công: thử` · `ghim cho anh <B>: thử` | Nhóm khách: `… là nhóm khách — ghim từ tin riêng chỉ làm cho nhóm nội bộ`; người: `… là một người, không phải nhóm — ghim chỉ làm được cho nhóm.` | |
| G-06 | A · web | Gửi tin → lọc Loại **Ghim** | Lệnh G-<n> hiện với Loại «Ghim» | |

## 6. Đã biết, chưa làm (không tính lỗi)

- Số liệu thật (BCSale, NKCV, BC-Tồn kho, BC-T2), file KPI, danh mục thật, kho tài liệu kỹ thuật: **chờ IDA**; bảng thật có
  thể gộp ô / mỗi NV một tab — xem lại ánh xạ khi có link.
- Danh bạ chưa có SĐT từ Zalo → lần nạp đầu khớp chủ yếu theo tên, nhiều mục «chờ xác nhận».
- Kiểm sau sinh không bắt số viết bằng chữ («hai trăm nghìn»).
- Mục «Đã bỏ gắn» chỉ mở lại khi tệp nạp có SĐT khác (đổi tên thì không).
- Hai quản trị cùng xác nhận một liên hệ có thể ra lỗi 500 thay vì 409; tab «Chưa báo» mặc định hôm nay kể cả ngày nghỉ.
- Bình chọn / bỏ ghim / hủy nhắc hẹn nhóm vẫn phải gọi bot trong nhóm.

## 7. Rút lui

- Tắt đọc số: màn Nguồn số liệu → tắt nguồn (hoặc xóa — xóa kéo theo số đã đọc).
- Gợi ý trả lời: ngừng dùng các mẫu (bot chỉ dùng mẫu Đã duyệt).
- Migration 030–032 chỉ THÊM bảng / cột — triển khai lại bản cũ là đủ.
