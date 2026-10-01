import { env } from '@/core/config/env'

/**
 * Logger tối giản. Dev thì in ra console, production thì im lặng (trừ error).
 * Khi nào gắn Sentry/OpenTelemetry chỉ cần sửa trong file này, call site không đổi.
 */

type LogArgs = readonly unknown[]

export const logger = {
  debug: (...args: LogArgs) => {
    if (env.isDev) console.debug('[debug]', ...args)
  },
  info: (...args: LogArgs) => {
    if (env.isDev) console.info('[info]', ...args)
  },
  warn: (...args: LogArgs) => {
    console.warn('[warn]', ...args)
  },
  /** Lỗi luôn được ghi — chỗ này về sau nối tới dịch vụ giám sát. */
  error: (...args: LogArgs) => {
    console.error('[error]', ...args)
  },
}
