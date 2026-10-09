/**
 * Đường dẫn tập trung — sửa URL một chỗ, không phải grep chuỗi khắp nơi.
 * App chạy dưới `/app` (basename của router), các đường dưới đây tính từ đó.
 */
export const appRoutes = {
  login: '/login',
  /** Trang mở đầu sau khi đăng nhập. */
  launcher: '/',

  conversations: {
    list: '/conversations',
    detail: (id: number | string) => `/conversations/${id}`,
    /** Mở cuộc và cuộn tới đúng một tin (kể cả tin cũ) — màn Hội thoại đọc `?msg=`. */
    message: (threadId: number | string, messageId: number | string) => `/conversations/${threadId}?msg=${messageId}`,
  },
  contacts: {
    list: '/contacts',
    detail: (id: number | string) => `/contacts/${id}`,
  },
  groups: {
    list: '/groups',
    detail: (id: number | string) => `/groups/${id}`,
  },
  files: { list: '/files' },
  search: { messages: '/search' },
  tickets: {
    list: '/tickets',
    detail: (id: number | string) => `/tickets/${id}`,
  },
  imports: { zaloWeb: '/imports/zalo-web' },
  companies: {
    list: '/companies',
    detail: (id: number | string) => `/companies/${id}`,
  },
  accounts: {
    list: '/accounts',
    detail: (id: number | string) => `/accounts/${id}`,
  },
  users: {
    list: '/users',
    create: '/users/new',
    detail: (id: number | string) => `/users/${id}`,
  },
  recipients: {
    list: '/recipients',
    create: '/recipients/new',
    detail: (id: number | string) => `/recipients/${id}`,
  },
  settings: '/settings',
  assistantChat: '/assistant-chat',

  /** Khung dùng chung của ERP (dòng thời gian lịch sử) có link sang nhật ký — bot chưa có màn này. */
  system: {
    logDetail: (requestId: string) => `/logs/${requestId}`,
  },
}

/** Đường API tải tệp — dùng cho thẻ `<a download>`, không qua axios. */
export const fileDownloadUrl = (attachmentId: number) => `/api/files/${attachmentId}/download`
