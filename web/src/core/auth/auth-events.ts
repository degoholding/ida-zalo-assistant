/** Sự kiện phiên đăng nhập, phát qua `window` để tầng http không phải import store (tránh vòng). */
const SESSION_EXPIRED = 'bot:auth:session-expired'

export const authEvents = {
  /** Máy chủ trả 401 — store xóa hồ sơ, router đá về /login. */
  emitSessionExpired: () => window.dispatchEvent(new CustomEvent(SESSION_EXPIRED)),
  onSessionExpired: (handler: () => void) => {
    window.addEventListener(SESSION_EXPIRED, handler)
    return () => window.removeEventListener(SESSION_EXPIRED, handler)
  },
}
