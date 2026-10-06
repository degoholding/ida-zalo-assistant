import { Checkbox } from '@/shared/ui/checkbox'
import { Label } from '@/shared/ui/label'
import type { SettingChoice } from '../types/setting'
import { groupChoices, parseChoiceList, toggleChoice } from '../utils/toggle-choice-list'

interface SettingChoiceListProps {
  id: string
  choices: SettingChoice[]
  /** Chuỗi cách nhau dấu phẩy — cùng dạng giá trị form của ô danh sách. */
  value: unknown
  onChange: (value: string) => void
  disabled?: boolean
}

/** Ô danh sách có lựa chọn sẵn (vd «Loại tệp bot được đọc»): mỗi lựa chọn một ô tick, gom theo nhóm. */
export function SettingChoiceList({ id, choices, value, onChange, disabled }: SettingChoiceListProps) {
  const selected = parseChoiceList(value)
  return (
    <div id={id} className="space-y-3 rounded-md border p-3">
      {groupChoices(choices).map(({ group, items }) => (
        <div key={group} className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{group}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {items.map((choice) => {
              const checkboxId = `${id}-${choice.value}`
              return (
                <div key={choice.value} className="flex items-center gap-2">
                  <Checkbox
                    id={checkboxId}
                    checked={selected.has(choice.value)}
                    disabled={disabled}
                    onCheckedChange={(checked) => onChange(toggleChoice(value, choices, choice.value, checked === true))}
                  />
                  <Label htmlFor={checkboxId} className="font-normal">
                    {choice.label}
                  </Label>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
