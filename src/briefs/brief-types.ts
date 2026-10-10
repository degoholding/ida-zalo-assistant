// Kiểu dùng chung giữa bộ gom dữ liệu bản tin / báo cáo (phase 1), soạn chữ + điểm tin AI (phase 2) và xuất báo cáo
// PDF / Excel (phase 3). Chỉ khai kiểu — hàm tính nằm ở brief-scope.ts / brief-period.ts / các bộ gom.

/**
 * Phạm vi nhóm một người nhận được thấy trong bản tin / báo cáo (xem `resolveBriefScope` ở brief-scope.ts).
 * KHÁC phạm vi cảnh báo (`alert-store.ts`): nhóm Mật chỉ vào `groupIds` khi người nhận CHỌN nhóm đó, và không bao giờ
 * vào `aiGroupIds` dù có chọn.
 */
export interface BriefScope {
  /** Mã Zalo người nhận — lọc việc / ticket mà chính họ là người giao / phụ trách / người gửi. */
  uid: string;
  /** Nhóm được đưa vào bản tin (đã bỏ nhóm Mật nếu «mọi nhóm»; gồm cả Mật nếu đã chọn). */
  groupIds: number[];
  /** Nhóm được đưa cho AI — luôn bỏ nhóm Mật, kể cả khi `groupIds` có. */
  aiGroupIds: number[];
  /** «Mọi nhóm» mới thấy việc / ticket không gắn nhóm cụ thể (không có `source_thread_id`). */
  includeUngrouped: boolean;
}

/** Kỳ dữ liệu của một bản tin / báo cáo (xem `briefPeriod` ở brief-period.ts). `to` không bao gồm (nửa khoảng mở). */
export interface BriefPeriod {
  from: Date;
  to: Date;
  /** «2026-10-09» (ngày) · «2026-W41» (tuần ISO) · «2026-09» (tháng) — dùng trong `dedupe_key`. */
  periodKey: string;
  /** Chữ hiển thị: «Ngày 09/10/2026» · «Tuần 41/2026 (05/10–11/10)» · «Tháng 9/2026». */
  periodLabel: string;
  /** Kỳ liền trước, cùng cách tính — để báo cáo tuần / tháng so sánh (phase 3). */
  previous: { from: Date; to: Date };
}

/** Một dòng trong một mục bản tin (tin khẩn, tin chờ, việc, ticket, ứng viên điểm tin AI…). */
export interface BriefLine {
  /** Rỗng = không gắn nhóm cụ thể (tin riêng / việc không giao trong nhóm nào). */
  groupName: string;
  senderName: string;
  at: Date;
  text: string;
  /** Id tin / việc / ticket gốc — để phase 2 dẫn lại (vd mục AI chỉ nhận id có trong lô đã gửi cho mô hình). */
  ref: number;
}

/** Một mục bản tin: tổng số thật (đếm riêng, không bị LIMIT) + top N dòng để hiển thị («… và N nữa»). */
export interface Bucket<T> {
  total: number;
  items: T[];
}

// --- Phase 2 (soạn chữ + điểm tin AI) ---

/** Một ý điểm tin AI đã gắn lại nguồn thật từ DB (xem brief-ai-highlights.ts — không tin chữ nhóm / người / giờ mô hình viết). */
export interface BriefHighlight {
  /** Chữ do mô hình chọn, ≤ 20 chữ (đã cắt phòng hờ). */
  text: string;
  /** Tin gốc — CHỈ nhận khi `id` mô hình trả nằm trong lô ứng viên đã gửi đi. */
  line: BriefLine;
}

/** Một tệp đính kèm bản tin / báo cáo (PDF / Excel, phase 3) — rỗng ở bản tin sáng / cuối ngày. Khớp cột `brief_log.files`. */
export interface BriefLogFile {
  fileName: string;
  storageKey: string;
  bytes: number;
}
