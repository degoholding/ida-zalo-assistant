import { useEffect, useState } from 'react'

/**
 * Hoãn giá trị lại `delay` ms. Dùng cho ô tìm kiếm: gõ tới đâu gọi API tới đó
 * thì mỗi ký tự là một request, còn debounce thì chỉ gọi khi người dùng ngừng gõ.
 */
export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
