import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Giao diện quản trị Bot trợ lý — nhân bản khung ERP v2. Bản build được máy chủ Node phục vụ
// dưới `/app` (xem `src/web/spa-static.ts`); lúc dev, `/api` và `/avatars` đi qua proxy về máy
// chủ đó nên cookie phiên cùng gốc, không dính CORS.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8090'

  return {
    base: '/app/',
    plugins: [react(), tailwindcss()],
    resolve: {
      // fileURLToPath chứ KHÔNG phải .pathname: trên Windows .pathname trả về
      // '/D:/New%20folder/...' — có gạch chéo thừa ở đầu và dấu cách bị mã hóa.
      // Dev server bỏ qua được, nhưng `vite build` (rolldown) đọc thẳng đường dẫn
      // đó và chết ngay ở import đầu tiên (os error 123).
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: true,
      port: 5175, // 5173/5174 dành cho hai giao diện ERP
      // Port bận thì DỪNG hẳn, không tự nhảy sang cổng khác. Nhảy port sinh ra hai
      // dev server chạy song song: tab mở ở server cũ sẽ hỏng chunk lazy ngay khi
      // server đó tắt ("error loading dynamically imported module").
      strictPort: true,
      allowedHosts: true,
      // HMR qua volume trên Docker/Windows: mã nguồn nằm trên ổ NTFS của Windows
      // nên inotify KHÔNG bắn sự kiện qua được, buộc phải hỏi vòng.
      //
      // Nhưng hỏi vòng mặc định là 100ms và mỗi vòng `stat` lại TỪNG tệp — trên
      // bind mount Windows mỗi lệnh `stat` tốn cỡ mili giây, nên vòng lặp sự kiện
      // của Node gần như không lúc nào rảnh. Proxy `/api` chạy chung vòng lặp đó,
      // thành ra mỗi lượt gọi API bị om ~200ms và các lượt gọi song song thì xếp
      // hàng nối đuôi: mở một màn cần 6 lượt gọi là mất hơn một giây, dù backend
      // trả lời trong 90ms. Đo được bằng cách gọi thẳng `api:8000` (18ms cho 6
      // lượt song song) rồi gọi qua `erp:5174` (1199ms cho đúng 6 lượt đó).
      //
      // Giãn nhịp hỏi vòng ra 1s và bỏ qua các thư mục không bao giờ sửa tay.
      // Đổi lại: sửa mã xong chờ tối đa 1s mới thấy HMR — rẻ hơn nhiều so với
      // việc mọi lượt gọi API đều chậm.
      watch: {
        usePolling: true,
        interval: 1000,
        binaryInterval: 2000,
        ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      },
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/avatars': { target: apiTarget, changeOrigin: true },
      },
    },
  }
})
