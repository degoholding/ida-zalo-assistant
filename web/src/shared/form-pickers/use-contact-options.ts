import { useMemo, useState } from 'react'

import { getContactOptionLabel } from '@/shared/contact-card/format-contact'
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value'
import { useContactSearch } from '@/shared/lookups/use-lookups'
import type { SearchSelectOption } from '@/shared/ui/search-select'

/**
 * Danh sách người cho ô chọn, TRA PHÍA MÁY CHỦ theo từ khóa đang gõ (hoãn 350ms).
 *
 * Danh bạ có thể hàng nghìn người — nạp hết vào ô chọn thì chậm và vẫn bị máy chủ cắt ở 200 dòng; tra theo từ khóa
 * thì người không có trong lượt đầu vẫn tìm ra được.
 */
export function useContactOptions(enabled: boolean) {
  const [keyword, setKeyword] = useState('')
  const debounced = useDebouncedValue(keyword)
  const search = useContactSearch(debounced, enabled)

  const contacts = useMemo(() => search.data?.items ?? [], [search.data])
  const options = useMemo<SearchSelectOption[]>(
    () => contacts.map((contact) => ({ value: String(contact.id), label: getContactOptionLabel(contact) })),
    [contacts],
  )

  return { contacts, options, setKeyword, isFetching: search.isFetching }
}
