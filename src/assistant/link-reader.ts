import type { AudioSource, DocumentReadResult } from "./gemini-client.js";
import { AUDIO_INSTRUCTION, audioMimeFor, extractDocx, extractSheet, type DocumentReader } from "./file-reader.js";
import { LinkReadError, NOT_SHARED_TEXT, fetchPublic, isPrivateAddress, isStreamResult, type SizeLimit } from "./link-fetch.js";

export { LinkReadError, isPrivateAddress };

// Đọc NỘI DUNG một link người dùng gửi (07/10/2026 — trước đó bot không có cách đọc link, «đọc cái link» thì lấy đại
// tệp gần nhất). Link Google Sheets / Docs / Slides / Drive đổi sang đường XUẤT TỆP công khai (cần chia sẻ «Bất kỳ ai
// có đường liên kết»); trang web khác lấy chữ trong HTML; ghi âm Drive (mp3/m4a/wav…) nhờ mô hình nghe (10/10/2026 —
// recap cuộc họp từ link). Chặn SSRF + trần byte: xem link-fetch.ts.
//
// H3 (review 10/10/2026): ghi âm CHẢY THẲNG qua `readAudioSource` khi có (Gemini, như worker recap họp) — tiến trình
// APP không còn đệm cả tệp vào RAM (~3 lần cỡ tệp cộng dồn khi 2 người hỏi cùng lúc từng làm OOM). Không có
// `readAudioSource` (chỉ còn OpenAI qua `readDocument`) thì vẫn đệm Buffer như cũ nhưng trần thấp hơn
// (`FALLBACK_AUDIO_MAX_BYTES`) + một lượt nghe / lần cho cả tiến trình (`withAudioLock`) để giảm rủi ro RAM.

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_CHARS = 200_000;
/** Trần ghi âm khi nơi gọi không truyền maxAudioBytes (khớp mặc định read_file). */
const DEFAULT_MAX_AUDIO_BYTES = 5 * 1024 * 1024;
/** Không nghe luồng được (fallback Buffer, OpenAI) → giữ trần THẤP dù cài đặt chung cho phép tới 200 MB — khớp trần
 * ghi âm OpenAI tự công bố (~25 MB), tránh phình RAM ở app khi không streaming được. */
const FALLBACK_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

/** Một lượt nghe ghi âm từ link / lần cho CẢ tiến trình app (H3) — N người hỏi cùng lúc không giữ N phiên tải Gemini /
 * N bản Buffer song song (RAM nền + băng thông). Áp dụng cho cả nhánh streaming lẫn nhánh đệm Buffer dự phòng. */
let audioLock: Promise<unknown> = Promise.resolve();
function withAudioLock<T>(run: () => Promise<T>): Promise<T> {
  const next = audioLock.then(run, run);
  audioLock = next.then(() => undefined, () => undefined);
  return next;
}

export type LinkKind = "sheet" | "doc" | "slides" | "drive" | "page";

export interface LinkTarget {
  kind: LinkKind;
  /** URL thật sự tải về (đường xuất tệp với link Google). */
  fetchUrl: string;
  /** id tệp Drive (kind "drive") — dùng để lùi về đường tải cũ nếu đường usercontent lỗi mạng. */
  driveId?: string;
}

/** Link Google → đường xuất tệp; link khác giữ nguyên. Hàm thuần. */
export function resolveLinkTarget(raw: string): LinkTarget {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new LinkReadError("Link không hợp lệ.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkReadError("Chỉ đọc được link http / https.");
  const id = /\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1];
  if (url.hostname === "docs.google.com" && id) {
    if (url.pathname.startsWith("/spreadsheets/")) return { kind: "sheet", fetchUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx` };
    if (url.pathname.startsWith("/document/")) return { kind: "doc", fetchUrl: `https://docs.google.com/document/d/${id}/export?format=txt` };
    if (url.pathname.startsWith("/presentation/")) return { kind: "slides", fetchUrl: `https://docs.google.com/presentation/d/${id}/export/txt` };
  }
  if (url.hostname === "drive.google.com" && id) {
    // Tệp lớn (>~100 MB): drive.google.com/uc?export=download trả trang cảnh báo virus thay vì tệp — usercontent kèm
    // confirm=t tải thẳng, bỏ qua trang đó (kiểm thật 10/10/2026 với tệp công khai ~476 MB, không cần đăng nhập/uuid)
    return { kind: "drive", fetchUrl: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, driveId: id };
  }
  return { kind: "page", fetchUrl: url.toString() };
}

/** Chữ trong HTML: bỏ script / style / thẻ, giải vài thực thể hay gặp, gom khoảng trắng. */
export function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const body = html
    .replace(/<(script|style|noscript|svg|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return title ? `# ${title}\n${body}` : body;
}

export interface LinkContent {
  kind: LinkKind;
  how: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ReadLinkOptions {
  /** Trần byte cho ghi âm (cài đặt «Cỡ tệp tối đa bot đọc»); bỏ trống = DEFAULT_MAX_AUDIO_BYTES. */
  maxAudioBytes?: number;
  /** Đuôi tệp bot được đọc (cài đặt «Loại tệp bot được đọc»); bỏ trống / rỗng = mọi loại. */
  allowedExtensions?: string[];
  /** H3: nghe ghi âm CHẢY THẲNG (Gemini Files API, khuôn `meeting-recap-pipeline.ts` ở worker) — có thì ghi âm từ link
   * không đệm Buffer ở app; không có thì lùi về `readDocument` (Buffer, OpenAI tối đa ~25 MB). */
  readAudioSource?: (source: AudioSource, instruction: string) => Promise<DocumentReadResult>;
}

/** Tệp Drive: thử đường usercontent (bỏ qua trang cảnh báo virus) trước; lỗi MẠNG (không phải 403/404 Google đã trả lời rõ) thì lùi về đường uc?export= cũ — Google có thể đổi lại cách phục vụ. */
async function fetchDriveTarget(target: LinkTarget, fetcher: typeof fetch, pickLimit: (contentType: string, fileName: string) => SizeLimit) {
  try {
    return await fetchPublic(target.fetchUrl, fetcher, pickLimit);
  } catch (error) {
    if (target.driveId && error instanceof LinkReadError && error.message.startsWith("Không tải được link")) {
      return fetchPublic(`https://drive.google.com/uc?export=download&id=${target.driveId}`, fetcher, pickLimit);
    }
    throw error;
  }
}

/** Đọc link → chữ. `readDocument` (Gemini/OpenAI) để đọc PDF và GHI ÂM; không có thì báo chưa bật đọc loại đó. */
export async function readLinkContent(
  raw: string,
  readDocument?: DocumentReader,
  options: ReadLinkOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<LinkContent> {
  const target = resolveLinkTarget(raw);
  const maxAudioBytes = options.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES;
  // Biết trần NGAY sau header (chưa tải thân): ghi âm theo trần đọc tệp của bot, loại khác giữ trần 20 MB cũ.
  // H3: `stream` theo khả năng NƠI GỌI có truyền readAudioSource không — quyết định TRƯỚC khi gọi fetchPublic vì
  // fetchPublic tự chọn đệm Buffer hay trả luồng thẳng dựa vào đúng cờ này.
  const canStreamAudio = Boolean(options.readAudioSource);
  const pickLimit = (contentType: string, fileName: string): SizeLimit => {
    if (!audioMimeFor(contentType, fileName)) return { maxBytes: MAX_BYTES, isAudio: false };
    return { maxBytes: canStreamAudio ? maxAudioBytes : Math.min(maxAudioBytes, FALLBACK_AUDIO_MAX_BYTES), isAudio: true, stream: canStreamAudio };
  };
  const fetched = target.kind === "drive"
    ? await fetchDriveTarget(target, fetcher, pickLimit)
    : await fetchPublic(target.fetchUrl, fetcher, pickLimit);
  const { finalUrl, contentType, fileName } = fetched;
  const zero = { inputTokens: 0, outputTokens: 0 };
  // Tệp Google chưa chia sẻ: Google chuyển sang trang đăng nhập (HTML) thay vì trả tệp
  if (target.kind !== "page" && (finalUrl.hostname === "accounts.google.com" || contentType.includes("text/html"))) {
    throw new LinkReadError(NOT_SHARED_TEXT);
  }
  const done = (how: string, text: string, tokens = zero) => ({ kind: target.kind, how, text: text.slice(0, MAX_CHARS), ...tokens });
  const audio = audioMimeFor(contentType, fileName);
  if (audio) {
    if (options.allowedExtensions?.length && !options.allowedExtensions.includes(audio.ext)) {
      throw new LinkReadError(`Bot chưa được phép đọc tệp .${audio.ext} — quản trị bật ở Cài đặt → «Loại tệp bot được đọc». Đang cho đọc: ${options.allowedExtensions.join(", ")}.`);
    }
    // H3: một lượt nghe / lần cho cả tiến trình (streaming lẫn Buffer dự phòng) — N người hỏi cùng lúc không cộng dồn RAM
    return withAudioLock(async () => {
      try {
        if (isStreamResult(fetched)) {
          if (!options.readAudioSource) throw new LinkReadError("Bot chưa bật nghe ghi âm.");
          const source: AudioSource = { mime: audio.mime, size: fetched.size, displayName: fileName || `ghi-am.${audio.ext}`, open: () => Promise.resolve(fetched.body) };
          const result = await options.readAudioSource(source, AUDIO_INSTRUCTION);
          return done(`ghi âm .${audio.ext} (mô hình nghe, gỡ băng + tóm tắt)`, result.text, { inputTokens: result.inputTokens, outputTokens: result.outputTokens });
        }
        if (!readDocument) throw new LinkReadError("Bot chưa bật nghe ghi âm.");
        const result = await readDocument(audio.mime, fetched.data, AUDIO_INSTRUCTION);
        return done(`ghi âm .${audio.ext} (mô hình nghe, gỡ băng + tóm tắt)`, result.text, { inputTokens: result.inputTokens, outputTokens: result.outputTokens });
      } catch (error) {
        // Gói lại thành LinkReadError để runReadLink trả đúng câu báo (vd khóa chỉ OpenAI, ghi âm > 25 MB) thay vì
        // rơi xuống lỗi chung chung của cả lượt hỏi
        if (error instanceof LinkReadError) throw error;
        throw new LinkReadError(error instanceof Error ? error.message : String(error));
      }
    });
  }
  // Tới đây chắc chắn KHÔNG phải ghi âm (audio falsy ở trên) nên fetchPublic không thể đã trả luồng thẳng — khẳng định
  // lại bằng isStreamResult để TypeScript thu hẹp kiểu (và phòng hờ nếu invariant đó vỡ trong tương lai).
  if (isStreamResult(fetched)) throw new LinkReadError(`Chưa đọc được loại nội dung «${contentType || "không rõ"}» của link này.`);
  const { data } = fetched;
  if (contentType.includes("spreadsheetml") || contentType.includes("ms-excel") || target.kind === "sheet") {
    return done("bảng tính", extractSheet(data).text);
  }
  if (contentType.includes("wordprocessingml")) return done("docx", extractDocx(data));
  if (contentType.includes("application/pdf")) {
    if (!readDocument) throw new LinkReadError("Bot chưa bật đọc PDF.");
    const result = await readDocument("application/pdf", data, "Chép lại toàn bộ chữ trong tài liệu, giữ bảng thành dòng các ô cách nhau ' | '.");
    return done("pdf (mô hình đọc)", result.text, { inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  }
  if (contentType.includes("text/html")) return done("trang web", htmlToText(data.toString("utf8")));
  if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("csv") || target.kind === "doc" || target.kind === "slides") {
    return done("văn bản", data.toString("utf8").trim());
  }
  // Video và các loại khác chưa đọc được: câu rõ ràng, không bịa tiếp
  throw new LinkReadError(`Chưa đọc được loại nội dung «${contentType || "không rõ"}» của link này.`);
}
