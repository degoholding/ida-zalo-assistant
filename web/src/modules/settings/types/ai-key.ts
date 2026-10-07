/**
 * Hãng của một dòng «Khóa AI» — chép từ `AiKeyProvider` ở `src/constants.ts` phía máy chủ (SMALLINT trong bảng `ai_key`).
 * Đổi bên kia thì sửa bên này.
 */
export const AiKeyProvider = {
  Gemini: 1,
  OpenAI: 2,
  OpenAICompatible: 3,
  DeepSeek: 4,
  Xai: 5,
  OpenRouter: 6,
} as const

export type AiKeyProvider = (typeof AiKeyProvider)[keyof typeof AiKeyProvider]

/** Một dòng như `GET /api/ai-keys` trả — KHÔNG BAO GIỜ có khóa, chỉ đuôi `key_tail`. */
export interface AiKeyItem {
  id: number
  /** Số thứ tự: 1 = khóa bot dùng trước. */
  position: number
  provider: AiKeyProvider
  provider_label: string
  /** Chỉ hãng tùy chỉnh; hãng khác rỗng. */
  base_url: string
  /** Rỗng = mặc định của hãng (`default_model`). */
  model: string
  /** Rỗng = việc nặng dùng chính mô hình chính. */
  model_heavy: string
  default_model: string
  /** «…ab12». */
  key_tail: string
  /** 0 = không giới hạn. */
  daily_cap: number
  used_today: number
  /** Lỗi gần nhất khiến bot bỏ qua khóa, vd «hết tiền (402)». */
  last_error: string
  last_error_at: string | null
  /** Không giải mã được (đổi khóa mã hóa máy chủ) — phải gỡ rồi thêm lại. */
  broken: boolean
  verified_at: string | null
}

/** Thân `POST /api/ai-keys` — khóa chỉ đi VÀO. */
export interface AiKeyInput {
  provider: AiKeyProvider
  key: string
  base_url?: string
  model?: string
  model_heavy?: string
  daily_cap?: number
}

/** Thân `PATCH /api/ai-keys/:id` — đổi hãng / khóa thì gỡ rồi thêm. */
export interface AiKeyPatch {
  model?: string
  model_heavy?: string
  daily_cap?: number
}
