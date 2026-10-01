# Ô chọn ngày

> **Luật một dòng: KHÔNG dùng `<input type="date">`. Mọi ô ngày đều là `DatePicker`.**

Ô ngày mặc định của trình duyệt mỗi hệ điều hành vẽ một kiểu, không nhận được
token màu / bo góc / chiều cao của bộ giao diện chung, và trên Windows còn hiện
`mm/dd/yyyy` trong khi cả hệ thống đọc `dd/mm/yyyy`. Nút mở lịch cũng không tắt
được, nên form nào lỡ dùng là lệch hẳn khỏi các form còn lại.

---

## 1. Khung tối thiểu

`DatePicker` (`@/shared/ui/date-picker`) = `Button` + `Popover` + `Calendar`
(bọc `react-day-picker`, đã cài sẵn locale `vi`).

```tsx
import { DatePicker } from '@/shared/ui/date-picker'

<DatePicker value={value} onChange={setValue} />
```

`value` / `onChange` đi bằng **chuỗi `yyyy-mm-dd`** — đúng dạng API nhận và trả.
Chỉ phần HIỂN THỊ mới đổi sang `dd/mm/yyyy`, nên chỗ gọi không phải quy đổi gì.
Chưa chọn = chuỗi rỗng `''` (không phải `null`, không phải `undefined`).

### Props

| Prop          | Mặc định      | Ý nghĩa                                                           |
| ------------- | ------------- | ----------------------------------------------------------------- |
| `value`       | —             | Chuỗi `yyyy-mm-dd`; `''` = chưa chọn                              |
| `onChange`    | —             | `(value: string) => void`; xóa ngày trả `''`                      |
| `onClose`     | —             | Gọi khi popover ĐÓNG — chỗ móc "lưu khi rời ô" cho bảng nhập liệu |
| `disabled`    | `false`       | Khóa ô                                                            |
| `size`        | `'default'`   | `'sm'` = cao 32px, vừa ô trong bảng                               |
| `placeholder` | `'Chọn ngày'` | Chữ mờ khi chưa chọn                                              |
| `clearable`   | `true`        | Hiện nút ✕ xóa ngày đã chọn                                       |
| `className`   | —             | Gộp vào nút bấm (merge cuối qua `cn`)                             |

**`clearable={false}` cho ô BẮT BUỘC.** Trường có `min(1)` trong zod mà vẫn cho
bấm ✕ thì người dùng tự tay tạo ra lỗi validate — che nút đi rẻ hơn là báo lỗi.

---

## 2. Dùng với react-hook-form

`field` của RHF đã có sẵn `value: string` và `onChange` nhận thẳng giá trị, nên
nối trực tiếp — **không** spread `{...field}` (nó kèm `onBlur` / `ref` mà
`DatePicker` không nhận).

```tsx
<FormField
  control={form.control}
  name="issued_date"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Ngày ban hành</FormLabel>
      <FormControl>
        <DatePicker value={field.value} onChange={field.onChange} clearable={false} />
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>
```

Zod khai là `z.string()` (không phải `z.date()`): giá trị chạy trong form là
chuỗi từ đầu tới lúc gửi lên API.

```ts
issued_date: z.string().min(1, 'Chọn ngày ban hành'),   // bắt buộc
effective_to: z.string(),                                // cho trống
```

So sánh khoảng ngày cũng so **chuỗi** luôn — `yyyy-mm-dd` sắp xếp theo bảng chữ
cái trùng với thứ tự thời gian, không cần dựng `Date`:

```ts
.refine((v) => !v.effective_from || !v.effective_to || v.effective_from <= v.effective_to, {
  path: ['effective_to'],
  message: 'Ngày hết hiệu lực phải sau ngày bắt đầu',
})
```

---

## 3. Dùng trong bảng nhập liệu

Ô trong bảng cao 32px và thường lưu khi rời ô:

```tsx
<DatePicker
  size="sm"
  value={row.request_date}
  onChange={(value) => setDraft({ ...row, request_date: value })}
  onClose={saveRow}
/>
```

`onClose` chạy khi popover đóng — kể cả khi đóng bằng bấm ra ngoài, nên không
mất lần sửa cuối.

---

## 4. Chuyển đổi & hiển thị

Mọi hàm ở `@/shared/utils/format-date`. **Không gọi `toLocaleDateString` trực
tiếp** ở component — mỗi chỗ tự đặt option một kiểu là định dạng lệch nhau.

| Hàm                 | Vào                      | Ra                   |
| ------------------- | ------------------------ | -------------------- |
| `formatDate`        | `'2026-08-11'` \| `Date` | `11/08/2026`         |
| `formatDateTime`    | ISO có giờ               | `11/08/2026 09:30`   |
| `formatWeekdayDate` | ISO                      | `Thứ Tư, 12.08.2026` |
| `toDateInputValue`  | `Date`                   | `2026-08-11`         |

Giá trị rỗng / sai định dạng đều trả `''` — cứ gọi thẳng, không cần kiểm trước.

---

## 5. Bẫy đã gặp

1. **`new Date('2026-08-11')` bị hiểu là UTC** → ở múi giờ VN lùi về ngày hôm
   trước. `DatePicker` tự tách số rồi dựng ngày theo giờ địa phương
   (`parseLocalDate`); code khác cần đổi chuỗi → `Date` thì phải làm y vậy, đừng
   truyền thẳng vào `new Date()`.
2. **`toDateInputValue` phải trừ `getTimezoneOffset()`** trước khi `toISOString()`,
   nếu không ngày lưu lệch một ngày ở múi giờ dương.
3. **Nút ✕ chặn ở `onPointerDown`, không phải `onClick`** — trigger của popover
   mở lịch ngay từ `pointerdown`, tới `click` thì lịch đã bung ra rồi.
4. **Nút ✕ là `<span role="button">`, không phải `<button>`** — `PopoverTrigger
asChild` đã biến ô ngày thành một `<button>`, nút lồng trong nút là HTML sai.
5. **Đừng spread `{...field}` của RHF** vào `DatePicker` (xem mục 2).

---

## 6. Chọn KHOẢNG ngày

`DateRangePicker` (`@/shared/ui/date-range-picker`) — lịch hai tháng + hàng chọn
nhanh, chốt bằng nút **Áp dụng**. Đây là ô khoảng ngày **duy nhất**; bản cũ
`DateRangePresetPicker` đã xóa (nó dùng `<input type="date">`, thứ mục 1 cấm, và
hiện thẳng chuỗi ISO `2026-08-11 -> …`).

```tsx
<DateRangePicker
  from={fromDate}                       // 'yyyy-mm-dd', rỗng = chưa chọn
  to={toDate}
  onChange={(from, to) => { setFrom(from); setTo(to) }}   // xóa → hai chuỗi rỗng
  placeholder="Ngày tạo…"
  showPresets={false}                   // tắt hàng chọn nhanh nếu màn không cần
/>
```

- **Chỉ báo ra ngoài khi người dùng tự chốt** (bấm *Áp dụng*, bấm một mức chọn
  nhanh, hoặc xóa). Đóng popover giữa chừng = **hủy**, khoảng cũ còn nguyên.
- Khoảng đang chỉnh nằm ở state **nháp** trong popover, nên bảng bên dưới không
  nháy số theo từng cú bấm.
- Mức chọn nhanh khai ở `@/shared/ui/date-range-presets` — là **hàm** `resolve()`
  chứ không phải hai chuỗi cố định, nếu không thì trang mở qua đêm là "Hôm nay"
  vẫn trỏ vào ngày hôm qua.

### Vì sao phải tự đếm hai nhịp chọn

Đây là chỗ đã phải vá (26/08/2026, khách báo *"range date khó xài"*) — cả hai lỗi
đều đến từ việc tin vào `mode="range"` của react-day-picker:

1. **Nó trả `{from: X, to: X}` ngay cú bấm ĐẦU TIÊN.** Chốt chặn
   `if (!from || !to) return` lọt tuột, nên bấm một ngày là popover đóng và áp
   luôn khoảng một ngày `10/08 – 10/08`. Không tài nào chọn nổi khoảng thật.
2. **Đang có khoảng rồi thì nó NONG khoảng cũ ra chứ không chọn lại.** Đang
   10/08–20/08 mà bấm 28/08 thì ra 10/08–28/08; muốn khoảng mới phải bấm ✕ xóa
   trước.

Nên `onSelect` chỉ lấy **ngày vừa bấm** (tham số thứ hai), còn nhịp 1 = ngày bắt
đầu / nhịp 2 = ngày kết thúc do chính component đếm bằng cờ `pickingEnd`. Bấm
ngược thì tự đảo lại — gửi `from > to` lên backend là danh sách trả rỗng và người
dùng tưởng không có dữ liệu.

### Tô dải

`Calendar` chỉ khai `selected`, mà ở chế độ `range` react-day-picker gắn
`selected` cho **mọi** ngày trong khoảng → cả dải thành một dãy ô xanh đặc rời
rạc, không thấy đâu là hai đầu. `DateRangePicker` truyền lại khóa `selected` (rỗng)
kèm `range_start` / `range_middle` / `range_end`. **Đừng chồng thêm class** để đè:
hai chuỗi cùng ghi `bg-*` thì thứ tự thắng thua do Tailwind sắp, không đoán trước
được.

---

## 7. Sửa chính component

`DatePicker` và `Calendar` là primitive dùng chung — mọi form trong hệ ăn theo.
Cần một biến thể riêng (chọn khoảng ngày, chọn tháng/năm, chặn ngày quá khứ…)
thì **thêm prop có mặc định giữ nguyên hành vi cũ**, đừng đổi hành vi mặc định.
Chọn khoảng ngày thì `Calendar` bên dưới đã đỡ sẵn `mode="range"` của
react-day-picker, chỉ cần bọc thêm một component mới cạnh `date-picker.tsx`.
