import DOMPurify from 'dompurify'

/**
 * Làm sạch HTML trước khi vẽ bằng `dangerouslySetInnerHTML`.
 *
 * ⚠️ **Đây là lớp phòng thủ THỨ HAI, không phải thứ nhất.** Backend đã lọc
 * `content_html` ngay tại cửa ghi (`document/content_sanitize.py`), nhưng lọc ở
 * đó chỉ chặn đường GHI MỚI. Hai thứ vẫn lọt tới trình duyệt:
 *
 *  - **dữ liệu cũ** lưu trước ngày backend bật bộ lọc — đã dựng lại được:
 *    ghi thẳng `<img src=x onerror=...>` vào DB rồi mở trang in thì `onerror`
 *    CHẠY trong phiên người mở (26/08/2026);
 *  - bất kỳ đường ghi nào backend lỡ quên bọc về sau.
 *
 * Người mở bản in thường là cấp trên đi duyệt, nên một lỗ ở đây là chiếm phiên
 * của đúng người có quyền cao nhất. Vẽ HTML từ máy chủ mà không lọc lại ở đây
 * là đặt cược rằng backend không bao giờ sót — cái giá của cược sai quá đắt.
 *
 * DOMPurify là bộ lọc chuẩn ngành: bỏ mọi handler `on*`, chặn `javascript:` /
 * `data:` (trừ ảnh), gỡ `<script>` / `<iframe srcdoc>`... Giữ thẻ định dạng và
 * bảng nên bản in không đổi hình.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    //  Ảnh dán inline của trình soạn thảo là `data:image/...` — giữ lại, còn
    //  `data:text/html` (đường lách XSS) vẫn bị DOMPurify chặn theo mặc định.
    ADD_ATTR: ['target'],
  })
}
