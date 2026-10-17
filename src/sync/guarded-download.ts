import { UnsafeUrlError, assertPublicHttpUrl, defaultAddressLookup, type AddressLookup } from "../net/public-address-guard.js";

// Tải một link đính kèm có rào: chỉ http/https (+ data: ảnh nhập từ Zalo Web), mọi bước đều kiểm địa chỉ công khai
// (chặn SSRF vào MySQL / container khác / metadata VPS), chuyển hướng đi tay tối đa MAX_REDIRECTS bước, thân tải theo
// luồng với bộ đếm byte — vượt trần là hủy ngay, không bao giờ đệm quá trần vào RAM.

const MAX_REDIRECTS = 5;

/** Lỗi không đáng thử lại (link chết, quá trần, URL bị chặn). */
export class PermanentDownloadError extends Error {}

export type Fetcher = (url: string, init: { signal: AbortSignal; redirect?: "manual" }) => Promise<Response>;

export interface GuardedDownloadOptions {
  fetcher: Fetcher;
  maxBytes: number;
  signal: AbortSignal;
  lookup?: AddressLookup;
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PermanentDownloadError(`Tệp vượt trần ${maxBytes} byte (dừng tải giữa chừng)`);
      }
      // Bọc vùng nhớ sẵn có, không chép thêm một bản
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function guardedDownload(startUrl: string, options: GuardedDownloadOptions): Promise<{ body: Buffer; contentType: string }> {
  const { fetcher, maxBytes, signal, lookup = defaultAddressLookup } = options;
  let url: URL;
  try {
    url = new URL(startUrl);
  } catch {
    throw new PermanentDownloadError("Link tệp không hợp lệ");
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol === "data:") {
      // Dữ liệu nằm sẵn trong chuỗi — không có mạng để chặn, chỉ cần khỏi giải mã thứ quá trần (base64 ≈ 4/3)
      if (url.href.length > Math.ceil(maxBytes * 4 / 3) + 1024) throw new PermanentDownloadError(`Tệp data URL vượt trần ${maxBytes}`);
    } else {
      try {
        await assertPublicHttpUrl(url, lookup);
      } catch (error) {
        if (error instanceof UnsafeUrlError && error.reason !== "not-found") throw new PermanentDownloadError(`Link bị chặn: ${error.message}`);
        throw error;
      }
    }
    const response = await fetcher(url.href, { signal, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      try {
        url = new URL(location, url);
      } catch {
        throw new PermanentDownloadError("Chuyển hướng tới link không hợp lệ");
      }
      // data: chỉ hợp lệ làm link gốc — bước chuyển hướng không được nhảy sang
      if (url.protocol === "data:") throw new PermanentDownloadError("Link bị chặn: chuyển hướng sang data:");
      continue;
    }
    if (response.status === 403 || response.status === 404 || response.status === 410) {
      await response.body?.cancel().catch(() => undefined);
      throw new PermanentDownloadError(`HTTP ${response.status} — link đã chết`);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`HTTP ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length"));
    if (declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new PermanentDownloadError(`Tệp ${declared} byte vượt trần ${maxBytes}`);
    }
    const body = await readCapped(response, maxBytes);
    return { body, contentType: response.headers.get("content-type") ?? "application/octet-stream" };
  }
  throw new PermanentDownloadError("Link chuyển hướng quá nhiều lần");
}
