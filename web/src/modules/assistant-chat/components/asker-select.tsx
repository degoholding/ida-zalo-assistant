import { CONTACT_ROLE } from '@/shared/contact-card/contact-constants'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import type { Asker } from '../types/assistant-chat'

function roleLabel(role: number): string {
  return role === CONTACT_ROLE.manager ? 'Quản lý' : 'Trưởng phòng'
}

interface AskerSelectProps {
  askers: Asker[]
  value: number | null
  onChange: (id: number) => void
}

/** Chọn «hỏi dưới tên ai» — vai trò hiện kèm tên vì một người có thể trùng tên trong danh bạ. */
export function AskerSelect({ askers, value, onChange }: AskerSelectProps) {
  return (
    <Select value={value ? String(value) : undefined} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger className="w-64" aria-label="Người hỏi">
        <SelectValue placeholder="Chọn người hỏi" />
      </SelectTrigger>
      <SelectContent>
        {askers.map((asker) => (
          <SelectItem key={asker.id} value={String(asker.id)}>
            {asker.name} · {roleLabel(asker.role)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
