import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { DEFAULT_LOCALE } from '../constants'
import { getValidFilterRows } from '../helpers/validators'
import { useFilterState } from '../hooks/use-filter-state'
import { useFilterUrlSync } from '../hooks/use-filter-url-sync'
import type { FilterConfig, FilterState } from '../types'
import { FilterContext } from './filter-context'

export interface FilterProviderProps {
  config: FilterConfig
  children: ReactNode
}

const EMPTY_STATE: FilterState = { rows: [], conjunction: 'and' }

/**
 * Nguồn state cho bộ lọc điều kiện.
 *
 * ⚠️ Khác FilterCN gốc: tách `state` (bản nháp đang chỉnh trong popover) khỏi
 * `appliedState` (bản đã bấm "Áp dụng"). Bản gốc dựng query thẳng từ bản nháp
 * nên bảng gọi lại API theo từng ký tự người dùng gõ, và nhấp nháy khi điều
 * kiện mới thêm còn chưa nhập giá trị.
 */
export function FilterProvider({ config, children }: FilterProviderProps) {
  const currentConfig = useMemo<FilterConfig>(
    () => ({ ...config, locale: { ...DEFAULT_LOCALE, ...config.locale } }),
    [config],
  )

  const { initialState, applyChanges } = useFilterUrlSync(currentConfig)
  const [appliedState, setAppliedState] = useState<FilterState>(initialState)

  const {
    state,
    addRow,
    removeRow,
    updateField,
    updateOperator,
    updateValue,
    setConjunction,
    reset: resetDraft,
  } = useFilterState(initialState)

  const activeCount = useMemo(
    () => getValidFilterRows(appliedState.rows).length,
    [appliedState.rows],
  )

  const apply = useCallback(() => {
    // Bỏ luôn dòng dở dang để lần mở popover sau không thấy ô trống lơ lửng.
    const cleaned: FilterState = { ...state, rows: getValidFilterRows(state.rows) }
    setAppliedState(cleaned)
    applyChanges(cleaned)
  }, [state, applyChanges])

  const reset = useCallback(() => {
    resetDraft()
    setAppliedState(EMPTY_STATE)
    applyChanges(EMPTY_STATE)
  }, [resetDraft, applyChanges])

  const value = useMemo(
    () => ({
      config: currentConfig,
      state,
      appliedState,
      addRow,
      removeRow,
      updateField,
      updateOperator,
      updateValue,
      setConjunction,
      reset,
      apply,
      activeCount,
    }),
    [
      currentConfig,
      state,
      appliedState,
      addRow,
      removeRow,
      updateField,
      updateOperator,
      updateValue,
      setConjunction,
      reset,
      apply,
      activeCount,
    ],
  )

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}
