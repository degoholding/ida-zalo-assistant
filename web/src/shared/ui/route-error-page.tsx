import { RotateCw } from 'lucide-react'
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'

import { logger } from '@/core/telemetry/logger'
import { appRoutes } from '@/shared/constants/app-routes'
import { Button } from '@/shared/ui/button'
import { ErrorState } from '@/shared/ui/error-state'
import { NotFoundPage } from '@/shared/ui/not-found-page'

/** Chunk của bản CŨ không còn trên server sau khi deploy — chỉ cần tải lại trang. */
function isStaleChunkError(message: string) {
  return (
    message.includes('dynamically imported module') ||
    message.includes('Failed to fetch dynamically imported')
  )
}

/**
 * Màn hình khi một route ném lỗi (loader, `lazy`, hoặc render). Ba ca:
 *  - 404 do loader ném `Response` → trả về đúng màn 404 chung
 *  - chunk cũ sau khi deploy → nhấn mạnh nút "Tải lại"
 *  - còn lại → lỗi chung, kèm chi tiết kỹ thuật để người dùng copy khi báo lỗi
 */
export function RouteErrorPage() {
  const error = useRouteError()
  logger.error('Route lỗi', error)

  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error ?? '')

  const isStaleChunk = isStaleChunkError(message)

  return (
    <ErrorState
      title={isStaleChunk ? 'Có bản cập nhật mới' : 'Không mở được trang'}
      description={
        isStaleChunk
          ? 'Hệ thống vừa được cập nhật nên trang đang mở đã cũ. Tải lại để dùng bản mới nhất.'
          : 'Đã có lỗi khi mở trang này. Thử tải lại, nếu vẫn lỗi thì báo bộ phận kỹ thuật.'
      }
      detail={message}
    >
      <Button onClick={() => window.location.reload()}>
        <RotateCw className="size-4" />
        Tải lại trang
      </Button>
      <Button asChild variant="outline">
        <Link to={appRoutes.launcher}>Về trang đầu</Link>
      </Button>
    </ErrorState>
  )
}
