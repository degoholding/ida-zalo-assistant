import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { DEFAULT_OPERATORS, OPERATOR_LABELS } from '../constants'
import { useFilterContext } from '../provider/filter-context'
import type { FilterFieldDefinition, OperatorType } from '../types'

export interface OperatorSelectProps {
  rowId: string
  field: FilterFieldDefinition
  selectedOperator: OperatorType | null
}

/** Ô chọn phép so sánh; danh sách phụ thuộc kiểu của trường đã chọn. */
export function OperatorSelect({
  rowId,
  field,
  selectedOperator,
}: OperatorSelectProps) {
  const { updateOperator } = useFilterContext()
  const operators = field.operators ?? DEFAULT_OPERATORS[field.type] ?? ['is']

  return (
    <Select
      value={selectedOperator ?? ''}
      onValueChange={(value) => updateOperator(rowId, value as OperatorType)}
    >
      <SelectTrigger className="w-full shrink-0 md:w-40">
        <SelectValue placeholder="Điều kiện…" />
      </SelectTrigger>
      <SelectContent>
        {operators.map((operator) => (
          <SelectItem key={operator} value={operator}>
            {OPERATOR_LABELS[operator] ?? operator}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
