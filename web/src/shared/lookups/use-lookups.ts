import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/shared/constants/query-keys'
import { lookupApi, type LookupItem } from './lookup-api'

const LOOKUP_STALE_MS = 60_000

export function useCompanyLookup(withNone = false) {
  return useQuery({ queryKey: queryKeys.lookups.companies(withNone), queryFn: () => lookupApi.companies(withNone), staleTime: LOOKUP_STALE_MS })
}

export function useGroupLookup() {
  return useQuery({ queryKey: queryKeys.lookups.groups(), queryFn: lookupApi.groups, staleTime: LOOKUP_STALE_MS })
}

export function useThreadLookup() {
  return useQuery({ queryKey: queryKeys.lookups.threads(), queryFn: lookupApi.threads, staleTime: LOOKUP_STALE_MS })
}

export function useContactTagLookup() {
  return useQuery({ queryKey: queryKeys.lookups.contactTags(), queryFn: lookupApi.contactTags, staleTime: LOOKUP_STALE_MS })
}

/** Tra Danh bạ theo từ khóa (đã hoãn sẵn ở nơi gọi). Giữ kết quả cũ trong lúc chờ để danh sách không nháy trắng. */
export function useContactSearch(keyword: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.lookups.contactSearch(keyword.trim()),
    queryFn: () => lookupApi.searchContacts(keyword),
    placeholderData: keepPreviousData,
    staleTime: LOOKUP_STALE_MS,
    enabled,
  })
}

/** Một người theo id — `0` (chưa chọn) thì không gọi. */
export function useContactById(id: number) {
  return useQuery({
    queryKey: queryKeys.lookups.contact(id),
    queryFn: () => lookupApi.contact(id),
    staleTime: LOOKUP_STALE_MS,
    enabled: id > 0,
  })
}

/** Lọc tại chỗ cho ô combobox của bộ lọc nâng cao (`fetchOptions(search)`). */
export function filterLookupOptions(items: LookupItem[], search: string) {
  const needle = search.trim().toLowerCase()
  return items
    .filter((item) => !needle || item.name.toLowerCase().includes(needle))
    .map((item) => ({ value: String(item.id), label: item.name }))
}
