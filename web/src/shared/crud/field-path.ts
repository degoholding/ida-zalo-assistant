/**
 * Đọc giá trị theo ĐƯỜNG DẪN có dấu chấm — `'extra_fields.so_giay_phep'`.
 *
 * Vì sao cần: react-hook-form hiểu dấu chấm trong tên ô là đường dẫn LỒNG NHAU,
 * nên `register('extra_fields.so_gp')` sinh ra `{extra_fields: {so_gp: …}}`
 * trong giá trị form và trong cây lỗi. Nhưng `buildFormDefaults` và `CrudField`
 * thì tra bằng `item[field.name]` — tức là tìm một khóa tên đúng chữ
 * `"extra_fields.so_gp"`, thứ không tồn tại.
 *
 * Hậu quả nếu thiếu, cả hai đều IM LẶNG: giá trị đã lưu không đổ vào ô (người
 * dùng mở hồ sơ ra thấy ô trống và tin là chưa ai nhập), và câu báo lỗi của ô
 * đó không bao giờ hiện ra (bấm Lưu thì không có gì xảy ra — đúng cái bẫy
 * duoc-CR-317 đã mô tả).
 *
 * Sinh ra cho BỘ TRƯỜNG TÙY BIẾN của phân hệ Hồ sơ (16/09/2026), nhưng không
 * dính gì tới hồ sơ: bất kỳ config nào cũng khai được ô lồng nhau từ đây.
 */
export function getPath(source: unknown, path: string): unknown {
  if (source === null || source === undefined) return undefined
  //  Đường dẫn không có dấu chấm là tuyệt đại đa số — đi lối tắt để khỏi tách
  //  chuỗi cho mọi ô của mọi form.
  if (!path.includes('.')) return (source as Record<string, unknown>)[path]

  let current: unknown = source
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Ghi giá trị theo đường dẫn có dấu chấm, **không sửa vật thể gốc**.
 *
 * ⚠️ Nhân bản từng tầng trên đường đi là bắt buộc, không phải cẩn thận thừa:
 * `toApiPayload` nhận thẳng đối tượng giá trị của react-hook-form, và ghi đè
 * vào đó là sửa trạng thái nội bộ của form sau lưng nó — ô trên màn hình đổi
 * giá trị mà không có lượt vẽ nào, hoặc tệ hơn là không đổi cho tới lượt vẽ kế
 * tiếp vì lý do không ai lần ra.
 *
 * ⚠️ Chỉ nhận khóa dạng chữ. Đường dẫn qua MẢNG (`lines[0].qty`) cố ý không đỡ:
 * lớp CRUD khai báo không có ô dạng mảng, và đỡ một thứ chưa ai dùng thì lần
 * đầu có người dùng sẽ là lần đầu ai đó kiểm nó.
 */
export function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  if (!path.includes('.')) return { ...target, [path]: value }

  const [head, ...rest] = path.split('.')
  const child = target[head]
  const branch =
    child !== null && typeof child === 'object' && !Array.isArray(child)
      ? (child as Record<string, unknown>)
      : {}
  return { ...target, [head]: setPath(branch, rest.join('.'), value) }
}
