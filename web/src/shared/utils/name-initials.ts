/**
 * Hai chữ cái CUỐI của tên ("Nguyễn Văn An" → "VA") cho `AvatarFallback`.
 *
 * ⚠️ Lấy từ cuối vì tên người Việt xếp họ trước: hai chữ đầu của "Nguyễn Văn
 * An" là "NV" — trùng nhau ở phần lớn nhân sự công ty, tức là không phân biệt
 * được ai với ai, đúng việc duy nhất mà chữ viết tắt trên ảnh đại diện phải làm.
 *
 * ⚠️ Đặt ở `shared/` chứ không trong một phân hệ (trước đây là
 * `modules/forum/utils/author-initials.ts`): diễn đàn, danh mục Chức vụ và mọi
 * chỗ xếp chồng ảnh đại diện về sau đều cần đúng một luật viết tắt. Hai bản chép
 * là hai kiểu viết tắt cho cùng một người ở hai màn hình.
 */
export function nameInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      //  ⚠️ Bỏ mẩu KHÔNG mở đầu bằng chữ cái. Hồ sơ hay mang đuôi chú thích
      //  trong ngoặc ("Trưởng phòng Thu mua (Demo)"), mà hai từ cuối lúc đó là
      //  ["mua", "(Demo)"] nên vòng tròn hiện ra «M(» — đọc như một lỗi hiển
      //  thị chứ không như tên viết tắt. Cùng lý do `departmentInitials` chặn
      //  tên mở đầu bằng "(".
      .filter((part) => /^\p{L}/u.test(part))
      .slice(-2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
}

//  Tiền tố loại đơn vị — bỏ đi trước khi lấy chữ viết tắt, vì gần như phòng nào
//  cũng có và giữ lại thì mọi vòng tròn đều bắt đầu bằng chữ «P».
const ORG_UNIT_PREFIX = /^(phòng|ban|bộ phận|trung tâm|chi nhánh|khối|tổ)\s+/i

/**
 * Chữ viết tắt của một PHÒNG BAN ("Phòng Hành chính" → "HC").
 *
 * ⚠️ Lấy hai từ **ĐẦU**, ngược với `nameInitials` (lấy hai từ cuối) — và đó
 * không phải bất nhất. Tên người Việt xếp họ trước tên nên phần phân biệt nằm ở
 * cuối; tên phòng ban thì đọc xuôi, phần phân biệt nằm ngay đầu: "Công nghệ
 * thông tin" phải ra "CN", lấy hai từ cuối thì thành "TT" — trùng với "Truyền
 * thông" và mọi phòng khác kết thúc bằng hai chữ đó.
 *
 * Tên trong ngoặc (vd "(Chưa gắn phòng ban)" — nhóm giả cho hồ sơ chưa có
 * phòng) trả về dấu «—»: viết tắt một câu phủ định thành hai chữ cái thì đọc ra
 * như tên một phòng có thật.
 */
export function departmentInitials(name: string): string {
  const text = name.trim()
  if (!text) return '?'
  if (text.startsWith('(')) return '—'

  return (
    text
      .replace(ORG_UNIT_PREFIX, '')
      .split(/[\s-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
}
