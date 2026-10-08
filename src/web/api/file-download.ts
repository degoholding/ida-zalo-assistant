import { MessageKind } from "../../constants.js";
import { sanitizeFileName } from "../../sync/attachment-downloader.js";

// Tên tệp + kiểu nội dung khi tải một tệp trong kho về trình duyệt. Không suy từ khóa lưu trữ nữa: ảnh `chat.photo` không
// có tên / đuôi nên khóa thành «8-tep.bin» → tải về ra tệp .bin, `?inline=1` không vẽ được ảnh (lỗi 08/10/2026).

/** Chỉ các kiểu ảnh này được hiện thẳng (inline) — không có svg: máy chủ bật nosniff, svg chạy được mã. */
const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };

/** Loại tin không có tên / đuôi tệp thì lấy đuôi mặc định này (Zalo gửi ảnh dạng jpg, video mp4). */
const DEFAULT_EXTENSION: Partial<Record<MessageKind, string>> = { [MessageKind.Image]: "jpg", [MessageKind.Video]: "mp4" };
const DEFAULT_BASE_NAME: Partial<Record<MessageKind, string>> = { [MessageKind.Image]: "anh", [MessageKind.Video]: "video", [MessageKind.Voice]: "ghi-am" };

const EXTENSION_PATTERN = /\.([a-z0-9]{1,10})$/i;

export interface FileDownloadSource {
  id: number;
  fileName: string | null;
  fileExt: string | null;
  messageKind: number | null;
  storageKey: string;
}

export interface FileDownloadInfo {
  /** Tên tệp gửi cho trình duyệt (đã bỏ ký tự cấm, luôn có đuôi). */
  fileName: string;
  /** Kiểu ảnh hiện thẳng được (image/jpeg…); null = không phải ảnh, chỉ tải về. */
  imageType: string | null;
}

function cleanExtension(raw: string | null | undefined): string {
  const ext = String(raw ?? "").trim().toLowerCase().replace(/^\./, "");
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

/** Phần tên trong khóa lưu `<nhóm>/<tháng>/<id>-<tên>` — bỏ tiền tố id. */
function storedName(storageKey: string): string {
  return (storageKey.split("/").pop() ?? "").replace(/^[0-9]+-/, "");
}

export function describeFileDownload(source: FileDownloadSource): FileDownloadInfo {
  const kind = (source.messageKind ?? MessageKind.Other) as MessageKind;
  const ownName = sanitizeFileName(source.fileName ?? "");
  const keyName = sanitizeFileName(storedName(source.storageKey));
  const keyExt = cleanExtension(EXTENSION_PATTERN.exec(keyName)?.[1]);
  // Thứ tự tin cậy: đuôi đã ghi lúc nhận tin → đuôi trong tên gốc → mặc định theo loại tin → đuôi của khóa (trừ .bin đoán bừa)
  const ext = cleanExtension(source.fileExt)
    || cleanExtension(EXTENSION_PATTERN.exec(ownName)?.[1])
    || DEFAULT_EXTENSION[kind]
    || (keyExt && keyExt !== "bin" ? keyExt : "")
    || "bin";
  const fallbackBase = DEFAULT_BASE_NAME[kind] ?? "tep";
  // Tên tự sinh «tep.bin» của bộ tải không phải tên thật — bỏ, dùng tên theo loại tin
  const keyBase = keyName.replace(EXTENSION_PATTERN, "");
  const base = (ownName || (keyBase && keyBase !== "tep" ? keyBase : `${fallbackBase}-${source.id}`)).replace(EXTENSION_PATTERN, "")
    || `${fallbackBase}-${source.id}`;
  return { fileName: `${base}.${ext}`, imageType: IMAGE_TYPES[ext] ?? null };
}

/** Content-Disposition: bản ASCII cho trình duyệt cũ + `filename*` UTF-8 theo RFC 5987 (tên tiếng Việt). */
export function buildContentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  // encodeURIComponent để lọt ' ( ) * — RFC 5987 không cho các ký tự này đứng trần
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
