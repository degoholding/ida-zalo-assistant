import { Plus } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { PermissionGate } from '@/core/authorization/permission-gate'
import { appConfig } from '@/core/config/app-config'
import { AdvancedFilterSection } from '@/shared/ui/advanced-filter-section'
import {
  ConditionalFilter,
  FilterProvider,
  useFilterQuery,
  useOptionalFilterContext,
} from '@/shared/conditional-filter'
import { DataTable } from '@/shared/data-table'
import { usePageResetOnFilterChange } from '@/shared/hooks/use-page-reset-on-filter-change'
import { useScrolled } from '@/shared/hooks/use-scrolled'
import { useUrlSearchParam } from '@/shared/hooks/use-url-search-param'
import type { ListParams } from '@/shared/types/api'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { PageContainer } from '@/shared/ui/page-container'
import { PageHeader } from '@/shared/ui/page-header'
import { QuickFilterField, QuickFilterSheet } from '@/shared/ui/quick-filter-sheet'
import { QuickFilterSourceSelect } from './quick-filter-source-select'
import { SearchField } from '@/shared/ui/search-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { CrudFormDialog } from './crud-form-dialog'
import { resolveSort } from './resolve-sort'
import type { CrudConfig, CrudRecord } from './types'
import { useCrudList } from './use-crud'

interface CrudListPageProps<T> {
  config: CrudConfig<T>
  /**
   * Chèn giữa TIÊU ĐỀ và bảng — chỗ cho thanh chuyển màn của những phân hệ gom
   * nhiều màn vào một mục menu (cụm Nghỉ phép, xem `LeaveSectionTabs`).
   *
   * Không nhét vào `renderToolbarExtra`: khe đó nằm trong nhóm NÚT bên phải
   * tiêu đề, còn thanh tab phải chạy hết bề ngang và đứng thành một dải riêng.
   */
  beforeContent?: ReactNode
  /**
   * Class thêm cho DẢI thanh công cụ — dùng để GHIM nó lên đầu khung cuộn ở khổ
   * điện thoại.
   *
   * ⚠️ Mốc `top` do TRANG khai, không phải khung này: nó bằng đúng chiều cao
   * của thứ đang ghim phía trên (`beforeContent`), mà chỉ trang mới biết mình
   * dựng mấy hàng điều hướng. Xem `list-sticky.ts`.
   */
  toolbarClassName?: string
}

export function CrudListPage<T extends CrudRecord>({
  config,
  beforeContent,
  toolbarClassName,
}: CrudListPageProps<T>) {
  /**
   * Bấm "Áp dụng" ở bộ lọc nâng cao là VIẾT LẠI toàn bộ query string, chỉ chừa lại
   * `searchParamName` + `preserveParams` (xem `use-filter-url-sync.ts`). Khai thiếu tên nào
   * thì tên đó bay khỏi URL — trước đây màn Hợp đồng mất sạch lọc nhanh và thứ tự sắp xếp
   * mỗi lần thêm một điều kiện nâng cao.
   *
   * Khóa lọc nhanh và `sort_by`/`sort_dir` do chính `CrudListContent` sinh ra nên gom sẵn ở
   * đây, khỏi bắt từng màn tự nhớ khai lại.
   */
  const filterConfig = useMemo(() => {
    if (!config.filterConfig) return undefined
    const auto = [...(config.quickFilters ?? []).map((qf) => qf.key), 'sort_by', 'sort_dir']
    return {
      ...config.filterConfig,
      preserveParams: [...new Set([...(config.filterConfig.preserveParams ?? []), ...auto])],
    }
  }, [config.filterConfig, config.quickFilters])

  if (filterConfig) {
    return (
      <FilterProvider config={filterConfig}>
        <CrudListContent
          config={config}
          beforeContent={beforeContent}
          toolbarClassName={toolbarClassName}
        />
      </FilterProvider>
    )
  }

  return (
    <CrudListContent
      config={config}
      beforeContent={beforeContent}
      toolbarClassName={toolbarClassName}
    />
  )
}

function CrudListContent<T extends CrudRecord>({
  config,
  beforeContent,
  toolbarClassName,
}: CrudListPageProps<T>) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const idKey = (config.idKey as string) || 'id'
  const searchParamName = config.searchParam || 'name'

  //  URL thắng; chưa ai bấm tiêu đề cột thì rơi về `defaultSort` của danh mục.
  //  Luật đầy đủ + bốn cái bẫy nằm ở `resolve-sort.ts`.
  const { by: sortBy, dir: sortDir } = resolveSort(searchParams, config)

  const { value: keyword, setValue: setKeyword, debouncedValue } = useUrlSearchParam()
  const [pageSize, setPageSize] = useState<number>(appConfig.defaultPageSize)
  // Trạng thái popup Thêm/Sửa: undefined = đóng · null = THÊM mới · bản ghi = SỬA.
  const [formItem, setFormItem] = useState<T | null | undefined>(undefined)

  //  Dải ghim đầu trang đổ bóng khi có nội dung trôi bên dưới — xem
  //  `toolbarClassName`. Đo ở khối bọc vì nó nằm cùng khung cuộn với dải ghim.
  const stickyRef = useRef<HTMLDivElement>(null)
  const scrolled = useScrolled(stickyRef)

  //  `useOptionalFilterContext` chứ không bản bắt buộc: màn không khai
  //  `filterConfig` thì không có `FilterProvider` bọc ngoài, và bản bắt buộc sẽ
  //  ném lỗi làm trắng cả trang.
  const filter = useOptionalFilterContext()
  const { queryParams, queryKey } = useFilterQuery()
  const [page, setPage] = usePageResetOnFilterChange([queryKey, debouncedValue, searchParams.toString()])

  const params: ListParams = { page, page_size: pageSize, ...queryParams }
  if (debouncedValue) {
    params[searchParamName] = debouncedValue
  }
  if (sortBy) {
    params.sort_by = sortBy
    params.sort_dir = sortDir
  }

  // Merge quick filters from URL params
  if (config.quickFilters) {
    for (const qf of config.quickFilters) {
      const val = searchParams.get(qf.key)
      if (val !== null && val !== '') {
        params[qf.key] = val
      }
    }
  }

  const { data, isLoading, isError } = useCrudList<T>(config.apiPath, params)

  const handleRowClick = (row: T) => {
    // Mở popup Sửa tại chỗ, hoặc điều hướng sang trang chi tiết (mặc định).
    if (config.openFormOnRowClick) {
      setFormItem(row)
    } else if (config.detailRoute) {
      navigate(config.detailRoute(row[idKey] as string | number))
    }
  }

  const handleSortChange = (newSortBy: string, newSortDir: 'asc' | 'desc') => {
    const nextParams = new URLSearchParams(searchParams)
    //  Khóa cột rỗng = nhịp thứ ba của tiêu đề cột: thôi sắp xếp. Phải XÓA tham
    //  số chứ đừng ghi chuỗi rỗng, kẻo đường dẫn gửi cho nhau còn dính
    //  `?sort_by=&sort_dir=asc`, đọc như đang sắp xếp theo một cột không tên.
    if (newSortBy) {
      nextParams.set('sort_by', newSortBy)
      nextParams.set('sort_dir', newSortDir)
    } else {
      nextParams.delete('sort_by')
      nextParams.delete('sort_dir')
    }
    setSearchParams(nextParams)
  }

  const handleQuickFilterChange = (key: string, value: string) => {
    const nextParams = new URLSearchParams(searchParams)
    if (value && value !== 'all') {
      nextParams.set(key, value)
    } else {
      nextParams.delete(key)
    }
    setSearchParams(nextParams)
  }

  //  Ô lọc nhanh dựng MỘT LẦN rồi đặt vào một trong hai chỗ tùy khổ màn: hàng
  //  ngang (khổ rộng) hoặc tờ trượt «Bộ lọc» (khổ hẹp). Dựng hai bản rồi ẩn bớt
  //  bằng `md:hidden` thì mỗi ô nằm hai lần trong cây DOM — trình đọc màn hình
  //  đọc cả hai, và mọi bài kiểm tìm theo tên đều vớ phải hai kết quả.
  const quickFilterSelects = (config.quickFilters ?? [])
    .filter((qf) => qf.type === 'select' && (qf.options || qf.sourceUrl))
    .map((qf) => {
      const val = searchParams.get(qf.key) || 'all'
      return {
        key: qf.key,
        label: qf.label,
        node: qf.sourceUrl && !qf.options ? (
          //  Mục nạp từ API (vd công ty) — xem `QuickFilterSourceSelect`
          <QuickFilterSourceSelect label={qf.label} sourceUrl={qf.sourceUrl} value={val} onChange={(v) => handleQuickFilterChange(qf.key, v)} />
        ) : (
          <Select value={val} onValueChange={(v) => handleQuickFilterChange(qf.key, v)}>
            <SelectTrigger className="h-9 w-full text-xs md:w-40" aria-label={qf.label}>
              <SelectValue placeholder={qf.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả {qf.label.toLowerCase()}</SelectItem>
              {(qf.options ?? []).map((opt) => (
                <SelectItem key={String(opt.value)} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      }
    })

  //  Đếm để gắn huy hiệu lên nút «Bộ lọc»: không có nó thì người dùng thấy nút
  //  trơn mà danh sách vẫn đang bị thu hẹp, rồi đi tìm lỗi ở dữ liệu.
  const activeQuickFilters = (config.quickFilters ?? []).filter((qf) => {
    const val = searchParams.get(qf.key)
    return Boolean(val) && val !== 'all'
  }).length

  //  Bảng đang bị thu hẹp bởi bất kỳ đường nào — ô tìm, ô lọc nhanh, hay điều
  //  kiện nâng cao. Quyết định câu nói khi bảng rỗng.
  const isFiltering =
    Boolean(debouncedValue) || activeQuickFilters > 0 || (filter?.activeCount ?? 0) > 0

  return (
    //  ⚠️ `fill` chỉ bật từ `md`: ở khổ hẹp màn nào khai `mobileCard` sẽ dựng một
    //  danh sách thẻ dài, mà `fill` nhét nó vào một khe vài trăm pixel và biến
    //  thành cuộn LỒNG — vuốt trúng mép ngoài khe thì trang không nhúc nhích.
    <PageContainer fill className="max-md:h-auto">
      <PageHeader
        title={config.title}
        //  ⚠️ Dòng mô tả ẨN ở khổ hẹp. Nó là câu GIỚI THIỆU màn — đọc một lần
        //  rồi thôi — nhưng ngốn hai dòng (~60px) ở đầu MỌI lần mở màn, ngay
        //  phía trên thứ người ta thật sự vào đây để xem. Trên màn rộng 60px đó
        //  không lấy chỗ của ai nên vẫn giữ. Cùng cách hai màn viết tay
        //  (Đơn nghỉ phép · Phiếu đặt phòng) đã làm.
        //
        //  ⚠️ Giữ `undefined` khi màn không khai mô tả — `description` là tùy
        //  chọn và **phần lớn màn CRUD không khai**. Bọc vô điều kiện thì
        //  `PageHeader` nhận một phần tử JSX (luôn truthy) rồi dựng khối mô tả
        //  RỖNG kèm `mt-1`, tức mọi màn đó ăn thêm một khe thừa vì một câu
        //  không tồn tại.
        description={
          config.description ? (
            <span className="max-md:hidden">{config.description}</span>
          ) : undefined
        }
        actions={
          //  Khổ hẹp: cụm nút chiếm trọn hàng và nút «Thêm» giãn hết phần còn
          //  lại — hành động chính của màn phải là thứ dễ chạm nhất.
          <div className="flex items-center gap-2 max-md:w-full">
            {config.renderToolbarExtra?.()}

            <PermissionGate entity={config.entity} action="create">
              <Button
                className="max-md:flex-1"
                onClick={() =>
                  config.createRoute ? navigate(config.createRoute) : setFormItem(null)
                }
              >
                <Plus className="mr-1.5 size-4" /> Thêm {config.unitLabel}
              </Button>
            </PermissionGate>
          </div>
        }
      />

      {/*  `group` + `data-scrolled` là đường dẫn tín hiệu «đã cuộn» xuống tới
           dải ghim nằm sâu bên trong (thanh công cụ do `DataTable` vẽ, tầng này
           không với tới bằng prop). Bóng đổ của dải đó đọc thuộc tính này. Dựng
           sẵn cho mọi màn CRUD — không ghim gì thì nó chỉ là một khối flex. */}
      <div
        ref={stickyRef}
        data-scrolled={scrolled ? '' : undefined}
        className="group flex min-h-0 flex-1 flex-col"
      >
        {beforeContent}

        <Card className="flex min-h-0 w-full min-w-0 flex-1 flex-col p-3 md:p-4">
        <DataTable
          fillHeight
          columns={config.columns}
          rows={data?.items}
          getRowId={(row: T) => String(row[idKey])}
          isLoading={isLoading}
          isError={isError}
          //  ⚠️ Câu «bảng rỗng» phải PHÂN BIỆT *rỗng vì bộ lọc* với *rỗng vì
          //  chưa có gì*. Một câu chung cho cả hai thì người vừa gõ nhầm một
          //  chữ đọc ra "chưa có dữ liệu" rồi tin là vậy — và ở màn danh mục,
          //  điều đó dẫn thẳng tới việc họ đi khai lại một bản ghi đã tồn tại.
          emptyMessage={
            isFiltering
              ? `Không có ${config.unitLabel} nào khớp bộ lọc.`
              : (config.emptyMessage ?? `Chưa có ${config.unitLabel} nào. Bấm «Thêm ${config.unitLabel}» để tạo.`)
          }
          storageKey={config.storageKey}
          toolbarClassName={toolbarClassName}
          onRowClick={handleRowClick}
          //  Chỉ những danh mục KHAI mới đổi sang thẻ ở khổ hẹp — xem
          //  `CrudConfig.mobileCard`.
          mobileCard={config.mobileCard}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          pagination={{
            page,
            pageSize,
            total: data?.total ?? 0,
            onPageChange: setPage,
            onPageSizeChange: setPageSize,
            unitLabel: config.unitLabel,
          }}
          toolbar={
            <>
              {/*  ⚠️ Bề rộng cứng `w-64` chỉ áp từ `md`. Dưới ngưỡng đó ô tìm là
                   `flex-1` với `flex-basis: 0` nên nó co theo phần còn thừa.

                   ⚠️ Nhưng phải có SÀN (`min-w-40`), nếu không nó co tới mức vô
                   dụng đúng lúc cần nhất: hàng công cụ mọc thêm nút «Xóa lọc»
                   NGAY KHI bắt đầu lọc, và bốn nút một hàng trên máy 390px bóp ô
                   tìm còn **73px** — tức hễ lọc một phát là ô tìm hỏng, đúng lúc
                   người ta hay muốn gõ thêm từ khóa để thu hẹp tiếp. Có sàn thì
                   cụm nút rớt xuống hàng riêng, hai hàng nhưng cả hai dùng được.
                   Chưa lọc gì (trạng thái thường ngày) vẫn đúng một hàng. */}
              <SearchField
                value={keyword}
                onChange={setKeyword}
                placeholder={config.searchPlaceholder || `Tìm ${config.unitLabel}…`}
                className="max-md:min-w-40 md:w-64 md:max-w-sm md:flex-none"
              />

              {/*  Khổ hẹp: mọi ô lọc dọn vào tờ trượt, hàng công cụ còn một dòng.
                   Cùng khuôn với bốn màn Thu mua và cụm Nghỉ phép. */}
              {(quickFilterSelects.length > 0 || config.filterConfig) && (
                <QuickFilterSheet
                  activeCount={activeQuickFilters + (filter?.activeCount ?? 0)}
                  onClearAll={() => {
                    for (const qf of config.quickFilters ?? []) handleQuickFilterChange(qf.key, '')
                    filter?.reset()
                  }}
                  onApply={filter?.apply}
                >
                  {quickFilterSelects.map((qf) => (
                    <QuickFilterField key={qf.key} label={qf.label}>
                      {qf.node}
                    </QuickFilterField>
                  ))}
                  {config.filterConfig && <AdvancedFilterSection />}
                </QuickFilterSheet>
              )}

              {/*  Cùng những ô chọn ấy dựng lần thứ hai cho hàng ngang khổ rộng.
                   State nằm trên URL nên hai bản luôn nói cùng một giá trị. */}
              <div className="hidden items-center gap-3 md:flex">
                {quickFilterSelects.map((qf) => (
                  <span key={qf.key}>{qf.node}</span>
                ))}
                {config.filterConfig && <ConditionalFilter />}
              </div>
            </>
          }
        />
        </Card>
      </div>

      {/* Form riêng nếu config khai `FormDialog` (vd Tài xế), ngược lại dùng form generic.
          Chỉ dựng khi MỞ để hộp thoại nạp state sạch mỗi lần (khỏi cần effect reset).
          `formItem`: null = Thêm mới · bản ghi = Sửa. */}
      {formItem !== undefined &&
        (() => {
          const FormDialog = config.FormDialog ?? CrudFormDialog
          return (
            <FormDialog
              open
              onOpenChange={(next) => !next && setFormItem(undefined)}
              config={config}
              item={formItem ?? undefined}
            />
          )
        })()}
    </PageContainer>
  )
}
