import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Múi giờ CỐ ĐỊNH cho mọi lần chạy test. Hệ thống nhận mốc thời gian UTC từ
// backend rồi hiển thị theo giờ Việt Nam (xem `shared/utils/format-date.ts`);
// để test chạy theo giờ máy thì cùng một khẳng định sẽ đúng ở máy này, sai ở
// máy khác (và sai trên CI, vốn luôn là UTC).
process.env.TZ = 'Asia/Ho_Chi_Minh'

// Tách khỏi `vite.config.ts` có chủ ý: test không cần dev server, không cần
// proxy `/api`, cũng không nên nạp plugin Tailwind (chậm mà chẳng dùng tới).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Test nằm CẠNH tệp nó kiểm, không gom vào thư mục riêng (xem `.claude/rules/naming.md`).
    include: ['src/**/*.test.{ts,tsx}'],
    // Không xử lý CSS: component ở đây khẳng định theo vai trò/nội dung chứ
    // không theo class, mà biên dịch Tailwind cho từng tệp test thì rất chậm.
    css: false,
    restoreMocks: true,
  },
})
