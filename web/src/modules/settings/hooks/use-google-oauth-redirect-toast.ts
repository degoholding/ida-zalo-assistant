import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { clearGoogleOauthRedirectParams, parseGoogleOauthRedirectParams } from '../utils/google-oauth-redirect-params'

/**
 * Google xác thực xong đưa trình duyệt về `/app/settings?tab=google&google_oauth=connected`
 * (hoặc `...&google_oauth=error&message=...`). Hook này hiện toast đúng MỘT LẦN rồi xóa
 * `google_oauth` / `message` khỏi URL (replace history, giữ `tab`) — không xóa thì bấm
 * tải lại trang là toast hiện lại dù chưa có gì mới xảy ra.
 */
export function useGoogleOauthRedirectToast() {
  const [searchParams, setSearchParams] = useSearchParams()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    const result = parseGoogleOauthRedirectParams(searchParams)
    if (!result) return
    handled.current = true

    if (result.status === 'connected') toast.success('Đã kết nối Google')
    else toast.error(result.message || 'Không kết nối được Google')

    setSearchParams(clearGoogleOauthRedirectParams(searchParams), { replace: true })
  }, [searchParams, setSearchParams])
}
