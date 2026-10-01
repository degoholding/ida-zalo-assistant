import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { TabsList } from '@/shared/ui/tabs'
import { cn } from '@/shared/utils/cn'
import { TAB_LIST_UNDERLINE } from './tab-underline'

/** Khoảng thở chừa hai bên khi kéo tab đang mở vào tầm nhìn. */
const SCROLL_PADDING = 16
/** Bấm mũi tên một lần thì đi bao nhiêu phần bề ngang đang thấy. */
const STEP_RATIO = 0.7
/** Sai số cho phép khi so mốc cuộn — trình duyệt trả số lẻ sau khi phóng to. */
const EDGE_SLACK = 2

interface ScrollableTabsListProps {
  /** Khóa tab đang mở — đổi giá trị là kéo tab đó vào tầm nhìn. */
  value: string
  children: ReactNode
  className?: string
  /**
   * Lớp gắn thẳng vào `TabsList` bên trong (khác `className` — lớp đó gắn vào
   * khung bọc ngoài cùng).
   *
   * Dùng khi màn cần chỉnh dáng dải tab **từ `md` trở lên**, nơi khung này hết
   * cuộn và trả dải về `TabsList` nền xám: dải nào dài quá bề ngang khung ở
   * đúng dải 768–805px thì tab cuối rơi ra ngoài mà không có cách nào kéo tới.
   */
  listClassName?: string
}

/**
 * Dải tab **CUỘN NGANG** ở khổ điện thoại, cho màn có nhiều tab.
 *
 * ⚠️ **Vì sao phải cuộn chứ không bóp cho vừa.** Hồ sơ nhân sự có 5 tab với
 * nhãn tiếng Việt dài; đo ở 390px thì **riêng phần chữ ở cỡ 12px đã 361px**,
 * trong khi bề ngang dùng được chỉ 358px — tức có bỏ hết biểu tượng và hạ cỡ
 * chữ hết mức thì vẫn không đủ. Bản trước để dải rộng **633px** tràn ra ngoài,
 * kéo theo CẢ TRANG trôi ngang: người dùng vuốt dọc hơi chéo một chút là nội
 * dung dạt sang, và ba tab cuối thì không có cách nào chạm tới.
 *
 * ⚠️ **Chỉ dải tab cuộn, KHÔNG phải cả trang** — đó là toàn bộ điểm của khung
 * bọc này. Lề âm `-mx-4` + đệm bù `px-4` để dải chạm được hai mép màn hình, nếu
 * không thì tab đầu và tab cuối bị kẹt sau phần đệm của trang.
 *
 * ⚠️ **Phải có MŨI TÊN ở mép, không được chỉ dựa vào việc lộ nửa tab.** Nửa tab
 * ló ra là dấu hiệu quá mờ: người dùng đọc nó thành «chữ bị cắt» chứ không thành
 * «còn nữa, kéo đi» (khách báo 10/09/2026). Mũi tên vừa NÓI ra là kéo được, vừa
 * BẤM được — trên máy tính không có ngón tay để vuốt ngang, mà chuột thì phải
 * giữ Shift mới lăn ngang được; không có nút thì mấy tab cuối coi như không tồn
 * tại. Hai nút tự hiện/ẩn theo chỗ đang đứng: không còn gì bên nào thì nút bên
 * đó biến mất, chứ để một nút xám bấm không ăn là nói dối.
 *
 * ⚠️ **Tab đang mở tự được kéo vào tầm nhìn** — không có nhịp này thì mở link
 * sâu (`?tab=account`) ra một dải chỉ thấy ba tab đầu, **không tab nào sáng
 * lên**, và người dùng đọc ra là trang lỗi chứ không phải là còn tab bên phải.
 * Cùng lỗi khi biểu mẫu nhảy tới tab chứa ô sai (`onInvalid`): nó đổi tab mà
 * dải không nhúc nhích.
 *
 * ⚠️ Kéo bằng `scrollLeft` chứ không `scrollIntoView`: hàm kia **kéo cả trang
 * theo chiều dọc** khi phần tử nằm ngoài khung nhìn, và jsdom không cài nó nên
 * test dựng component này sẽ nổ. Chỉ kéo khi tab thật sự nằm ngoài — đã thấy
 * rồi mà vẫn căn giữa là dải nhảy một cái mỗi lần đổi tab.
 */
export function ScrollableTabsList({
  value,
  children,
  className,
  listClassName,
}: ScrollableTabsListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  /** Đọc lại xem còn tab khuất bên trái / bên phải không. */
  const readEdges = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    setEdges({
      left: scroller.scrollLeft > EDGE_SLACK,
      right: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - EDGE_SLACK,
    })
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    //  Kéo tab đang mở vào tầm nhìn TRƯỚC khi đo mép, không thì đo xong mới
    //  kéo và hai nút hiện sai một nhịp.
    const active = scroller.querySelector<HTMLElement>('[data-state="active"]')
    if (active) {
      const left = active.offsetLeft
      const right = left + active.offsetWidth
      if (left < scroller.scrollLeft) {
        scroller.scrollLeft = Math.max(0, left - SCROLL_PADDING)
      } else if (right > scroller.scrollLeft + scroller.clientWidth) {
        scroller.scrollLeft = right - scroller.clientWidth + SCROLL_PADDING
      }
    }
    readEdges()

    //  ⚠️ Theo dõi cả ĐỔI CỠ, không chỉ sự kiện cuộn: xoay ngang máy hay kéo
    //  rộng cửa sổ là dải bỗng đủ chỗ, mà không đo lại thì mũi tên còn nguyên
    //  trong khi chẳng còn gì để kéo tới.
    const observer = new ResizeObserver(readEdges)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [value, readEdges])

  const nudge = (direction: 1 | -1) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollBy({ left: direction * scroller.clientWidth * STEP_RATIO, behavior: 'smooth' })
  }

  return (
    //  Lề âm ở khối NGOÀI để hai mũi tên neo đúng vào mép màn hình; khung cuộn
    //  bên trong giữ phần đệm để tab đầu/cuối không dính mép.
    <div className={cn('relative max-md:-mx-4', className)}>
      <div
        ref={scrollerRef}
        onScroll={readEdges}
        //  ⚠️ `scrollbar-none` (khai ở `index.css`): thanh cuộn ngang vẽ một vệt
        //  xám dày ngay dưới hàng tab, đọc ra như một đường kẻ của thiết kế chứ
        //  không như thanh cuộn.
        //
        //  ⚠️ **Đường kẻ chân nằm ở KHUNG CUỘN, không ở dải tab.** Dải rộng theo
        //  nội dung (`w-max`): màn hai tab thì nó chỉ 161px, nên để `border-b` ở
        //  đó là đường kẻ đứt giữa chừng trong khi thẻ nội dung bên dưới rộng
        //  374px — hai khối rời hẳn nhau, không còn gì nối chúng lại (khách báo
        //  10/09/2026). Ở khung cuộn thì đường kẻ luôn chạy hết bề ngang, bất kể
        //  bao nhiêu tab, và nó chính là thứ neo dải tab vào phần dưới.
        className="max-md:overflow-x-auto max-md:border-b max-md:px-4 max-md:scrollbar-none"
      >
        {/*  ⚠️ `w-max` phải đứng SAU `TAB_LIST_UNDERLINE` — hằng đó khai
             `max-md:w-full`, và tailwind-merge lấy lớp đứng sau khi hai lớp cùng
             nhóm. Để trước là dải co về đúng 390px rồi các tab chen nhau.

             ⚠️ Tab phải `flex-none` trong khung cuộn. `TabsTrigger` của shadcn
             khai `flex-1` (= `flex: 1 1 0%`) để chia đều một dải cố định; thả
             nguyên vào dải `w-max` thì mỗi tab có bề rộng cơ sở BẰNG 0 và chúng
             **đè chồng lên nhau** — nhãn tab này in lên biểu tượng tab kia.
             Không sửa vào `TAB_TRIGGER_UNDERLINE` vì màn Phiếu đặt phòng dùng
             đúng `flex-1` đó để chia đều ba tab trên một hàng vừa khít. */}
        <TabsList
          className={cn(
            TAB_LIST_UNDERLINE,
            //  Bỏ đường kẻ của DẢI — nó đã chuyển lên khung cuộn (xem trên).
            'max-md:w-max max-md:border-b-0 max-md:[&_[data-slot=tabs-trigger]]:flex-none',
            listClassName,
          )}
        >
          {children}
        </TabsList>
      </div>

      {edges.left && <EdgeButton side="left" onClick={() => nudge(-1)} />}
      {edges.right && <EdgeButton side="right" onClick={() => nudge(1)} />}
    </div>
  )
}

/**
 * Mũi tên ở một mép dải tab.
 *
 * ⚠️ Nền chuyển sắc (`from-canvas`) chứ không nền đặc: tab trượt vào **mờ dần
 * rồi mới khuất**, đó là thứ nói «còn nữa» rõ hơn cả mũi tên. Nền đặc thì tab
 * bị cắt cụt ngang thân, nhìn ra như lỗi vẽ.
 *
 * ⚠️ `md:hidden` — từ `md` khung không còn cuộn nên nút này không điều khiển
 * được gì; `bottom-px` để nút đứng TRÊN đường kẻ chân, không đè lên nó.
 */
function EdgeButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const isLeft = side === 'left'
  const Icon = isLeft ? ChevronLeft : ChevronRight

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isLeft ? 'Xem các tab bên trái' : 'Xem các tab bên phải'}
      className={cn(
        'absolute top-0 bottom-px flex w-10 items-center md:hidden',
        isLeft
          ? 'left-0 justify-start bg-gradient-to-r from-canvas from-60% to-transparent pl-1'
          : 'right-0 justify-end bg-gradient-to-l from-canvas from-60% to-transparent pr-1',
      )}
    >
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}
