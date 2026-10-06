// Tải tệp lớn lên Gemini Files API (06/10/2026) — gửi inline chỉ được ~20 MB / yêu cầu (gồm cả base64 phình ~33%),
// ghi âm cuộc họp 1 giờ thường 50–60 MB. Giao thức resumable: «start» lấy URL tải → «upload, finalize» gửi cả tệp →
// nhận file.uri dùng trong fileData. Chờ trạng thái ACTIVE trước khi hỏi; dùng xong xóa (Google tự xóa sau 48 giờ).

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

export async function uploadGeminiFile(
  apiKey: string, mime: string, data: Buffer, displayName: string, fetcher: typeof fetch = fetch,
): Promise<UploadedGeminiFile> {
  const start = await fetcher(`${BASE_URL}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(data.length),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 100) } }),
    signal: AbortSignal.timeout(30_000),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error(`Gemini Files: không mở được phiên tải (${start.status})`);
  const finish = await fetcher(uploadUrl, {
    method: "POST",
    headers: { "Content-Length": String(data.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: new Uint8Array(data),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const json = (await finish.json().catch(() => ({}))) as { file?: { name?: string; uri?: string; state?: string } };
  if (!finish.ok || !json.file?.uri || !json.file.name) throw new Error(`Gemini Files: tải tệp lỗi (${finish.status})`);
  const file = { name: json.file.name, uri: json.file.uri };
  // Âm thanh thường ACTIVE ngay; tệp cần xử lý thì chờ, quá hạn thì báo lỗi
  let state = json.file.state ?? "ACTIVE";
  const deadline = Date.now() + MAX_WAIT_MS;
  while (state === "PROCESSING" && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await fetcher(`${BASE_URL}/v1beta/${file.name}`, { headers: { "x-goog-api-key": apiKey } });
    state = ((await poll.json().catch(() => ({}))) as { state?: string }).state ?? "FAILED";
  }
  if (state !== "ACTIVE") throw new Error(`Gemini Files: tệp không sẵn sàng (${state})`);
  return file;
}

export async function deleteGeminiFile(apiKey: string, name: string, fetcher: typeof fetch = fetch): Promise<void> {
  await fetcher(`${BASE_URL}/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": apiKey } }).catch(() => undefined);
}
