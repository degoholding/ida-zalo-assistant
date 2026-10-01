import { RotateCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { logger } from '@/core/telemetry/logger'
import { Button } from '@/shared/ui/button'
import { ErrorState } from '@/shared/ui/error-state'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Fallback riêng — nhận `reset` để thử render lại mà không tải lại trang. */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** Chiếm hết màn hình (dùng cho boundary gốc, lúc đó chưa chắc có khung app). */
  fullScreen?: boolean
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Lưới an toàn cuối cùng cho lỗi RENDER. React Router đã bắt lỗi trong cây route
 * bằng `errorElement`, nhưng lỗi ở NGOÀI router (provider, chính RouterProvider)
 * thì không ai bắt và người dùng nhận màn hình trắng — boundary này chặn ca đó.
 *
 * Chỉ bắt lỗi lúc render/lifecycle. Lỗi trong event handler hay promise không đi
 * qua đây — chỗ đó dùng toast của `http-client`.
 *
 * Phải là class: React chưa có API hook tương đương.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('Lỗi render', error, info.componentStack)
  }

  /** Xóa lỗi để React render lại cây con — cứu được lỗi chỉ xảy ra một lần. */
  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    const { children, fallback, fullScreen } = this.props

    if (!error) return children
    if (fallback) return fallback(error, this.reset)

    return (
      <ErrorState
        fullScreen={fullScreen}
        title="Ứng dụng gặp sự cố"
        description="Đã có lỗi ngoài dự tính. Thử lại, nếu vẫn lỗi thì tải lại trang hoặc báo bộ phận kỹ thuật."
        detail={error.message}
      >
        <Button onClick={this.reset}>Thử lại</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          <RotateCw className="size-4" />
          Tải lại trang
        </Button>
      </ErrorState>
    )
  }
}
