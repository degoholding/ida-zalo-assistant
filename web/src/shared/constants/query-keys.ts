/**
 * Query key tập trung một chỗ. Trải rác chuỗi thô trong component là nguyên nhân
 * số 1 của lỗi "sửa xong mà danh sách không tự nạp lại" — invalidate trượt key.
 *
 * Quy ước: `[<phân hệ>, <thực thể>, <tham số>]` để invalidate được theo tầng.
 * Danh sách / chi tiết đi qua khung CRUD thì dùng khóa của khung (`['crud', apiPath, …]`), không khai ở đây.
 */
export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    me: () => ['auth', 'me'] as const,
    /** Tuỳ chọn hiển thị (bảng màu) — khung theme của ERP đọc khóa này. */
    preferences: () => ['auth', 'preferences'] as const,
    /** Cấu hình màn đăng nhập (có nút Google không) — đọc được khi chưa đăng nhập. */
    config: () => ['auth', 'config'] as const,
  },
  recipients: {
    all: ['recipients'] as const,
    /** Ô chọn «Tài khoản web» của người nhận — danh sách người dùng rút gọn. */
    userOptions: () => ['recipients', 'user-options'] as const,
  },
  contacts: {
    all: ['contacts'] as const,
    card: (uid: string) => ['contacts', 'card', uid] as const,
  },
  conversations: {
    all: ['conversations'] as const,
    list: (params: Record<string, unknown>) => ['conversations', 'list', params] as const,
    thread: (id: number) => ['conversations', 'thread', id] as const,
    messages: (id: number) => ['conversations', 'messages', id] as const,
    /** Dòng tin mở quanh một tin (`?msg=`) — nằm dưới khóa `messages(id)` để tin mới tới làm mới cả hai. */
    messagesAround: (id: number, messageId: number) => ['conversations', 'messages', id, 'around', messageId] as const,
  },
  groups: {
    all: ['groups'] as const,
    backfill: (id: number) => ['groups', 'backfill', id] as const,
  },
  files: {
    all: ['files'] as const,
    text: (id: number) => ['files', 'text', id] as const,
  },
  tickets: {
    all: ['tickets'] as const,
    /** Người xử lý ticket (nhận tin báo ticket mới qua Zalo). Danh sách / chi tiết ticket đi qua khóa của khung CRUD. */
    handlers: () => ['tickets', 'handlers'] as const,
  },
  accounts: {
    all: ['accounts'] as const,
    qrLogin: (attemptId: string) => ['accounts', 'qr-login', attemptId] as const,
    /** Tab «Kết bạn» của một tài khoản bot: lời mời đến / đã gửi. */
    friends: (id: number) => ['accounts', 'friends', id] as const,
    /**
     * Kết quả tra số điện thoại ở tab Kết bạn. CỐ Ý không nằm dưới `friends(id)`: làm mới danh sách không được tra lại
     * số trên Zalo (tra dồn dập dễ bị khóa) — gửi lời mời xong thì sửa thẳng kết quả trong bộ nhớ đệm.
     */
    friendSearchAll: (id: number) => ['accounts', 'friend-search', id] as const,
    friendSearch: (id: number, phone: string) => ['accounts', 'friend-search', id, phone] as const,
  },
  imports: {
    all: ['imports'] as const,
    targets: () => ['imports', 'targets'] as const,
  },
  settings: {
    all: ['settings'] as const,
    list: () => ['settings', 'list'] as const,
  },
  schedules: {
    all: ['schedules'] as const,
    list: () => ['schedules', 'list'] as const,
  },
  aiKeys: {
    all: ['ai-keys'] as const,
    list: () => ['ai-keys', 'list'] as const,
  },
  googleOauth: {
    all: ['google-oauth'] as const,
    status: () => ['google-oauth', 'status'] as const,
  },
  assistantChat: {
    all: ['assistant-chat'] as const,
    askers: () => ['assistant-chat', 'askers'] as const,
    messages: (contactId: number) => ['assistant-chat', 'messages', contactId] as const,
  },
  lookups: {
    all: ['lookups'] as const,
    companies: (withNone: boolean) => ['lookups', 'companies', withNone] as const,
    groups: () => ['lookups', 'groups'] as const,
    threads: () => ['lookups', 'threads'] as const,
    contactTags: () => ['lookups', 'contact-tags'] as const,
    /** Ô chọn người trong Danh bạ — tra phía máy chủ theo từ khóa. */
    contactSearch: (keyword: string) => ['lookups', 'contact-search', keyword] as const,
    /** Một người theo id — để ô chọn hiện TÊN của người đang lưu dù không nằm trong kết quả tìm. */
    contact: (id: number) => ['lookups', 'contact', id] as const,
  },
}
