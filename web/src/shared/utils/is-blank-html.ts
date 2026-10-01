/**
 * Đoạn HTML này có thực sự RỖNG với mắt người đọc không.
 *
 * Cần vì trình soạn thảo rỗng KHÔNG trả về chuỗi rỗng: Tiptap luôn giữ ít nhất
 * một đoạn văn, nên ô chưa gõ gì vẫn ra `<p></p>`. Kiểm bằng `html.trim()` là
 * chuỗi đó luôn "có nội dung" — nút Lưu sáng lên và người dùng tạo được một bản
 * ghi rỗng ruột.
 *
 * Coi là RỖNG khi bỏ hết thẻ đi thì không còn chữ nào. Nhưng ảnh và bảng thì
 * tính là CÓ nội dung dù chẳng có chữ nào — một bản trích chỉ gồm bảng phụ cấp
 * là chuyện bình thường, chặn lại là chặn nhầm.
 */
export function isBlankHtml(html: string | null | undefined): boolean {
  if (!html) return true

  //  Mấy thẻ mang nội dung mà không mang chữ. Có một cái là không rỗng.
  if (/<(img|table|hr|video|iframe)\b/i.test(html)) return false

  const plainText = html
    //  `<br>` và hết một khối đều là xuống dòng — đổi thành khoảng trắng để
    //  `<p>a</p><p>b</p>` không dính thành "ab".
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    //  Khoảng trắng cứng: trình soạn thảo hay chèn khi người dùng gõ dấu cách ở
    //  cuối dòng. Nhìn bằng mắt vẫn là ô trống.
    .replace(/&nbsp;/gi, ' ')
    .trim()

  return plainText.length === 0
}
