// Tải tệp lớn lên Gemini Files API (06/10/2026) — gửi inline chỉ được ~20 MB / yêu cầu (gồm cả base64 phình ~33%),
// ghi âm cuộc họp 1 giờ thường 50–60 MB. Giao thức resumable: «start» lấy URL tải → «upload, finalize» gửi cả tệp →
// nhận file.uri dùng trong fileData. Chờ trạng thái ACTIVE trước khi hỏi; dùng xong xóa (Google tự xóa sau 48 giờ).
//
// `uploadGeminiFile` (Buffer đã có sẵn trong RAM) và `uploadGeminiFileStream` (phase 4, recap họp — ghi âm Drive chảy
// thẳng, KHÔNG đệm RAM vì worker chỉ có 256 MB) dùng chung bước «start» (startUpload) + chờ ACTIVE (waitActive).

const BASE_URL = "https://generativelanguage.googleapis.com";
/** Tệp nhỏ hơn ngần này gửi inline (base64 ~1,33 lần + câu lệnh vẫn dưới 20 MB). */
export const INLINE_MAX_BYTES = 14 * 1024 * 1024;
const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 120_000;

export interface UploadedGeminiFile {
  name: string;
  uri: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mở phiên tải resumable — trả URL tải (header `x-goog-upload-url`) để gửi tiếp phần thân. */
async function startUpload(apiKey: string, mime: string, size: number, displayName: string, fetcher: typeof fetch): Promise<string> {
  const start = await fetcher(`${BASE_URL}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 100) } }),
    signal: AbortSignal.timeout(30_000),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error(`Gemini Files: không mở được phiên tải (${start.status})`);
  return uploadUrl;
}

/** Đọc phản hồi «upload, finalize» thành tệp + trạng thái ban đầu (âm thanh thường ACTIVE ngay). */
function parseFinishResponse(json: unknown): { file: UploadedGeminiFile; state: string } | null {
  const body = (json ?? {}) as { file?: { name?: string; uri?: string; state?: string } };
  if (!body.file?.uri || !body.file.name) return null;
  return { file: { name: body.file.name, uri: body.file.uri }, state: body.file.state ?? "ACTIVE" };
}

/** Chờ tệp qua PROCESSING (tệp cần xử lý) — quá hạn / lỗi thì ném, nơi gọi không hỏi mô hình bằng tệp hỏng. */
async function waitActive(apiKey: string, file: UploadedGeminiFile, initialState: string, fetcher: typeof fetch): Promise<void> {
  let state = initialState;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (state === "PROCESSING" && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await fetcher(`${BASE_URL}/v1beta/${file.name}`, { headers: { "x-goog-api-key": apiKey } });
    state = ((await poll.json().catch(() => ({}))) as { state?: string }).state ?? "FAILED";
  }
  if (state !== "ACTIVE") throw new Error(`Gemini Files: tệp không sẵn sàng (${state})`);
}

/** L2 (review 10/10/2026): `waitActive` quá hạn / FAILED SAU KHI tệp đã tải lên xong — không xóa thì nằm chờ Google tự
 * dọn sau 48 giờ. Xóa NGAY trong catch thay vì để mồ côi. */
async function waitActiveOrCleanUp(apiKey: string, parsed: { file: UploadedGeminiFile; state: string }, fetcher: typeof fetch): Promise<UploadedGeminiFile> {
  try {
    await waitActive(apiKey, parsed.file, parsed.state, fetcher);
  } catch (error) {
    await deleteGeminiFile(apiKey, parsed.file.name, fetcher);
    throw error;
  }
  return parsed.file;
}

/** Tệp đã có sẵn trong RAM (Buffer) — đọc tài liệu / ảnh thường dùng đường này. */
export async function uploadGeminiFile(
  apiKey: string, mime: string, data: Buffer, displayName: string, fetcher: typeof fetch = fetch,
): Promise<UploadedGeminiFile> {
  const uploadUrl = await startUpload(apiKey, mime, data.length, displayName, fetcher);
  const finish = await fetcher(uploadUrl, {
    method: "POST",
    headers: { "Content-Length": String(data.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: new Uint8Array(data),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const json = await finish.json().catch(() => ({}));
  const parsed = parseFinishResponse(json);
  if (!finish.ok || !parsed) throw new Error(`Gemini Files: tải tệp lỗi (${finish.status})`);
  return waitActiveOrCleanUp(apiKey, parsed, fetcher);
}

/**
 * Tệp CHẢY THẲNG từ nguồn (phase 4: `DriveClient.openDownload` → Gemini, không qua RAM / đĩa tạm) — `size` phải đúng
 * byte thật (Drive trả sẵn) vì Gemini xác nhận qua header lúc mở phiên. Node fetch đòi `duplex: "half"` khi thân yêu
 * cầu là luồng (`ReadableStream`), không thì ném lỗi ngay khi gọi.
 */
export async function uploadGeminiFileStream(
  apiKey: string, mime: string, size: number, body: ReadableStream<Uint8Array>, displayName: string, fetcher: typeof fetch = fetch,
): Promise<UploadedGeminiFile> {
  const uploadUrl = await startUpload(apiKey, mime, size, displayName, fetcher);
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: { "Content-Length": String(size), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body,
    duplex: "half",
    signal: AbortSignal.timeout(15 * 60_000),
  };
  const finish = await fetcher(uploadUrl, init);
  const json = await finish.json().catch(() => ({}));
  const parsed = parseFinishResponse(json);
  if (!finish.ok || !parsed) throw new Error(`Gemini Files: tải luồng lỗi (${finish.status})`);
  return waitActiveOrCleanUp(apiKey, parsed, fetcher);
}

export async function deleteGeminiFile(apiKey: string, name: string, fetcher: typeof fetch = fetch): Promise<void> {
  await fetcher(`${BASE_URL}/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": apiKey } }).catch(() => undefined);
}
