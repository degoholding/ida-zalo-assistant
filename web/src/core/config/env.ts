/**
 * Điểm truy cập DUY NHẤT tới biến môi trường. Không đọc `import.meta.env` rải rác
 * trong code — mọi biến mới khai báo ở đây để có chỗ tra cứu và ép kiểu tập trung.
 */

interface AppEnv {
  /** Rỗng = gọi tương đối qua proxy Vite (dev). Production đặt domain thật. */
  apiUrl: string
  appName: string
  isDev: boolean
  isProd: boolean
}

export const env: AppEnv = {
  apiUrl: import.meta.env.VITE_API_URL ?? '',
  appName: import.meta.env.VITE_APP_NAME ?? 'Bot trợ lý',
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
}
