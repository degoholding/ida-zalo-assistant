/**
 * Bộ lọc điều kiện dùng chung — port FilterCN sang React thuần.
 * Xem `types.ts` để biết các khác biệt có chủ ý so với bản gốc.
 *
 * Cách dùng ở một màn danh sách:
 *
 *   export function ThingListPage() {
 *     return (
 *       <FilterProvider config={{ fields: THING_FILTER_FIELDS }}>
 *         <ThingListContent />
 *       </FilterProvider>
 *     )
 *   }
 *
 *   function ThingListContent() {
 *     const { queryParams } = useFilterQuery()
 *     const { data } = useThings({ page, ...queryParams })
 *     return <> <ConditionalFilter /> … </>
 *   }
 */
export { DEFAULT_OPERATORS, OPERATOR_LABELS } from './constants'
export { applyClientFilter } from './helpers/apply-client-filter'
export { buildRestQuery } from './helpers/query-builder'
export { getValidFilterRows, isValidFilterRow } from './helpers/validators'
export { useFilterQuery } from './hooks/use-filter-query'
export { useFilterContext, useOptionalFilterContext } from './provider/filter-context'
export { FilterProvider } from './provider/filter-provider'
export { ConditionalFilter, ConditionalFilterBody } from './ui/filter-root'
export type {
  FieldType,
  FilterConfig,
  FilterFieldDefinition,
  FilterState,
  FilterValue,
  OperatorType,
  SelectOption,
} from './types'
