/** Hằng số cấu hình ứng dụng — không phụ thuộc môi trường. */

export const appConfig = {
  /** Khóa lưu trong localStorage. Gom một chỗ để tránh gõ sai chuỗi. */
  storageKeys: {
            user: 'bot.user',
  },
  /**
   * Trung tâm Hướng dẫn sử dụng là APP RIÊNG (thư mục `help-center/`, cổng
   * 8082) dùng chung backend. Đổi theo môi trường bằng `VITE_HELP_URL`.
   */
  /** Số dòng mặc định cho mọi màn danh sách. */
  defaultPageSize: 20,
  locale: 'vi-VN',
  currency: 'VND',
} as const
