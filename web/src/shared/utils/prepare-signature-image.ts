/**
 * Chuẩn bị ảnh CHỮ KÝ trước khi tải lên: THU NHỎ + (tùy chọn) TÁCH NỀN — làm
 * ngay ở trình duyệt. Bản dựng lại của `frontend/src/utils/prepare-signature-image.ts`.
 *
 * Vì sao thu nhỏ: điện thoại và máy scan cho ra ảnh 3000–4000px nặng vài MB,
 * trong khi chữ ký chỉ hiện ở khung ~400px trên phiếu in. Thu nhỏ trước khi gửi
 * tiết kiệm dung lượng lưu trữ và làm phiếu in tải nhanh hơn.
 *
 * Cách tách nền: chữ ký là nét mực TỐI trên nền SÁNG nên chỉ cần xét độ sáng
 * từng điểm ảnh — sáng hơn `hi` là nền giấy (trong suốt hẳn), tối hơn `lo` là
 * nét mực (giữ nguyên), ở giữa là viền nét (mờ dần cho khỏi răng cưa).
 */
export interface PrepareSignatureOptions {
  /** Tách nền trắng thành trong suốt. */
  removeBg?: boolean
  maxWidth?: number
  maxHeight?: number
  /** Độ sáng coi là nền (0–255). */
  hi?: number
  /** Độ sáng coi là nét mực đậm. */
  lo?: number
  jpegQuality?: number
}

const DEFAULTS: Required<PrepareSignatureOptions> = {
  removeBg: true,
  maxWidth: 800,
  maxHeight: 400,
  hi: 225,
  lo: 110,
  jpegQuality: 0.85,
}

/**
 * Kích thước sau khi thu nhỏ, giữ nguyên tỉ lệ và KHÔNG phóng to ảnh vốn đã nhỏ.
 *
 * Tách riêng khỏi phần vẽ canvas để kiểm được bằng test — canvas không chạy
 * trong môi trường test, còn phép tính tỉ lệ thì sai một chỗ là chữ ký méo.
 */
export function computeScaledSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number; scale: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Không đọc được ảnh'))
    }
    image.src = url
  })
}

/** Xóa nền giấy trắng tại chỗ trên dữ liệu điểm ảnh của canvas. */
function stripBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  hi: number,
  lo: number,
) {
  const data = ctx.getImageData(0, 0, width, height)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    if (lum >= hi) {
      px[i + 3] = 0 // nền giấy
    } else if (lum > lo) {
      px[i + 3] = Math.round((255 * (hi - lum)) / (hi - lo)) // viền nét: mờ dần
    }
    // lum <= lo: giữ nguyên alpha gốc (nét mực)
  }
  ctx.putImageData(data, 0, 0)
}

/**
 * Trả về tệp ảnh đã xử lý, sẵn sàng tải lên. Ảnh đã nhỏ sẵn và không cần tách
 * nền thì TRẢ NGUYÊN tệp gốc — mã hóa lại chỉ làm tệp phình ra.
 *
 * Ném `Error` khi không đọc/không xuất được ảnh, để nơi gọi hiện thông báo.
 */
export async function prepareSignatureImage(
  file: File,
  options: PrepareSignatureOptions = {},
): Promise<File> {
  const { removeBg, maxWidth, maxHeight, hi, lo, jpegQuality } = { ...DEFAULTS, ...options }
  const image = await loadImage(file)

  const { width, height, scale } = computeScaledSize(
    image.width,
    image.height,
    maxWidth,
    maxHeight,
  )
  if (scale === 1 && !removeBg) return file

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, width, height)

  if (removeBg) stripBackground(ctx, width, height, hi, lo)

  // Có tách nền thì buộc PNG (cần kênh alpha). Không tách nền thì JPEG cho nhẹ,
  // trừ khi ảnh gốc vốn là PNG — đổi sang JPEG có thể biến nền trong thành đen.
  const png = removeBg || file.type === 'image/png'
  const mime = png ? 'image/png' : 'image/jpeg'
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Không tạo được ảnh'))),
      mime,
      jpegQuality,
    ),
  )

  // Bản vừa xử lý nặng hơn ảnh gốc (và không cần tách nền) thì giữ ảnh gốc.
  if (!removeBg && blob.size >= file.size) return file

  const name = (file.name || 'chu-ky').replace(/\.[^.]+$/, '') + (png ? '.png' : '.jpg')
  return new File([blob], name, { type: mime })
}
