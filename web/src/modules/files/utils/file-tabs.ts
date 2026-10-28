export const FILE_TABS = [
  { key: 'files', label: 'Tệp' },
  { key: 'links', label: 'Link chia sẻ' },
] as const

export type FileTabKey = (typeof FILE_TABS)[number]['key']

/** Giá trị `?tab=` lạ hoặc thiếu thì về tab "Tệp". */
export function resolveFileTab(raw: string | null): FileTabKey {
  return FILE_TABS.find((tab) => tab.key === raw)?.key ?? 'files'
}
