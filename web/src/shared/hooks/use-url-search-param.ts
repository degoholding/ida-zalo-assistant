import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useDebouncedValue } from './use-debounced-value'
import { useHasChanged } from './use-has-changed'

/**
 * Ô tìm kiếm có ghi từ khóa lên URL — tải lại trang hay gửi link cho người khác
 * vẫn giữ nguyên kết quả đang xem.
 *
 * Ô nhập chạy bằng state cục bộ để gõ không giật; URL chỉ được ghi sau khi
 * ngừng gõ (`delay`), và ghi bằng `replace` để nút Back không phải bấm lại
 * từng ký tự đã gõ.
 *
 * Dùng chung tên param `q` với `conditional-filter` (`searchParamName`), nhờ đó
 * khi áp bộ lọc nâng cao thì từ khóa vẫn được giữ lại trên URL.
 */
export function useUrlSearchParam(name = 'q', delay = 350) {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlValue = searchParams.get(name) ?? ''

  const [value, setValue] = useState(urlValue)
  const debouncedValue = useDebouncedValue(value, delay)

  /**
   * URL đổi mà KHÔNG phải do chính ô này ghi ra (nút "Xóa lọc", nút Back của
   * trình duyệt) thì ô nhập phải theo. Trước đây ô nhập là nguồn sự thật tuyệt
   * đối sau lần khởi tạo, nên xóa lọc xong từ khóa vẫn nằm chình ình trong ô
   * còn bảng thì đã trả về đầy đủ — nhìn như bảng hỏng.
   *
   * So với `debouncedValue` chính là chỗ phân biệt "ai ghi": lần ghi của chính
   * ô này luôn đặt URL đúng bằng `debouncedValue`. Không có lần so này thì lúc
   * người dùng gõ nhanh, nhịp ghi của ký tự trước sẽ nhảy ngược vào ô và nuốt
   * mất mấy ký tự vừa gõ.
   */
  if (useHasChanged(urlValue) && urlValue !== debouncedValue) {
    setValue(urlValue)
  }

  const lastWritten = useRef(debouncedValue)

  useEffect(() => {
    if (lastWritten.current === debouncedValue) return
    lastWritten.current = debouncedValue

    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (debouncedValue) next.set(name, debouncedValue)
        else next.delete(name)
        return next
      },
      { replace: true },
    )
  }, [debouncedValue, name, setSearchParams])

  return { value, setValue, debouncedValue }
}
