import crypto from "node:crypto";
import type { ServiceAccount } from "./service-account.js";
import { GoogleSheetsError, NETWORK_ERROR_TEXT, describeSheetsFailure, describeTokenFailure } from "./sheets-error-messages.js";

// Client Google Sheets tối giản: tự ký JWT RS256 bằng node:crypto, đổi lấy access token, gọi Sheets API v4
// bằng fetch. Không dùng gói `googleapis` (vài chục MB cho đúng 3 lời gọi REST). Phase G dùng `appendRows`
// để xuất báo cáo; phase B chỉ dùng cho nút «Kiểm tra kết nối».

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_LIFETIME_SECONDS = 3600;
/** Đổi token mới trước khi hết hạn ngần này — tránh token hết hạn giữa chừng một lời gọi. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
export const TEST_SHEET_TITLE = "Bot trợ lý";
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface SheetsClientOptions {
  fetcher?: typeof fetch;
  now?: () => number;
}

export interface SpreadsheetInfo {
  title: string;
  sheets: { title: string; sheetId: number }[];
}

const base64Url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** Vùng ghi của một tab: tên có dấu cách / nháy đơn phải bọc nháy đơn, nháy đơn bên trong nhân đôi. */
export function sheetRange(sheetTitle: string, cell = "A1"): string {
  return `'${sheetTitle.replace(/'/g, "''")}'!${cell}`;
}

export class GoogleSheetsClient {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly account: ServiceAccount, options: SheetsClientOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }

  get clientEmail(): string {
    return this.account.client_email;
  }

  /** JWT đã ký, gửi kèm khi đổi token. Tách ra để bài kiểm xác minh chữ ký. */
  buildSignedJwt(): string {
    const issuedAt = Math.floor(this.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = base64Url(JSON.stringify({
      iss: this.account.client_email,
      scope: SHEETS_SCOPE,
      aud: this.account.token_uri,
      iat: issuedAt,
      exp: issuedAt + TOKEN_LIFETIME_SECONDS,
    }));
    const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claim}`), this.account.private_key);
    return `${header}.${claim}.${base64Url(signature)}`;
  }

  /** JWT RS256 → access token, nhớ đệm tới (exp − 60 giây). */
  async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.now() < this.cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS) return this.cachedToken.value;
    let assertion: string;
    try {
      assertion = this.buildSignedJwt();
    } catch {
      throw new GoogleSheetsError("Khóa riêng (private_key) trong tệp khóa bị hỏng — tạo khóa mới rồi dán lại.");
    }
    const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
    const { status, ok, json } = await this.call(this.account.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const token = json as { access_token?: string; expires_in?: number } | null;
    if (!ok || !token?.access_token) throw describeTokenFailure(status, json as never);
    const lifetimeMs = (Number(token.expires_in) || TOKEN_LIFETIME_SECONDS) * 1000;
    this.cachedToken = { value: token.access_token, expiresAt: this.now() + lifetimeMs };
    return token.access_token;
  }

  async getSpreadsheet(spreadsheetId: string): Promise<SpreadsheetInfo> {
    const data = await this.sheetsCall(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties`, { method: "GET" }) as {
      properties?: { title?: string };
      sheets?: { properties?: { title?: string; sheetId?: number } }[];
    };
    return {
      title: data.properties?.title ?? "",
      sheets: (data.sheets ?? []).map((sheet) => ({ title: sheet.properties?.title ?? "", sheetId: Number(sheet.properties?.sheetId ?? 0) })),
    };
  }

  /** Có tab tên này chưa — chưa thì tạo. */
  async ensureSheet(spreadsheetId: string, title: string): Promise<void> {
    const info = await this.getSpreadsheet(spreadsheetId);
    if (info.sheets.some((sheet) => sheet.title === title)) return;
    await this.addSheet(spreadsheetId, title);
  }

  /** Thêm một tab mới (batchUpdate addSheet); trả sheetId để dựng link mở thẳng tab đó. */
  async addSheet(spreadsheetId: string, title: string): Promise<number> {
    const data = await this.sheetsCall(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    }) as { replies?: { addSheet?: { properties?: { sheetId?: number } } }[] };
    return Number(data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0);
  }

  /** Ghi nối dòng; trả vùng đã ghi (vd "'Bot trợ lý'!A5:C5"). */
  async appendRows(spreadsheetId: string, sheetTitle: string, rows: (string | number)[][]): Promise<string> {
    const range = encodeURIComponent(sheetRange(sheetTitle));
    const data = await this.sheetsCall(
      `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: JSON.stringify({ values: rows }) },
    ) as { updates?: { updatedRange?: string } };
    return data.updates?.updatedRange ?? "";
  }

  private async sheetsCall(url: string, init: RequestInit): Promise<unknown> {
    const token = await this.getAccessToken();
    const { status, ok, json } = await this.call(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!ok) throw describeSheetsFailure(status, json as never, this.account.client_email);
    return json;
  }

  private async call(url: string, init: RequestInit): Promise<{ status: number; ok: boolean; json: unknown }> {
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new GoogleSheetsError(NETWORK_ERROR_TEXT);
    }
    const json: unknown = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, json };
  }
}

/** Link mở thẳng một tab của trang tính. */
export function sheetUrl(spreadsheetId: string, sheetId: number): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`;
}

export interface SheetsTestResult {
  ok: true;
  spreadsheet_title: string;
  sheet_title: string;
  appended_range: string;
}

/** Nút «Kiểm tra kết nối»: đọc tiêu đề → bảo đảm tab "Bot trợ lý" → ghi một dòng [giờ VN, câu thử, email service account]. */
export async function testSheetsConnection(client: GoogleSheetsClient, spreadsheetId: string, now = Date.now()): Promise<SheetsTestResult> {
  const info = await client.getSpreadsheet(spreadsheetId);
  await client.ensureSheet(spreadsheetId, TEST_SHEET_TITLE);
  const vnTime = new Date(now + VN_OFFSET_MS).toISOString().replace("T", " ").slice(0, 19);
  const range = await client.appendRows(spreadsheetId, TEST_SHEET_TITLE, [[vnTime, "Kết nối thử từ Bot trợ lý", client.clientEmail]]);
  return { ok: true, spreadsheet_title: info.title, sheet_title: TEST_SHEET_TITLE, appended_range: range };
}
