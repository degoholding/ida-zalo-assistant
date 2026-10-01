import { Link } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { Button } from '@/shared/ui/button'
import { ErrorState } from '@/shared/ui/error-state'

/** 404 — hiện bên trong khung app để người dùng còn thấy menu mà đi tiếp. */
export function NotFoundPage() {
  return (
    <ErrorState
      code="404"
      title="Không tìm thấy trang"
      description="Đường dẫn không tồn tại, đã được đổi, hoặc phân hệ này chưa mở."
    >
      <Button asChild>
        <Link to={appRoutes.launcher}>Về trang đầu</Link>
      </Button>
    </ErrorState>
  )
}
