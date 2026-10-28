import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { FILE_TABS, resolveFileTab, type FileTabKey } from '../utils/file-tabs'

/** Dải chọn tab của màn "Tệp" — tab đang mở nằm ở `?tab=` trên URL (gửi link được, Lùi không mất). */
export function FileTabsBar({ value, onChange }: { value: FileTabKey; onChange: (tab: FileTabKey) => void }) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(resolveFileTab(next))}>
      <TabsList>
        {FILE_TABS.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
