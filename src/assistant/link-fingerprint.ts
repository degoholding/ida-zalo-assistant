// Phần nhận dạng của link để so với tin nhắn (công cụ read_link): id tệp Google Docs / Drive, hoặc máy + đường dẫn + chuỗi truy vấn. Hàm thuần —
// dùng chung cho lõi (`link_shared_check`) và phía trợ lý (link có ngay trong câu hỏi thì khỏi tra tin).
//
// - Google Docs / Drive: chỉ lấy id (tham số `usp=sharing`… đổi tự do); `link-reader` dựng lại URL tải từ id nên phần còn lại của link không tới được máy chủ.
// - Máy khác: nhận dạng gồm cả chuỗi truy vấn — nếu không, mô hình lấy một link có trong tin rồi thêm `?dữ_liệu_nội_bộ` vào cuối vẫn «khớp» và bị tải đi.

/** Đúng tên miền `domain` hoặc tên miền con của nó (không khớp `evilgoogle.com`, `google.com.evil.io`). */
export function isHostOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

// Chỉ hai máy mà link-reader dựng lại URL tải từ id
const GOOGLE_FILE_HOSTS = new Set(["docs.google.com", "drive.google.com"]);

export function linkFingerprint(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const hostname = url.hostname.toLowerCase();
    const googleId = /\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1];
    if (googleId && isHostOrSubdomain(hostname, "google.com") && GOOGLE_FILE_HOSTS.has(hostname)) return googleId;
    // Có truy vấn: giữ nguyên đường dẫn (kể cả «/» cuối) để khớp đúng chữ trong tin; không có: bỏ «/» cuối như trước
    return url.search ? `${hostname}${url.pathname}${url.search}` : `${hostname}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}
