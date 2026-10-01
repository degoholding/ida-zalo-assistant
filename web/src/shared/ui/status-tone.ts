/**
 * Bảng màu trạng thái dùng chung cho MỌI phân hệ.
 *
 * Nhóm theo Ý NGHĨA chứ không theo từng mã: mỗi loại chứng từ có bộ mã riêng
 * nhưng người đọc chỉ cần phân biệt vài tình huống — trung tính, đang chờ, đang
 * chạy, đã xong, bị chặn.
 *
 * Trước đây khai riêng trong `procurement/components/document-status-badge.tsx`.
 * Tách ra khi phân hệ Tài chính cần đúng bảng này: chép sang là hai phân hệ lệch
 * màu nhau từ lần sửa đầu tiên, mà người dùng đọc "vàng = đang chờ" theo thói
 * quen chứ không đọc tên phân hệ.
 *
 * bao-CR-363 (10/09/2026): thêm 5 tông. Năm tông đầu quá ÍT cho chuỗi mua hàng —
 * `dispatched` · `purchased` · `completed` · `received` đều rơi vào `done`, còn
 * `submitted` · `rejected` · `processing` · `purchasing` đều rơi vào `pending`,
 * nên trên màn danh sách hai phiếu ở hai mốc khác hẳn nhau nhìn ra y hệt. Khách
 * báo lỗi này trên prod (ticket 38), bản v1 đã vá cùng ngày.
 *
 * ⚠️ Luật khi thêm tông mới: một mốc và mốc LIỀN KỀ nó trong vòng đời phải xa
 * nhau trên vòng màu. Thêm tông na ná tông đã có là quay lại đúng lỗi này.
 *
 * ⚠️ bao-CR-366 (11/09/2026): NỀN NHẠT, CHỮ ĐẬM — đợt "tô đặc + chữ trắng" của
 * CR-363 đã bị BỎ. Khách xem bản tô đặc rồi báo nhìn quá nặng, muốn về đúng kiểu
 * cũ và chỉ giữ phần THÊM MÀU cho các mốc mới. Nên `STATUS_TONE` bên dưới giữ
 * nguyên cách xếp 10 tông của CR-363, chỉ bảng lớp CSS này quay về nền nhạt.
 * Đừng "tô đậm cho nổi" lần nữa — đó là thứ vừa phải gỡ ra.
 *
 * ⚠️ Năm tông cũ dùng token ngữ nghĩa (`bg-warning/10 text-warning`) nên tự chạy
 * được cả chế độ tối. Năm tông mới chưa có token riêng nên dùng thang màu
 * Tailwind bậc 100/700 khớp đúng hex của bản v1 (`frontend/src/index.css`, các
 * lớp `.badge.*`) để hai bản không lệch màu.
 */
export const TONE_CLASS = {
  /** Xám — chưa vào luồng (nháp). */
  neutral: 'bg-muted text-muted-foreground',
  /** Hổ phách — đang NẰM CHỜ người khác nhận (chờ duyệt). */
  pending: 'bg-warning/10 text-warning',
  /** Xanh dương — đã qua cửa duyệt, đang chạy tiếp. */
  progress: 'bg-info/10 text-info',
  /** Xanh lá — đã xong khâu đó. */
  done: 'bg-success/10 text-success',
  /** Đỏ — mốc KHÓA (từ chối, hủy). */
  danger: 'bg-destructive/10 text-destructive',
  /** Tím — đã giao việc cho người khác làm tiếp (điều phối). */
  handoff: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  /** Hồng sen — đang chạy thật, có người đang làm; khác `pending` là "nằm chờ ai đó nhận". */
  active: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  /** Xanh mòng — xong MỘT PHẦN: có kết quả nhưng chưa phủ hết (nhận một phần, mua một phần). */
  partial: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  /**
   * Cam — bị trả lại để sửa. Cố ý KHÔNG dùng `danger`: đỏ là mốc khóa phiếu (từ chối),
   * còn trả lại thì sửa rồi gửi duyệt lại được — hai thứ đó không được nhìn giống nhau.
   */
  returned: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  /**
   * Xanh lá ĐẬM NHẤT — mốc CUỐI, phiếu đã đóng. Chữ đậm hơn `done` hẳn một quãng vì hai
   * mốc này đứng liền nhau trong vòng đời (Đã mua hàng → Hoàn thành) nên phải khác nhau,
   * mà đổi sang hẳn màu khác thì mất nghĩa "xong". Càng về cuối chữ càng đậm là cách
   * phân biệt đọc được ngay mà không phải tô đặc cả ô.
   */
  closed: 'bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-200',
} as const

export type StatusTone = keyof typeof TONE_CLASS
