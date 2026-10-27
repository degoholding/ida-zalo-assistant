# 12 — Nối ứng dụng AI (claude.ai, ChatGPT, Claude Desktop) vào Bot trợ lý

> Bản 1.0 · 27/10/2026 · dành cho Quản trị / Quản lý (sếp IDA). Nhân viên không dùng được cổng này.

Sau khi nối, anh/chị hỏi thẳng ứng dụng AI quen dùng, ví dụ *tuần này nhóm Kho HN có việc gì quá hạn*, *tóm tắt trao đổi với
anh Minh từ thứ hai*, *tìm tệp báo giá phân bón gửi tháng trước*. AI đọc dữ liệu của bot **đúng theo quyền tài khoản web của
anh/chị**: nhóm nào không được xem thì AI cũng không thấy; nhóm Mật chỉ khi tài khoản được xem Mật **và** lúc cho phép có tick
*Gồm cả nhóm Mật*.

Địa chỉ cổng: **`https://botida.degoholding.vn/mcp`**

## Tệp đính kèm

AI đọc được chữ trong Excel, Word, CSV, txt (đã che số điện thoại, số tài khoản, CCCD như mọi câu trả lời). Ảnh và PDF: AI nhận
**tệp gốc** để tự xem. Đây là **ngoại lệ** của luật che dữ liệu cá nhân (đại ca chốt 27/10/2026): số điện thoại, số tài khoản, CCCD
có trong ảnh / PDF **không được che** — chỉ dùng cho việc nội bộ. Quản trị tắt được (MCP_FILE_RAW=false), khi đó AI chỉ nhận chữ bot đã
bóc sẵn. Ghi âm và video AI không nghe / xem được.

## Trước khi nối

- Có tài khoản trang quản trị bot (https://botida.degoholding.vn/app) với vai trò **Quản trị** hoặc **Quản lý**.
- Đăng nhập sẵn trang quản trị bot trên **cùng trình duyệt** sẽ dùng để nối (đỡ phải đăng nhập giữa chừng).

## claude.ai (web, gói Pro / Max / Team / Enterprise)

1. Vào **Settings → Connectors** (hoặc **Customize → Connectors**), bấm **Add custom connector**.
2. Tên: *Bot trợ lý IDA*. URL: `https://botida.degoholding.vn/mcp`. Bấm **Add**, rồi **Connect**.
3. Trang **Cho phép ứng dụng AI truy cập bot?** của bot mở ra: chọn mức quyền (thường để *Chỉ đọc*), bấm **Cho phép**.
4. Quay lại claude.ai, trong cuộc trò chuyện bật connector vừa thêm ở nút công cụ.

Connector thêm trên claude.ai tự có trên ứng dụng Claude Desktop và điện thoại cùng tài khoản.

## ChatGPT (gói Plus / Pro / Business, bật chế độ nhà phát triển)

1. **Settings → Apps & Connectors → Advanced**, bật **Developer mode**.
2. **Settings → Apps & Connectors → Create**: tên *Bot trợ lý IDA*, MCP Server URL `https://botida.degoholding.vn/mcp`,
   Authentication **OAuth**, tick xác nhận tin tưởng ứng dụng, bấm **Create**.
3. Trang Cho phép của bot mở ra: chọn mức quyền, bấm **Cho phép**.
4. Trong cuộc trò chuyện mới, chọn connector ở nút **+** trước khi hỏi.

## Claude Desktop / Claude Code dùng khóa (khi không muốn đăng nhập)

1. Trang quản trị bot → **Khóa MCP** → **Tạo khóa**. Khóa chỉ hiện **một lần**, chép ngay.
2. Hộp thoại tạo khóa có sẵn lệnh cho Claude Code và mẫu cấu hình Claude Desktop, khóa đã điền sẵn.

## Các câu hỏi thường gặp

| Gặp | Làm |
|---|---|
| claude.ai / ChatGPT cảnh báo connector tự thêm chưa được họ kiểm duyệt | Bình thường với công cụ nội bộ: xác nhận để tiếp tục |
| Trang Cho phép báo *chưa đăng nhập* | Bấm *Mở trang đăng nhập*, đăng nhập xong quay lại tab cũ bấm **Cho phép** lần nữa |
| Trang Cho phép báo tài khoản không được nối | Tài khoản là Nhân viên. Nhờ quản trị đổi vai trò nếu cần |
| Trang Cho phép có ô đỏ *không phải ứng dụng AI quen* | Chỉ cho phép khi chính anh/chị vừa bấm kết nối từ ứng dụng đó; nghi ngờ thì bấm **Từ chối** |
| AI không thấy một nhóm | Nhóm ngoài phạm vi tài khoản, hoặc là nhóm Mật mà lúc cho phép không tick *Gồm cả nhóm Mật* — nối lại để chọn lại |

## Thu hồi, hạn dùng

- Mỗi lần bấm Cho phép tạo một **kết nối** hiện ở màn **Khóa MCP**, loại *Kết nối OAuth*, tên *Qua Claude* / *Qua ChatGPT*.
- Bấm **Thu hồi** là ứng dụng mất quyền ngay. Mọi lượt AI gọi đều ghi nhật ký, xem ở chi tiết kết nối.
- Kết nối sống **90 ngày**, ứng dụng tự làm mới trong thời hạn đó; hết hạn thì bấm Connect lại.
- Nối lại cùng một ứng dụng thì kết nối cũ tự bị thu hồi.
