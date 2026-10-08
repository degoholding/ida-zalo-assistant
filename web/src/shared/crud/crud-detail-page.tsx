import { ArrowLeft, CircleCheck, CircleX, Hash, Loader2, Save } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { PermissionGate } from '@/core/authorization/permission-gate'
import { usePermission } from '@/core/authorization/use-permission'
import { AuditTimeline } from '@/shared/audit'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { DeleteConfirmButton } from '@/shared/ui/delete-confirm-button'
import { ErrorState } from '@/shared/ui/error-state'
import { PageContainer } from '@/shared/ui/page-container'
import { PageHeader } from '@/shared/ui/page-header'
import { RecordIdentityCard, type IdentityChip } from '@/shared/ui/record-identity-card'
import { Skeleton } from '@/shared/ui/skeleton'
import { ScrollableTabsList } from '@/shared/ui/scrollable-tabs-list'
import { TAB_TRIGGER_UNDERLINE } from '@/shared/ui/tab-underline'
import { Tabs, TabsContent, TabsTrigger } from '@/shared/ui/tabs'
import { useScrolled } from '@/shared/hooks/use-scrolled'
import { useSingleFlight } from '@/shared/hooks/use-single-flight'
import { useUrlParamState } from '@/shared/hooks/use-url-param-state'
import { cn } from '@/shared/utils/cn'
import { CrudFormFields } from './crud-form-fields'
import { buildFormDefaults, toApiPayload } from './field-values'
import { resolveFormFields } from './resolve-form-fields'
import { TAB_INFO, resolveTabKey } from './resolve-tab-key'
import type { CrudConfig, CrudRecord } from './types'
import { useCrudDelete, useCrudDetail, useCrudSave } from './use-crud'

interface CrudDetailPageProps<T> {
  config: CrudConfig<T>
}

/**
 * Trang CHI TIẾT của lớp CRUD khai báo — và cũng là trang THÊM MỚI.
 *
 * Một component cho cả hai vì hai màn ấy chỉ khác nhau ở chỗ *đã có bản ghi hay
 * chưa*: cùng bộ ô nhập, cùng luật quyền, cùng chỗ hiện lỗi. Tách đôi là hai
 * bản chép, và mọi ô thêm về sau phải nhớ thêm ở cả hai chỗ.
 *
 * Chế độ THÊM MỚI bật khi route KHÔNG có `:id` (vd `/hr/leave-types/new` — xem
 * `CrudConfig.createRoute`). Khi đó: không gọi API chi tiết, không có thẻ danh
 * tính / dấu vết / nút Xóa (chưa có gì để kể), ô khai `readonlyOnEdit` mở ra cho
 * nhập, và lưu xong thì nhảy thẳng sang trang chi tiết của bản ghi vừa tạo.
 */
export function CrudDetailPage<T extends CrudRecord>({
  config,
}: CrudDetailPageProps<T>) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = usePermission()
  const idKey = (config.idKey as string) || 'id'

  //  Route tĩnh (`/hr/leave-types/new`) không có tham số `:id`.
  const isCreate = !id
  const canSave = can(config.entity, isCreate ? 'create' : 'write')

  const { data: item, isLoading, isError } = useCrudDetail<T>(config.apiPath, id)

  //  Tín hiệu «trang đã cuộn» cho các dải ghim nằm SÂU bên trong (thanh công cụ
  //  của bảng trong tab — do `DataTable` vẽ, tầng này không với tới bằng prop).
  //  Bóng đổ của chúng đọc `group-data-[scrolled]`; xem `list-sticky.ts`.
  //
  //  ⚠️ `nodeKey` là BẮT BUỘC ở đây, không phải trang trí: lượt render đầu của
  //  trang này là **khung xương** (xem nhánh `isLoading` bên dưới) nên khối mang
  //  `stickyRef` chưa có trong DOM, và không có `nodeKey` thì hook dò khung cuộn
  //  đúng một lần rồi bám vào `window` vĩnh viễn. Xem `use-scrolled.ts`.
  const stickyRef = useRef<HTMLDivElement>(null)
  const scrolled = useScrolled(stickyRef, { nodeKey: isCreate || Boolean(item) })

  //  ⚠️ **TAB ĐANG MỞ NẰM Ở URL, không nằm trong state của Radix.** Bấm một
  //  dòng trong tab con là RỜI TRANG (vd tab «Người đang giữ» của Chức vụ dẫn
  //  sang hồ sơ nhân sự); bấm Lùi mà tab nhảy về «Thông tin» thì người dùng
  //  phải mở lại tab, cuộn lại, lọc lại — mỗi lần xem một người là một vòng như
  //  vậy. Cùng khuôn với màn Hồ sơ nhân sự (`?tab=`, duoc-CR-315), và kèm theo
  //  thì gửi link thẳng vào một tab được.
  //
  //  `useUrlParamState` ghi bằng `replace` — đổi tab năm lần rồi bấm Lùi thì
  //  người ta mong về TRANG TRƯỚC chứ không mong lùi qua từng lần bấm tab.
  const [tabParam, setTab] = useUrlParamState('tab', TAB_INFO)
  const activeTab = resolveTabKey(tabParam, config.tabs)
  //  Chặn bấm trùng trong cùng một nhịp — xem `useSingleFlight`.
  const once = useSingleFlight()
  const saveMutation = useCrudSave<T>(config.apiPath, config.title)
  const deleteMutation = useCrudDelete(config.apiPath, config.title)

  const listUrl = config.listRoute || '/'

  //  ⚠️ MỘT CỘT cho CẢ TRANG — xem `CrudConfig.detailMaxWidth`. Chặn riêng biểu
  //  mẫu thì nó ngắn cụt nằm dưới thẻ danh tính rộng hết màn hình, trông như một
  //  khối bị lỗi chứ không phải một cột cố ý.
  const pageWidth = cn('mx-auto w-full', config.detailMaxWidth ?? 'max-w-5xl')

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors },
  } = useForm<Record<string, unknown>>({
    //  ⚠️ Bộ ô dựng theo **bản ghi**, không theo giá trị đang gõ: chỗ này chạy
    //  TRƯỚC khi có form nên chưa có gì để `watch`. Đúng thứ cần — giá trị khởi
    //  tạo phải khớp bản ghi vừa tải. Ô mọc thêm về sau (người dùng đổi loại hồ
    //  sơ) tự đăng ký lúc `CrudFormFields` dựng chúng ra.
    defaultValues: buildFormDefaults(resolveFormFields(config.formFields, item ?? {}), item),
  })

  // Bản ghi về sau khi gọi API (hoặc sau khi lưu) thì nạp lại vào form.
  useEffect(() => {
    if (item) {
      reset(buildFormDefaults(resolveFormFields(config.formFields, item), item))
    }
  }, [item, config.formFields, reset])

  if (!isCreate && isLoading) {
    return (
      <PageContainer className={pageWidth}>
        <Skeleton className="mb-5 h-20 w-full" />
        <Skeleton className="h-80 w-full" />
      </PageContainer>
    )
  }

  if (!isCreate && (isError || !item)) {
    return (
      <ErrorState
        title={`Không tìm thấy ${config.unitLabel}`}
        description={`${config.title} có thể đã bị xóa hoặc bạn không có quyền xem.`}
      >
        <Button variant="outline" onClick={() => navigate(listUrl)}>
          <ArrowLeft />
          Về danh sách
        </Button>
      </ErrorState>
    )
  }

  const itemName =
    item &&
    (config.getItemName
      ? config.getItemName(item)
      : String(item.name || item.code || item[idKey] || config.title))

  //  ⚠️ THẺ DANH TÍNH dùng tên TRẦN, không dùng `getItemName`. Hai chỗ hỏi hai
  //  câu khác nhau, và `getItemName` khai ra để trả lời câu thứ hai: *«Xóa bản
  //  ghi nào?»* — ở đó cái mã đính kèm là thứ phân biệt tuyệt đối, đáng có.
  //  Thẻ danh tính thì đã bày chính cái mã ấy thành một huy hiệu ngay bên dưới
  //  tiêu đề, nên in lần nữa trong ngoặc là nói hai lần cùng một điều. Trên màn
  //  390px điều đó thành lỗi thấy được: tiêu đề bị cắt giữa chừng — «Trưởng
  //  phòng Thu mua (Demo) (tru…» — tức phần bị hy sinh lại chính là phần trùng.
  //  Thẻ ở khổ điện thoại (`mobileCard` của các config) vốn đã dùng tên trần;
  //  đây là chỗ duy nhất còn lệch.
  const cardTitle = item && String(item.name || item.title || itemName)

  const onSubmit = (values: Record<string, unknown>) =>
    once(async () => {
    //  Dựng bộ ô theo GIÁ TRỊ VỪA GỬI — người dùng có thể vừa đổi loại hồ sơ
    //  trong chính lần sửa này, nên lấy bộ ô của bản ghi cũ là quy đổi nhầm.
    const fields = resolveFormFields(config.formFields, values)
    const payload = toApiPayload(fields, values)
    const saved = await saveMutation.mutateAsync({
      id: item ? (item[idKey] as string | number) : undefined,
      values: config.buildPayload ? config.buildPayload(payload, item) : payload,
    })

    //  Tạo xong thì đi tiếp sang chính bản ghi vừa tạo, KHÔNG ở lại form rỗng:
    //  đứng yên thì bấm Lưu lần nữa là tạo thêm một bản trùng. `replace` để nút
    //  Lùi đưa về danh sách chứ không quay lại form đã gửi.
    if (isCreate) {
      const newId = (saved.data as CrudRecord | undefined)?.[idKey] as string | number | undefined
      navigate(newId && config.detailRoute ? config.detailRoute(newId) : listUrl, {
        replace: true,
      })
    }
    })

  const handleDelete = async () => {
    if (!item) return
    await deleteMutation.mutateAsync(item[idKey] as string | number)
    navigate(listUrl)
  }

  // Danh sách chip danh tính mặc định nếu config không tự khai
  const chips: IdentityChip[] = !item
    ? []
    : config.chips
    ? config.chips(item)
    : [
        ...(item.code
          ? [{ icon: Hash, text: String(item.code), tone: 'code' as const }]
          : []),
        ...(item.is_active !== undefined
          ? [
              {
                icon: item.is_active ? CircleCheck : CircleX,
                text: item.is_active ? 'Đang dùng' : 'Ngừng / Ẩn',
                tone: item.is_active ? ('ok' as const) : ('muted' as const),
              },
            ]
          : []),
      ]

  const infoPanel = (
    <div className="space-y-6">
      {/*  Màn CHỈ XEM (`readOnlyDetail`) không có biểu mẫu — xem `CrudConfig.readOnlyDetail`. */}
      {!config.readOnlyDetail && (
      <form
        id="crud-detail-form"
        onSubmit={handleSubmit(onSubmit)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
            e.preventDefault()
          }
        }}
      >
        {/*  Lớp khung NGOÀI CÙNG của ba lớp lồng nhau — xem ghi chú ở
             `crud-form-fields.tsx`. */}
        <Card className="gap-4 p-3 sm:p-5">
          <CrudFormFields
            fields={config.formFields}
            register={register}
            control={control}
            errors={errors}
            watch={watch}
            sectionHints={config.formSections}
            //  `readonlyOnEdit` chỉ khóa lúc SỬA — ô «Mã loại nghỉ» phải nhập
            //  được đúng một lần, chính là lần tạo này.
            isReadonly={(field) => !canSave || (!isCreate && Boolean(field.readonlyOnEdit))}
          />
        </Card>
      </form>
      )}

      {item && config.renderExtra && <div>{config.renderExtra(item)}</div>}

      {Boolean(item?.[idKey]) && item && (
        <div>
          <AuditTimeline entity={config.entity} entityId={Number(item[idKey])} showMessage />
        </div>
      )}
    </div>
  )

  return (
    <PageContainer className={pageWidth}>
      {/*  ⚠️ Hàng nút DÍNH khi cuộn. Form danh mục dài hơn một màn — riêng
           *Loại nghỉ* đo được 1943px ở khổ 390px — nên nút Lưu đứng yên ở đầu
           trang nghĩa là gõ xong ô cuối phải cuộn ngược hết chiều dài trang mới
           lưu được, rồi cuộn xuống lại để kiểm. Cùng luật với `PageHeader.sticky`
           mà hai màn chi tiết Nghỉ phép đang dùng; đây là màn duy nhất còn thiếu.

           Lề âm để dải chạy hết bề ngang khung thay vì thụt vào theo phần đệm
           của `PageContainer` — dính mà còn hai mép hở thì nhìn ra ngay là vá. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b bg-canvas px-4 py-3 lg:-mx-6 lg:-mt-6 lg:px-6">
        {/*  `-ml-2` kéo chữ về sát mép: nút `ghost` có phần đệm ngang riêng nên
             không có nó thì dòng «Danh sách …» thụt vào so với mọi thẻ bên dưới.

             ⚠️ Tên danh mục THÔI HIỆN ở khổ điện thoại. «Danh sách phòng họp»
             đo được **186px trên 390px** — gần một nửa hàng — trong khi hàng này
             còn phải chứa nút Lưu và nút Xóa; ba thứ chen nhau còn 24px khe.
             Giấu đi không mất nghĩa: mũi tên đã nói đây là đường lùi, và dòng
             chỉ mục ngay phía trên vẫn ghi đủ tên danh mục.

             ⚠️ `sr-only` chứ KHÔNG `hidden`: `hidden` là `display:none`, tức
             trình đọc màn hình cũng mất luôn và người mù chỉ nghe được "Danh
             sách" — trong khi họ không có mũi tên lẫn dòng chỉ mục để suy ra
             danh sách nào. `sr-only` giấu khỏi mắt mà vẫn đọc được, và nó
             `position:absolute` nên cũng không chiếm chỗ trong hàng. */}
        <Button variant="ghost" size="sm" className="-ml-2 min-w-0" asChild>
          <Link to={listUrl}>
            <ArrowLeft />
            <span className="truncate">
              Danh sách<span className="max-sm:sr-only"> {config.unitLabel}</span>
            </span>
          </Link>
        </Button>

        <div className="flex shrink-0 items-center gap-2">
          {item && config.detailActions?.(item)}
          {!config.readOnlyDetail && (
            <PermissionGate entity={config.entity} action={isCreate ? 'create' : 'write'}>
              <Button
                type="submit"
                form="crud-detail-form"
                disabled={saveMutation.isPending || !canSave}
              >
                {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                {isCreate ? `Tạo ${config.unitLabel}` : 'Lưu'}
              </Button>
            </PermissionGate>
          )}

          {item && (
            <PermissionGate entity={config.entity} action="delete">
              <DeleteConfirmButton
                recordName={itemName as string}
                pending={deleteMutation.isPending}
                onConfirm={handleDelete}
                warning={config.deleteWarning}
              />
            </PermissionGate>
          )}
        </div>
      </div>

      {/*  `group` + `data-scrolled` là đường dẫn tín hiệu «đã cuộn» xuống dải
           ghim bên trong tab. Dựng sẵn cho mọi trang chi tiết CRUD — tab nào
           không ghim gì thì đây chỉ là một khối `space-y-6` như cũ.

           ⚠️ `group` này KHÔNG ĐẶT TÊN, giống bên `CrudListPage`. Nghĩa là mọi
           biến thể `group-*` không tên bên trong trang sẽ bắt vào NÓ chứ không
           bắt vào khối `group` gần nhất — vd một `IconInput` thả vào tab nào đó
           sẽ đổi màu icon mỗi khi bất kỳ ô nào trong trang được focus. Hiện
           chưa component nào trong trang chi tiết dính (đã rà: `switch` và
           `avatar` dùng group CÓ TÊN, `label` bắt `data-disabled` nên không
           trùng `data-scrolled`). Thêm component mới thì rà lại, hoặc đặt tên
           cho nhóm ở cả ba chỗ — `TOOLBAR_STICKY_BASE` dùng chung với màn danh
           sách nên phải đổi cùng lúc. */}
      <div
        ref={stickyRef}
        data-scrolled={scrolled ? '' : undefined}
        className="group space-y-6"
      >
        {/*  Chưa có bản ghi thì không dựng thẻ danh tính: nó sinh ra để trưng mã
             / trạng thái của MỘT bản ghi, để rỗng chỉ còn một cái khung. */}
        {item ? (
          <RecordIdentityCard title={cardTitle as string} chips={chips} media={config.detailMedia?.(item)} />
        ) : (
          <PageHeader
            title={`Thêm ${config.unitLabel}`}
            description={config.description ?? `Điền thông tin rồi bấm «Tạo ${config.unitLabel}».`}
          />
        )}

        {/*  ⚠️ Khổ hẹp: dải tab đổi sang kiểu GẠCH CHÂN, và khe dưới nó khép lại
             còn 8px. Rãnh xám của `TabsList` là `bg-muted`, mà `--muted` trong
             bảng màu này **trùng đúng nền trang** — thứ lẽ ra gom các tab thành
             MỘT bộ điều khiển thì vô hình, chỉ còn một viên trắng nổi cạnh một
             dòng chữ xám, cách thẻ nội dung một khoảng rộng. Ba mảnh rời nhau,
             không mảnh nào nói mảnh kia liên quan tới nó (khách báo *"nhìn nó
             rời rạc quá"*, 10/09/2026). Đường kẻ chân trải hết bề ngang là cái
             neo còn thiếu, và khe hẹp lại thì dải tab với thẻ bên dưới đọc ra
             thành một khối. Màn rộng không đổi: ở đó dải co theo nội dung nên nó
             vốn đã ra hình một bộ điều khiển. Xem `shared/ui/tab-underline.ts`. */}
        {item && config.tabs && config.tabs.length > 0 ? (
          <Tabs
            value={activeTab}
            onValueChange={setTab}
            className="space-y-4 max-md:space-y-2"
          >
            {/*  ⚠️ Dải tab TỰ CUỘN NGANG: màn nhiều tab (Nhà cung cấp có 5)
                 không vừa một hàng 390px, mà để nó tràn là kéo theo CẢ TRANG
                 trôi ngang. `ScrollableTabsList` cũng lo việc kéo tab đang mở
                 vào tầm nhìn — thiếu nhịp đó thì link sâu `?tab=…` mở ra một
                 dải không tab nào sáng lên. */}
            <ScrollableTabsList value={activeTab} className="mb-2 max-md:mb-0">
              <TabsTrigger value={TAB_INFO} className={TAB_TRIGGER_UNDERLINE}>
                Thông tin
              </TabsTrigger>
              {config.tabs.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key} className={TAB_TRIGGER_UNDERLINE}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </ScrollableTabsList>

            <TabsContent value={TAB_INFO} className="space-y-6">
              {infoPanel}
            </TabsContent>

            {config.tabs.map((tab) => (
              <TabsContent key={tab.key} value={tab.key} className="space-y-4">
                {tab.render(item)}
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <div className="space-y-6">{infoPanel}</div>
        )}
      </div>
    </PageContainer>
  )
}
