// Sơn bảng màu đã chọn TRƯỚC khi gói JS tải xong — không thì mỗi lần mở trang lóe một nhịp màu mặc định
// rồi mới nhảy sang bảng màu đã chọn. Để ở tệp riêng (không nhúng trong index.html) vì CSP của máy chủ
// chỉ cho chạy script từ tệp (`script-src 'self'`) — script nhúng bị trình duyệt chặn.
// Khóa và id dưới đây phải trùng `storageKeys.themeCss` (core/config/app-config.ts) và
// `THEME_STYLE_ELEMENT_ID` (shared/theme/apply-theme.ts).
try {
  var themeCss = localStorage.getItem('bot.theme_css')
  if (themeCss) {
    var themeStyle = document.createElement('style')
    themeStyle.id = 'erp-theme-preset'
    themeStyle.textContent = themeCss
    document.head.appendChild(themeStyle)
  }
} catch {
  // localStorage bị chặn (chế độ riêng tư) — để app tự sơn sau khi tải
}
