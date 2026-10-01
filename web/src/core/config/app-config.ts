/** Hằng số cấu hình ứng dụng — không phụ thuộc môi trường. */

export const appConfig = {
  /** Khóa lưu trong localStorage. Gom một chỗ để tránh gõ sai chuỗi. */
  storageKeys: {
            user: 'bot.user',
    /** Id bảng màu đang chọn. Nguồn thật nằm ở máy chủ; đây chỉ là bản nhớ tạm. */
    themeId: 'bot.theme_id',
    /**
     * CSS đã dựng sẵn của bảng màu đang chọn. Lưu nguyên đoạn CSS chứ không chỉ
     * id để đoạn script chặn trong `index.html` sơn được màu NGAY, trước cả khi
     * gói JS tải xong — không có nó thì mỗi lần tải trang lóe một nhịp màu DEGO
     * mặc định rồi mới nhảy sang bảng màu người dùng chọn.
     */
    themeCss: 'bot.theme_css',
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
