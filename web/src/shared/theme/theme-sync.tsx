import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useAuthStore } from '@/core/auth/auth-store'
import { queryKeys } from '@/shared/constants/query-keys'
import { applyTheme } from './apply-theme'
import { fetchMyPreferences } from './theme-api'
import { DEFAULT_THEME_ID } from './theme-presets'
import { readThemeId, useThemeStore } from './theme-store'

/**
 * Giữ bảng màu khớp với lựa chọn đã lưu trên máy chủ. Không vẽ gì cả.
 *
 * Lấy từ HAI nguồn, cố ý chồng nhau:
 * 1. `user.preferences` trong hồ sơ đăng nhập — có ngay lập tức, không tốn
 *    request, nên đăng nhập ở máy lạ là màu đúng ngay khung hình đầu.
 * 2. `GET /api/me/preferences` lúc khởi động — hồ sơ ở (1) nằm trong
 *    localStorage và chỉ được làm mới khi access token hết hạn, tức có thể cũ
 *    hàng giờ. Đổi bảng màu ở máy A rồi mở lại tab đang mở sẵn ở máy B mà chỉ
 *    trông vào (1) thì máy B giữ màu cũ mãi. Một request nhỏ lúc khởi động đóng
 *    hẳn khe đó.
 *
 * Kết quả của (2) đè (1) khi có, vì nó mới hơn.
 */
export function ThemeSync() {
  const isAuthenticated = useAuthStore((state) => !!state.user)
  const profilePreferences = useAuthStore((state) => state.user?.preferences)
  const syncFromServer = useThemeStore((state) => state.syncFromServer)
  const themeId = useThemeStore((state) => state.themeId)

  const { data: serverPreferences, isSuccess } = useQuery({
    queryKey: queryKeys.auth.preferences(),
    queryFn: fetchMyPreferences,
    enabled: isAuthenticated,
    //  Tuỳ chọn hiển thị đổi rất thưa: hỏi lại mỗi 5 phút là quá đủ, khỏi bắn
    //  request mỗi lần chuyển tab.
    staleTime: 5 * 60 * 1000,
  })

  //  DỰNG LẠI CSS mỗi lần tải trang, kể cả khi bản nhớ tạm còn nguyên.
  //
  //  Đoạn script chặn trong `index.html` sơn màu từ `localStorage.bot.theme_css`
  //  — nhanh, nhưng đó là CSS đã dựng từ LẦN TRƯỚC. Sửa `build-theme-css.ts`
  //  rồi phát hành thì người dùng cũ vẫn giữ nguyên CSS đời cũ cho tới khi họ
  //  tình cờ bấm chọn lại bảng màu, tức có thể là không bao giờ (đúng lỗi gặp
  //  27/08/2026 khi đổi cách tô mục menu đang mở). Dựng lại một lần lúc khởi
  //  động là vài chục dòng chuỗi, rẻ hơn nhiều so với việc phải nhớ bơm số hiệu
  //  phiên bản vào bản nhớ tạm mỗi lần đụng tới hàm dựng.
  //
  //  Cũng chính là lưới an toàn cho trường hợp localStorage bị chặn (chế độ
  //  riêng tư) hay bản nhớ tạm hỏng — khi đó thẻ style rỗng.
  useEffect(() => {
    applyTheme(themeId)
  }, [themeId])

  useEffect(() => {
    if (isSuccess) {
      //  Máy chủ ĐÃ TRẢ LỜI thì nó là nguồn thật, kể cả khi câu trả lời là
      //  "không có tuỳ chọn nào" — nghĩa là quay về bảng màu mặc định.
      //
      //  ⚠️ Đừng viết `fromServer ?? fromProfile`: nó gộp "máy chủ bảo không có"
      //  với "máy chủ chưa trả lời" làm một. Lỗi đã xảy ra: xoá tuỳ chọn ở máy
      //  chủ rồi tải lại, máy vẫn giữ bảng màu cũ vì hồ sơ trong localStorage
      //  còn lưu lựa chọn từ lần đăng nhập trước và thắng ở nhánh `??`.
      syncFromServer(readThemeId(serverPreferences) ?? DEFAULT_THEME_ID)
      return
    }

    //  Chưa có câu trả lời: tạm dùng hồ sơ đăng nhập để không phải chờ một vòng
    //  gọi mạng mới thấy đúng màu.
    const fromProfile = readThemeId(profilePreferences)
    if (fromProfile) syncFromServer(fromProfile)
  }, [isSuccess, serverPreferences, profilePreferences, syncFromServer])

  return null
}
