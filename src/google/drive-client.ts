import type { AppConfig } from "../config.js";
import { GoogleUserAuth, hasDriveScope, oauthClientOf } from "./google-oauth.js";
import { describeDriveFailure, FOLDER_NOT_FOUND_TEXT, NOT_A_FOLDER_TEXT } from "./drive-error-messages.js";
import { GoogleSheetsError, NETWORK_ERROR_TEXT } from "./sheets-error-messages.js";

// Đọc thư mục «Ghi âm họp» trên Google Drive — qua access token OAuth của Gmail đã «Kết nối Google»
// (KHÔNG service account). Một `DriveClient` CHỈ GẮN VỚI MỘT thư mục (`folderId` truyền lúc dựng) — mọi
// phương thức đọc theo đúng thư mục đó; `openDownload` còn kiểm lại `parents` của tệp trước khi mở luồng,
// để bug / cấu hình sai không vô tình tải nhầm tệp ở thư mục khác trong Drive của bot.
//
// API cho phase theo dõi thư mục (quét 5 phút / lần) + phase gỡ băng (tải luồng, không đệm RAM):
//   checkFolder()                      → tên thư mục, báo lỗi nếu id không phải thư mục
//   listNewFiles(createdAfter)          → tệp mới tạo trong thư mục sau mốc giờ, đã bỏ lối tắt
//   openDownload(fileId)                → { body, size, mime } — `body` là ReadableStream chảy thẳng, không Buffer

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const REQUEST_TIMEOUT_MS = 15_000;
const LIST_PAGE_SIZE = 100;
/** Trần số trang — phòng thư mục bất thường nhiều tệp vẫn không quét vô hạn trong một lượt. */
const LIST_MAX_PAGES = 3;
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
const AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "aac", "ogg", "flac"];

export interface DriveClientOptions {
  fetcher?: typeof fetch;
}

export interface DriveFolderInfo {
  name: string;
}

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string;
}

export interface DriveDownload {
  body: ReadableStream<Uint8Array>;
  size: number;
  mime: string;
}

/** `mimeType` bắt đầu `audio/` HOẶC đuôi tệp quen thuộc — Drive hay trả `application/octet-stream` cho mp3. */
export function isAudioFile(file: Pick<DriveFileInfo, "name" | "mimeType">): boolean {
  if (file.mimeType.startsWith("audio/")) return true;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return AUDIO_EXTENSIONS.includes(ext);
}

export class DriveClient {
  private readonly fetcher: typeof fetch;
  /** Một `GoogleUserAuth` dùng lại cho cả vòng đời client — tận dụng bộ nhớ đệm token của chính nó (xem calendar-meetings.ts). */
  private auth: GoogleUserAuth | null = null;

  constructor(
    /** Đọc lúc gọi — kết nối / ngắt kết nối trên màn Cài đặt có hiệu lực ngay (khuôn giống `MeetingScheduler`). */
    private readonly getGoogle: () => AppConfig["google"],
    private readonly folderId: string,
    options: DriveClientOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async checkFolder(): Promise<DriveFolderInfo> {
    const data = await this.call(`${DRIVE_API}/files/${encodeURIComponent(this.folderId)}?fields=id,name,mimeType&supportsAllDrives=true`) as {
      name?: string;
      mimeType?: string;
    };
    if (data.mimeType !== FOLDER_MIME) throw new GoogleSheetsError(NOT_A_FOLDER_TEXT);
    return { name: data.name ?? "" };
  }

  async listNewFiles(createdAfter: Date): Promise<DriveFileInfo[]> {
    const query = `'${this.folderId}' in parents and trashed=false and createdTime > '${createdAfter.toISOString()}'`;
    const files: DriveFileInfo[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
      const url = new URL(`${DRIVE_API}/files`);
      url.searchParams.set("q", query);
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,createdTime)");
      url.searchParams.set("orderBy", "createdTime");
      url.searchParams.set("pageSize", String(LIST_PAGE_SIZE));
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await this.call(url.toString()) as {
        files?: { id: string; name: string; mimeType: string; size?: string; createdTime: string }[];
        nextPageToken?: string;
      };
      for (const file of data.files ?? []) {
        // Lối tắt không phải tệp thật — truy vấn đã lọc `trashed=false` nhưng không lọc được mimeType, bỏ ở đây
        if (file.mimeType === SHORTCUT_MIME) continue;
        files.push({ id: file.id, name: file.name, mimeType: file.mimeType, size: Number(file.size ?? 0), createdTime: file.createdTime });
      }
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return files;
  }

  /**
   * Metadata MỘT tệp theo id (không tải nội dung) — dùng khi đã biết chắc `file_id` (vd recap theo yêu cầu chat,
   * meeting-recap-ondemand.ts: mô hình chọn lại đúng tệp từ danh sách ứng viên của lượt hỏi trước). Vẫn kiểm `parents`
   * như `openDownload` — id hợp lệ trên Drive nhưng nằm ngoài thư mục đã cấu hình vẫn bị từ chối.
   */
  async getFileMeta(fileId: string): Promise<DriveFileInfo> {
    let data: { id?: string; name?: string; mimeType?: string; size?: string; createdTime?: string; parents?: string[] };
    try {
      data = await this.call(
        `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,createdTime,parents&supportsAllDrives=true`,
      ) as typeof data;
    } catch (error) {
      // describeDriveFailure dùng chung câu «không thấy thư mục» cho mọi tệp/thư mục không tìm thấy — đổi lại cho đúng
      // ngữ cảnh đang tìm một TỆP, không phải thư mục.
      if (error instanceof GoogleSheetsError && error.message === FOLDER_NOT_FOUND_TEXT) {
        throw new GoogleSheetsError("Không thấy tệp này trong thư mục «Ghi âm họp» — sai mã tệp hoặc tệp đã bị xóa / di chuyển.");
      }
      throw error;
    }
    if (!data.parents?.includes(this.folderId)) {
      throw new GoogleSheetsError("Tệp không nằm trong thư mục «Ghi âm họp» đã cấu hình — bot từ chối đọc để tránh đọc nhầm thư mục khác trong Drive.");
    }
    return {
      id: data.id ?? fileId, name: data.name ?? "", mimeType: data.mimeType ?? "application/octet-stream",
      size: Number(data.size ?? 0), createdTime: data.createdTime ?? new Date().toISOString(),
    };
  }

  /** Luồng tải thẳng — KHÔNG đọc vào RAM. Kiểm `parents` trước để chỉ tải đúng tệp trong thư mục đã cấu hình. */
  async openDownload(fileId: string): Promise<DriveDownload> {
    const meta = await this.call(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,parents,mimeType,size&supportsAllDrives=true`) as {
      parents?: string[];
      mimeType?: string;
      size?: string;
    };
    if (!meta.parents?.includes(this.folderId)) {
      throw new GoogleSheetsError("Tệp không nằm trong thư mục «Ghi âm họp» đã cấu hình — bot từ chối tải để tránh đọc nhầm thư mục khác trong Drive.");
    }
    const token = await this.accessToken();
    let response: Response;
    try {
      // Không gắn AbortSignal.timeout ngắn ở đây: tệp lớn cần nhiều phút để chảy hết luồng, nơi gọi tự lo timeout tổng.
      response = await this.fetcher(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new GoogleSheetsError(NETWORK_ERROR_TEXT);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw describeDriveFailure(response.status, body as never);
    }
    if (!response.body) throw new GoogleSheetsError(NETWORK_ERROR_TEXT);
    return { body: response.body, size: Number(meta.size ?? 0), mime: meta.mimeType ?? "application/octet-stream" };
  }

  private async accessToken(): Promise<string> {
    const google = this.getGoogle();
    const client = oauthClientOf(google);
    if (!client || !google.calendarAccount) throw new GoogleSheetsError("Chưa kết nối Google — vào Cài đặt → Google bấm «Kết nối Google».");
    if (!hasDriveScope(google.calendarAccount)) {
      throw new GoogleSheetsError("Chưa có quyền đọc Google Drive — bấm «Kết nối lại Google» và tick thêm ô quyền Drive (chỉ xem tệp).");
    }
    if (!this.auth) this.auth = new GoogleUserAuth(client, google.calendarAccount, this.fetcher);
    return this.auth.getAccessToken();
  }

  private async call(url: string): Promise<unknown> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetcher(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new GoogleSheetsError(NETWORK_ERROR_TEXT);
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) throw describeDriveFailure(response.status, json as never);
    return json;
  }
}
