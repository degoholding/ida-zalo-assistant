import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SearchSelect } from './search-select'

const DOC_TYPES = [
  { value: '1', label: 'Công văn · CV' },
  { value: '28', label: 'Giấy nghỉ phép · GNP' },
  { value: '5', label: 'Hợp đồng · HD' },
  { value: '30', label: 'Đơn vị gửi nhận · DVN' },
]

function dung(onChange = vi.fn()) {
  render(
    <SearchSelect
      value=""
      onChange={onChange}
      options={DOC_TYPES}
      placeholder="Chọn loại văn bản"
      searchPlaceholder="Tìm theo tên hoặc mã loại…"
    />,
  )
  return onChange
}

async function openAndType(nguoi: ReturnType<typeof userEvent.setup>, tu: string) {
  await nguoi.click(screen.getByRole('combobox'))
  if (tu) await nguoi.type(screen.getByPlaceholderText(/Tìm theo tên/), tu)
}

describe('SearchSelect', () => {
  it('tìm theo TÊN, không bắt gõ đúng từ đầu nhãn', async () => {
    //  Lỗi khách báo 25/08/2026: ô chọn loại văn bản là `Select` thường, 33
    //  dòng, không có ô tìm. Typeahead của trình duyệt khớp từ ĐẦU nhãn mà nhãn
    //  lại bắt đầu bằng MÃ, nên gõ «nghỉ phép» không nhảy tới đâu và người dùng
    //  kết luận là danh mục không có loại đó.
    const nguoi = userEvent.setup()
    dung()
    await openAndType(nguoi, 'nghỉ phép')

    expect(screen.getByText('Giấy nghỉ phép · GNP')).toBeInTheDocument()
    expect(screen.queryByText('Công văn · CV')).not.toBeInTheDocument()
  })

  it('gõ KHÔNG DẤU vẫn ra — người Việt tìm thường không bỏ dấu', async () => {
    const nguoi = userEvent.setup()
    dung()
    await openAndType(nguoi, 'nghi phep')

    expect(screen.getByText('Giấy nghỉ phép · GNP')).toBeInTheDocument()
  })

  it('chữ Đ cũng bỏ dấu được — NFD không đụng tới nó', async () => {
    //  `normalize('NFD')` tách dấu thành ký tự tổ hợp, nhưng «đ» là một CHỮ CÁI
    //  riêng chứ không phải d có dấu, nên phải thay tay. Thiếu chỗ đó thì gõ
    //  "don vi" không ra "Đơn vị".
    const nguoi = userEvent.setup()
    dung()
    await openAndType(nguoi, 'don vi')

    expect(screen.getByText('Đơn vị gửi nhận · DVN')).toBeInTheDocument()
  })

  it('tìm theo MÃ loại cũng được', async () => {
    const nguoi = userEvent.setup()
    dung()
    await openAndType(nguoi, 'GNP')

    expect(screen.getByText('Giấy nghỉ phép · GNP')).toBeInTheDocument()
  })

  it('không khớp gì thì nói thẳng, đừng hiện danh sách trống', async () => {
    const nguoi = userEvent.setup()
    dung()
    await openAndType(nguoi, 'khong-co-that')

    expect(screen.getByText(/Không tìm thấy/i)).toBeInTheDocument()
  })

  it('chọn xong báo đúng giá trị cho bên gọi', async () => {
    const nguoi = userEvent.setup()
    const onChange = dung()
    await openAndType(nguoi, 'nghi phep')
    await nguoi.click(screen.getByText('Giấy nghỉ phép · GNP'))

    expect(onChange).toHaveBeenCalledWith('28')
  })

  it('chưa gõ gì thì hiện đủ danh sách', async () => {
    const nguoi = userEvent.setup()
    dung()
    await openAndType(nguoi, '')

    for (const item of DOC_TYPES) {
      expect(screen.getByText(item.label)).toBeInTheDocument()
    }
  })

  it('chữ trong ô căn TRÁI, không rơi vào giữa ô', () => {
    //  Khách báo 25/08/2026: chữ trong ô chọn nằm giữa ô, lệch hẳn so với các ô
    //  nhập bên cạnh. Gốc: trình duyệt mặc định `button { text-align: center }`,
    //  mà chữ nằm trong `<span>` con nên `justify-between` của flex không cứu
    //  được — nó xếp vị trí cái span, chữ BÊN TRONG span vẫn căn giữa. Trước đó
    //  `text-left` chỉ được gắn ở nhánh `wrap`.
    dung()
    expect(screen.getByRole('combobox').className).toMatch(/\btext-left\b/)
  })

  it('ô kiểu `wrap` (dùng trong bảng) cũng vẫn căn trái', () => {
    render(
      <SearchSelect value="" onChange={vi.fn()} options={DOC_TYPES} placeholder="Chọn" wrap />,
    )
    expect(screen.getByRole('combobox').className).toMatch(/\btext-left\b/)
  })

  it('giá trị KHÔNG còn trong danh mục vẫn hiện nguyên văn, không để ô trống', () => {
    //  Dữ liệu cũ hay trỏ tới mã đã bị gỡ khỏi danh mục. Giấu đi thì người dùng
    //  tưởng ô chưa chọn gì rồi chọn đè, mất luôn giá trị cũ mà không hay.
    render(
      <SearchSelect value="999" onChange={vi.fn()} options={DOC_TYPES} placeholder="Chọn" />,
    )
    expect(screen.getByRole('combobox')).toHaveTextContent('999')
  })

  it('danh sách dài bị cắt thì NÓI RA còn bao nhiêu, không im lặng', async () => {
    //  Ô chọn nhân sự nạp cả nghìn dòng nhưng chỉ vẽ 60. Cắt mà không nói thì
    //  người dùng cuộn tới đáy, không thấy tên mình cần, rồi kết luận là hệ
    //  thống chưa có người đó.
    const nhieu = Array.from({ length: 75 }, (_, i) => ({
      value: String(i),
      label: `Nhân sự ${i}`,
    }))
    const nguoi = userEvent.setup()
    render(<SearchSelect value="" onChange={vi.fn()} options={nhieu} placeholder="Chọn" />)
    await nguoi.click(screen.getByRole('combobox'))

    expect(screen.getByText(/Còn 15 mục nữa/)).toBeInTheDocument()
  })

  it('kiểu searchInTrigger: ô đã chọn hiện NGAY nhãn trong ô nhập (không phải nút)', () => {
    //  Yêu cầu 07/09/2026: cho gõ từ khóa ngay trên ô đang hiện giá trị đã chọn
    //  (ô điều phối Xe/Tài xế). Ô lúc này là <input> mang sẵn nhãn đã chọn.
    render(
      <SearchSelect value="5" onChange={vi.fn()} options={DOC_TYPES} searchInTrigger placeholder="Chọn loại" />,
    )
    expect(screen.getByRole('combobox')).toHaveValue('Hợp đồng · HD')
  })

  it('kiểu searchInTrigger: gõ THẲNG trên ô để lọc rồi chọn, báo đúng value', async () => {
    const nguoi = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SearchSelect
        value=""
        onChange={onChange}
        options={DOC_TYPES}
        searchInTrigger
        placeholder="Chọn loại"
      />,
    )
    const combobox = screen.getByRole('combobox')
    await nguoi.click(combobox)
    await nguoi.type(combobox, 'nghi phep')
    //  Gõ ngay trên ô → lọc; chọn xong báo đúng value cho bên gọi.
    await nguoi.click(screen.getByText('Giấy nghỉ phép · GNP'))
    expect(onChange).toHaveBeenCalledWith('28')
  })

  it('kiểu searchInTrigger: bấm LẦN HAI vào ô đang mở không đóng danh sách, gõ không bị nối vào nhãn cũ', async () => {
    //  bao-CR-475: Radix coi cú bấm vào chính ô gõ (nằm NGOÀI khung danh sách) là «bấm
    //  ra ngoài» → đóng danh sách, ô hiện lại nhãn đã chọn, gõ tiếp thành «Hợp đồng · HDb»
    //  và không còn mục nào khớp. Người dùng thường bấm lại vào ô để đặt con trỏ — đúng
    //  thao tác đại ca yêu cầu («nhập text rồi chọn trên đó»).
    const nguoi = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SearchSelect value="5" onChange={onChange} options={DOC_TYPES} searchInTrigger placeholder="Chọn loại" />,
    )
    const combobox = screen.getByRole('combobox')
    await nguoi.click(combobox)
    await nguoi.click(combobox)
    expect(combobox).toHaveAttribute('aria-expanded', 'true')
    await nguoi.type(combobox, 'nghi')
    expect(combobox).toHaveValue('nghi')
    await nguoi.click(screen.getByText('Giấy nghỉ phép · GNP'))
    expect(onChange).toHaveBeenCalledWith('28')
  })

  it('lọc còn ít hơn mức cắt thì KHÔNG hiện câu «còn … mục»', async () => {
    const nhieu = Array.from({ length: 75 }, (_, i) => ({
      value: String(i),
      label: `Nhân sự ${i}`,
    }))
    const nguoi = userEvent.setup()
    render(
      <SearchSelect
        value=""
        onChange={vi.fn()}
        options={nhieu}
        placeholder="Chọn"
        searchPlaceholder="Tìm theo tên hoặc mã loại…"
      />,
    )
    await nguoi.click(screen.getByRole('combobox'))
    await nguoi.type(screen.getByPlaceholderText(/Tìm theo tên/), 'Nhân sự 7')

    expect(screen.queryByText(/Còn \d+ mục nữa/)).not.toBeInTheDocument()
  })
})
