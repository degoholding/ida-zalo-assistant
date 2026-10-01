import { useCallback, useState } from 'react'

import type {
  FilterFieldDefinition,
  FilterState,
  FilterValue,
  OperatorType,
} from '../types'

const EMPTY_STATE: FilterState = { rows: [], conjunction: 'and' }

/** State cục bộ của bảng điều kiện (chưa áp dụng cho tới khi bấm "Áp dụng"). */
export function useFilterState(initialState?: FilterState) {
  const [state, setState] = useState<FilterState>(initialState ?? EMPTY_STATE)

  const addRow = useCallback(() => {
    setState((prev) => ({
      ...prev,
      rows: [
        ...prev.rows,
        { id: crypto.randomUUID(), field: null, operator: null, value: null },
      ],
    }))
  }, [])

  const removeRow = useCallback((id: string) => {
    setState((prev) => ({ ...prev, rows: prev.rows.filter((row) => row.id !== id) }))
  }, [])

  // Đổi trường thì operator và giá trị cũ không còn hợp lệ -> xóa luôn.
  const updateField = useCallback((id: string, field: FilterFieldDefinition) => {
    setState((prev) => ({
      ...prev,
      rows: prev.rows.map((row) =>
        row.id === id ? { ...row, field, operator: null, value: null } : row,
      ),
    }))
  }, [])

  // Đổi operator cũng xóa giá trị: "bằng" nhận chuỗi, "trong khoảng" nhận cặp.
  const updateOperator = useCallback((id: string, operator: OperatorType) => {
    setState((prev) => ({
      ...prev,
      rows: prev.rows.map((row) =>
        row.id === id ? { ...row, operator, value: null } : row,
      ),
    }))
  }, [])

  const updateValue = useCallback((id: string, value: FilterValue) => {
    setState((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => (row.id === id ? { ...row, value } : row)),
    }))
  }, [])

  const setConjunction = useCallback((conjunction: 'and' | 'or') => {
    setState((prev) => ({ ...prev, conjunction }))
  }, [])

  const reset = useCallback(() => setState(EMPTY_STATE), [])

  const overrideState = useCallback((next: FilterState) => setState(next), [])

  return {
    state,
    addRow,
    removeRow,
    updateField,
    updateOperator,
    updateValue,
    setConjunction,
    reset,
    overrideState,
  }
}
