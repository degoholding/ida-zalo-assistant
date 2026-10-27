# Tài khoản nghe (Zalo cá nhân) chạy cùng bot Trợ lý

Bản 27/10/2026. Đọc khi định gắn một tài khoản Zalo cá nhân vào bot chỉ để thu tin.

## 1. Hai loại tài khoản

- **Trợ lý** (loại 0): đọc, trả lời, báo, gửi tin.
- **Chỉ thu thập** (loại 1), gọi tắt là tài khoản nghe: chỉ lưu tin, thành viên, tệp. Không bao giờ gửi gì lên Zalo.

## 2. Tài khoản nghe mặc định đọc hết

- **Mọi nhóm** tài khoản nghe thấy lần đầu đều bật đọc: nhóm nội bộ lẫn nhóm khách hàng. Không phụ thuộc cài đặt *Đọc tin nhóm mới*.
- **Mọi chat riêng 1-1** cũng bật đọc. Nghĩa là **chat riêng của chủ tài khoản với bất kỳ ai đều vào kho**, kèm tên người đó trong Danh bạ.
- Tệp đính kèm: tải về hay không vẫn theo cài đặt *Lấy file*.
- Chỉ áp cho cuộc trò chuyện **mới**. Nhóm đã có trong kho từ trước (ví dụ bot Trợ lý thấy trước và để tắt đọc) giữ nguyên, phải bật tay.

## 3. Cách tắt

- **Một nhóm:** màn Nhóm, mở nhóm, bỏ tick *Đọc tin*. Đường API: `PATCH /api/groups/:id` với `read_messages: false`.
- **Một cuộc chat riêng:** đường API `PATCH /api/conversations/:id` với `read_messages: false` (hoặc `capture_files: false` để chỉ thôi tải tệp). Chỉ quản trị được gọi.
- Tắt đọc chỉ chặn tin **từ lúc tắt**. Tin đã lưu trước đó vẫn còn trong kho.

## 4. Luồng tin khi hai tài khoản cùng ở một nhóm

1. Có người nhắn trong nhóm. Zalo đẩy tin đó tới **cả hai** tài khoản.
2. Mỗi nhóm Zalo chỉ có **một** dòng nhóm trong kho, dùng chung cho mọi tài khoản. Bật / tắt đọc là bật / tắt cho nhóm đó, không riêng tài khoản nào.
3. Tài khoản nào nhận trước thì ghi tin. Tài khoản tới sau thấy trùng mã tin trong cùng nhóm nên bỏ qua. Mỗi tin lưu đúng một lần, tệp đính kèm cũng tải một lần.
4. Chỉ tài khoản Trợ lý xét chuyện trả lời, cảnh báo, bắt việc. Tài khoản nghe lưu xong là thôi.
5. Tài khoản Trợ lý mất phiên thì tài khoản nghe vẫn lưu tiếp, kho không bị hụt tin.

Chat riêng thì khác: mỗi tài khoản có cuộc riêng của mình, không gộp với tài khoản kia.

| Nhóm có | Lưu tin | Trả lời, cảnh báo, bắt việc, bản tin |
|---|---|---|
| Chỉ Trợ lý | Có (nếu bật đọc) | Có |
| Trợ lý và tài khoản nghe | Có, một lần | Có |
| Chỉ tài khoản nghe | Có (mặc định bật đọc) | Không (đang chờ chốt, xem mục 6) |

## 5. Rủi ro

- **Bị đá phiên (mã 3003, đã gặp 02/10/2026).** Bot đăng nhập như một phiên Zalo Web. Chủ tài khoản mở Zalo Web ở trình duyệt khác thì phiên của bot bị đá, phải quét QR lại. Chủ tài khoản nên dùng app Zalo trên điện thoại hoặc máy tính, không mở Zalo Web.
- **Có thể bị khóa tài khoản.** Thư viện zca-js không phải của Zalo. Zalo có thể coi đó là đăng nhập bất thường và khóa tài khoản cá nhân. Chỉ dùng tài khoản mà chủ chấp nhận rủi ro này.
- **Lộ chuyện riêng.** Mặc định bot lưu cả chat riêng của chủ tài khoản. Cần nói rõ với chủ tài khoản trước khi quét QR, và tắt những cuộc không liên quan công việc.

## 6. Việc còn chờ chốt

Nhóm chỉ có tài khoản nghe hiện bị bỏ khỏi cảnh báo, bắt việc và bản tin. Giữ như vậy hay không do người chủ chốt.
