export interface ComposerKeyEvent {
  key: string
  shiftKey: boolean
  /** Đang gõ qua bộ gõ tiếng (IME) — phím Enter lúc này là chọn chữ, không phải gửi. */
  isComposing: boolean
}

/** Enter gửi câu hỏi; Shift+Enter xuống dòng; Enter giữa lúc IME đang gõ thì bỏ qua. */
export function shouldSubmitOnKeyDown(event: ComposerKeyEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing
}
