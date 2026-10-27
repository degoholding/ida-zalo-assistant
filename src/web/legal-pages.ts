import type http from "node:http";

// Hai trang công khai (không cần đăng nhập) mà màn đồng ý OAuth của Google đòi khi đưa app «ERP Tro ly AI» lên In production
// (27/10/2026): /privacy (chính sách quyền riêng tư) và /terms (điều khoản sử dụng). Nội dung phải khớp đúng những gì bot làm
// với dữ liệu Google — đổi phạm vi OAuth ở `src/google/google-oauth.ts` thì sửa lại mục 2 của trang /privacy.

export const PRIVACY_PATH = "/privacy";
export const TERMS_PATH = "/terms";
const CONTACT_EMAIL = "hgbao.idagroup@gmail.com";
const UPDATED_AT = "27/10/2026";

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Bot trợ lý</title>
<style>
  body { margin: 0; background: #f6f8fb; color: #1f2937; font: 15px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 760px; margin: 32px auto; padding: 32px 36px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; }
  h1 { margin: 0 0 4px; font-size: 24px; color: #0f172a; }
  h2 { margin: 28px 0 8px; font-size: 17px; color: #0f172a; }
  .meta { margin: 0 0 20px; color: #64748b; font-size: 13px; }
  ul { padding-left: 22px; }
  li { margin: 4px 0; }
  a { color: #0284c7; }
  footer { max-width: 760px; margin: 0 auto 32px; padding: 0 36px; color: #94a3b8; font-size: 13px; }
</style>
</head>
<body>
<main>
${body}
</main>
<footer><a href="${PRIVACY_PATH}">Chính sách quyền riêng tư</a> · <a href="${TERMS_PATH}">Điều khoản sử dụng</a></footer>
</body>
</html>`;
}

export const PRIVACY_HTML = page("Chính sách quyền riêng tư", `
<h1>Chính sách quyền riêng tư</h1>
<p class="meta">Privacy Policy · Cập nhật ${UPDATED_AT}</p>

<p><strong>Bot trợ lý</strong> (trang quản trị tại <a href="https://botida.degoholding.vn">botida.degoholding.vn</a>) là công cụ nội bộ
giúp doanh nghiệp lưu trữ, tra cứu và tóm tắt trao đổi công việc trên Zalo, tạo cuộc họp và tóm tắt cuộc họp. Trang này mô tả bot thu
thập dữ liệu gì, dùng vào việc gì và người dùng kiểm soát dữ liệu của mình ra sao.</p>

<h2>1. Dữ liệu bot xử lý</h2>
<ul>
  <li><strong>Tin nhắn và tệp Zalo</strong> trong các nhóm và cuộc trò chuyện mà tài khoản Zalo của bot tham gia, khi quản trị viên
  của doanh nghiệp bật lưu cho nhóm / cuộc trò chuyện đó.</li>
  <li><strong>Tài khoản trang quản trị</strong>: tên đăng nhập, họ tên, email, vai trò.</li>
  <li><strong>Dữ liệu Google</strong> khi quản trị viên chủ động bấm «Kết nối Google» (mục 2).</li>
</ul>

<h2>2. Dữ liệu từ tài khoản Google</h2>
<p>Bot chỉ xin những quyền sau và chỉ dùng đúng cho chức năng tương ứng:</p>
<ul>
  <li><strong>Email và định danh (openid, email)</strong>: biết tài khoản Google nào đã kết nối, hiển thị trên trang Cài đặt.</li>
  <li><strong>Sự kiện lịch (calendar.events)</strong>: tạo, xem và hủy cuộc họp Google Meet khi người dùng yêu cầu bot.</li>
  <li><strong>Đọc tệp Google Drive (drive.readonly)</strong>: tìm và đọc tệp ghi âm / ghi hình cuộc họp Google Meet (thư mục
  «Meet Recordings» / «Ghi âm họp»), khớp với cuộc họp trên lịch, để lập bản tóm tắt cuộc họp gửi lại cho người dùng. Bot không sửa,
  không xóa và không tải lên tệp nào trên Drive.</li>
</ul>
<p>Nội dung ghi âm cuộc họp có thể được gửi tới nhà cung cấp mô hình AI mà doanh nghiệp đã cấu hình (ví dụ Google Gemini) chỉ để
chuyển thành văn bản và tóm tắt cho chính người dùng. Bot không dùng dữ liệu Google để quảng cáo, không bán dữ liệu, và không dùng
dữ liệu đó để huấn luyện mô hình AI.</p>
<p>Việc sử dụng và chuyển giao thông tin nhận được từ Google API tuân thủ
<a href="https://developers.google.com/terms/api-services-user-data-policy">Chính sách dữ liệu người dùng của Google API Services</a>,
bao gồm các yêu cầu về Sử dụng có giới hạn (Limited Use).</p>

<h2>3. Lưu trữ và bảo vệ</h2>
<ul>
  <li>Dữ liệu lưu trên máy chủ và kho lưu trữ của doanh nghiệp sử dụng bot; mã truy cập Google được mã hóa trước khi lưu.</li>
  <li>Chỉ tài khoản quản trị đã đăng nhập và được phân quyền mới xem được dữ liệu; mọi thao tác sửa được ghi lịch sử.</li>
  <li>Tin nhắn được giữ theo thời hạn doanh nghiệp đặt (mặc định 24 tháng), tệp gốc mặc định 6 tháng; quá hạn tự xóa.</li>
</ul>

<h2>4. Chia sẻ dữ liệu</h2>
<p>Bot không chia sẻ dữ liệu cho bên thứ ba, trừ nhà cung cấp hạ tầng (máy chủ, kho lưu trữ) và nhà cung cấp mô hình AI do doanh
nghiệp cấu hình, chỉ trong phạm vi cần để vận hành các chức năng nêu trên, hoặc khi pháp luật yêu cầu.</p>

<h2>5. Quyền của người dùng</h2>
<ul>
  <li>Ngắt kết nối Google bất cứ lúc nào ở trang Cài đặt của bot, hoặc thu hồi quyền tại
  <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>. Khi ngắt, bot xóa mã truy cập đã lưu.</li>
  <li>Yêu cầu xem, sửa hoặc xóa dữ liệu của mình: liên hệ quản trị viên doanh nghiệp hoặc email bên dưới.</li>
</ul>

<h2>6. Liên hệ</h2>
<p>Mọi câu hỏi về quyền riêng tư: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
`);

export const TERMS_HTML = page("Điều khoản sử dụng", `
<h1>Điều khoản sử dụng</h1>
<p class="meta">Terms of Service · Cập nhật ${UPDATED_AT}</p>

<h2>1. Phạm vi</h2>
<p><strong>Bot trợ lý</strong> là công cụ nội bộ dành cho doanh nghiệp đã được cấp tài khoản. Khi đăng nhập trang quản trị hoặc kết
nối tài khoản Google, người dùng đồng ý với các điều khoản này và với <a href="${PRIVACY_PATH}">Chính sách quyền riêng tư</a>.</p>

<h2>2. Tài khoản</h2>
<ul>
  <li>Tài khoản do quản trị viên doanh nghiệp cấp; người dùng giữ bí mật mật khẩu và chịu trách nhiệm về thao tác bằng tài khoản của mình.</li>
  <li>Quản trị viên có quyền khóa tài khoản dùng sai mục đích.</li>
</ul>

<h2>3. Sử dụng đúng mục đích</h2>
<ul>
  <li>Chỉ dùng bot cho công việc của doanh nghiệp; không dùng để thu thập trái phép thông tin cá nhân, gửi tin rác hay nội dung vi phạm pháp luật.</li>
  <li>Doanh nghiệp chịu trách nhiệm thông báo cho thành viên các nhóm Zalo rằng nội dung trao đổi công việc được lưu trữ và xử lý bởi bot.</li>
</ul>

<h2>4. Nội dung do AI tạo</h2>
<p>Bản tóm tắt, câu trả lời và báo cáo do AI tạo có thể chưa chính xác hoặc thiếu sót. Người dùng cần kiểm tra lại trước khi dùng cho
quyết định quan trọng.</p>

<h2>5. Dịch vụ</h2>
<p>Bot được cung cấp theo hiện trạng. Chức năng có thể thay đổi, tạm ngừng để bảo trì, hoặc bị gián đoạn do dịch vụ bên ngoài
(Zalo, Google, nhà cung cấp AI) mà bot không kiểm soát.</p>

<h2>6. Liên hệ</h2>
<p><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
`);

/** Trả trang công khai nếu `path` là /privacy hoặc /terms (GET / HEAD). Trả false để máy chủ xử lý tiếp. */
export function serveLegalPage(path: string, method: string, response: http.ServerResponse): boolean {
  const normalized = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  const html = normalized === PRIVACY_PATH ? PRIVACY_HTML : normalized === TERMS_PATH ? TERMS_HTML : null;
  if (!html || (method !== "GET" && method !== "HEAD")) return false;
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" });
  response.end(method === "HEAD" ? undefined : html);
  return true;
}
