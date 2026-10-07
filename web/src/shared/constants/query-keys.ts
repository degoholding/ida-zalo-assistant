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
  },
  groups: {
    all: ['groups'] as const,
    backfill: (id: number) => ['groups', 'backfill', id] as const,
  },
  files: {
    all: ['files'] as const,
    text: (id: number) => ['files', 'text', id] as const,
  },
  accounts: {
    all: ['accounts'] as const,
    qrLogin: (attemptId: string) => ['accounts', 'qr-login', attemptId] as const,
  },
  imports: {
    all: ['imports'] as const,
    targets: () => ['imports', 'targets'] as const,
  },
  settings: {
    all: ['settings'] as const,
    list: () => ['settings', 'list'] as const,
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
  },
}
