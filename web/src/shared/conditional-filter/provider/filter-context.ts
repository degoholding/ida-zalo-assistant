import { createContext, useContext } from 'react'

import type {
  FilterConfig,
  FilterFieldDefinition,
  FilterState,
  FilterValue,
  OperatorType,
} from '../types'

export interface FilterContextValue {
  config: FilterConfig
  /** State đang chỉnh trong popover (có thể chưa áp dụng). */
  state: FilterState
  /** State ĐÃ áp dụng — cái mà danh sách đang dùng để gọi API. */
  appliedState: FilterState

  addRow: () => void
  removeRow: (id: string) => void
  updateField: (id: string, field: FilterFieldDefinition) => void
  updateOperator: (id: string, operator: OperatorType) => void
  updateValue: (id: string, value: FilterValue) => void
  setConjunction: (conjunction: 'and' | 'or') => void
  reset: () => void
  apply: () => void

  /** Số điều kiện đang có hiệu lực — hiện trên huy hiệu nút Bộ lọc. */
  activeCount: number
}

export const FilterContext = createContext<FilterContextValue | null>(null)

export function useFilterContext() {
  const context = useContext(FilterContext)
  if (!context) {
    throw new Error('useFilterContext phải được dùng bên trong <FilterProvider>')
  }
  return context
}

export function useOptionalFilterContext() {
  return useContext(FilterContext)
}

