import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppConfig } from "../config.js";
import { DRIVE_SCOPE } from "./google-oauth.js";
import { DriveClient, isAudioFile } from "./drive-client.js";
import { GoogleSheetsError, NETWORK_ERROR_TEXT } from "./sheets-error-messages.js";

// Không gọi mạng thật: tiêm fetcher giả phân biệt bằng URL (khuôn giống calendar-meetings.test.ts).

const FOLDER_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const GOOGLE_WITH_DRIVE: AppConfig["google"] = {
  serviceAccount: null, spreadsheetUrl: "",
  oauthClientId: "1.apps.googleusercontent.com", oauthClientSecret: "s",
  calendarAccount: { email: "bot@gmail.com", refresh_token: "rt", granted_scopes: ["https://www.googleapis.com/auth/calendar.events", DRIVE_SCOPE] },
};
const GOOGLE_NO_DRIVE_SCOPE: AppConfig["google"] = {
  ...GOOGLE_WITH_DRIVE,
  calendarAccount: { email: "bot@gmail.com", refresh_token: "rt", granted_scopes: ["https://www.googleapis.com/auth/calendar.events"] },
};
const GOOGLE_NOT_CONNECTED: AppConfig["google"] = { ...GOOGLE_WITH_DRIVE, calendarAccount: null };

type Handler = (url: string) => { status?: number; body?: unknown; stream?: ReadableStream<Uint8Array>; headers?: Record<string, string> };

function fakeFetch(handler: Handler): { fetcher: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }));
    const { status = 200, body, stream, headers } = handler(url);
    if (stream) return new Response(stream, { status, headers });
    return new Response(JSON.stringify(body ?? {}), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetcher, urls };
}

test("checkFolder returns the folder name when the id really is a folder", async () => {
  const { fetcher } = fakeFetch(() => ({ body: { id: FOLDER_ID, name: "Ghi âm họp", mimeType: "application/vnd.google-apps.folder" } }));
  const client = new DriveClient(() => GOOGLE_WITH_DRIVE, FOLDER_ID, { fetcher });
  assert.deepEqual(await client.checkFolder(), { name: "Ghi âm họp" });
});

test("checkFolder refuses an id that points at a file, not a folder", async () => {
  const { fetcher } = fakeFetch(() => ({ body: { id: FOLDER_ID, name: "x.pdf", mimeType: "application/pdf" } }));
  const client = new DriveClient(() => GOOGLE_WITH_DRIVE, FOLDER_ID, { fetcher });
  await assert.rejects(client.checkFolder(), (error) => error instanceof GoogleSheetsError && /không phải thư mục/.test(error.message));
});

test("listNewFiles scopes the query to the configured folder and the given time, skipping shortcuts", async () => {
  const { fetcher, urls } = fakeFetch((url) => ({
    body: { files: [
      { id: "f1", name: "giao-ban.mp3", mimeType: "audio/mpeg", size: "1000", createdTime: "2026-10-10T01:00:00Z" },
      { id: "sc1", name: "lối tắt", mimeType: "application/vnd.google-apps.shortcut", createdTime: "2026-10-10T01:00:00Z" },
    ] },
  }));
  const client = new DriveClient(() => GOOGLE_WITH_DRIVE, FOLDER_ID, { fetcher });
  const files = await client.listNewFiles(new Date("2026-10-10T00:00:00Z"));
  assert.deepEqual(files, [{ id: "f1", name: "giao-ban.mp3", mimeType: "audio/mpeg", size: 1000, createdTime: "2026-10-10T01:00:00Z" }]);
  const query = new URL(urls[1]).searchParams.get("q") ?? "";
  assert.ok(query.includes(`'${FOLDER_ID}' in parents`));
  assert.ok(query.includes("2026-10-10T00:00:00.000Z"));
});

test("listNewFiles follows nextPageToken but stops after three pages", async () => {
  let page = 0;
  const { fetcher, urls } = fakeFetch(() => {
    page += 1;
    return { body: { files: [{ id: `f${page}`, name: `r${page}.mp3`, mimeType: "audio/mpeg", createdTime: "2026-10-10T01:00:00Z" }], nextPageToken: "more" } };
  });
  const client = new DriveClient(() => GOOGLE_WITH_DRIVE, FOLDER_ID, { fetcher });
  const files = await client.listNewFiles(new Date("2026-10-10T00:00:00Z"));
  assert.equal(files.length, 3);
  // 1 lần đổi token (nhớ đệm trong client) + đúng 3 trang — trang thứ 4 không được gọi dù vẫn còn nextPageToken
  assert.equal(urls.length, 4);
});

test("openDownload refuses a file whose parent is not the configured folder, without streaming it", async () => {
  const { fetcher, urls } = fakeFetch(() => ({ body: { id: "f1", parents: ["mot-thu-muc-khac"], mimeType: "audio/mpeg", size: "10" } }));
  const client = new DriveClient(() => GOOGLE_WITH_DRIVE, FOLDER_ID, { fetcher });
  await assert.rejects(client.openDownload("f1"), (error) => error instanceof GoogleSheetsError && /không nằm trong thư mục/.test(error.message));
  assert.ok(!urls.some((url) => url.includes("alt=media")));
});

test("openDownload streams the body straight through without buffering it", async () => {
  const chunks = [new Uint8Array([1, 2, 3])];
  const stream = new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } });
  const { fetcher } = fakeFetch((url) => (url.includes("alt=media")
    ? { stream, headers: { "Content-Type": "audio/mpeg" } }
    : { body: { id: "f1", parents: [FOLDER_ID], mimeType: "audio/mpeg", size: "3" } }));
  const client = new DriveClient(() => GOOGLE_WITH_DRIVE, FOLDER_ID, { fetcher });
  const download = await client.openDownload("f1");
  assert.equal(download.size, 3);
  assert.equal(download.mime, "audio/mpeg");
  assert.equal(download.body, stream, "phải trả đúng ReadableStream gốc — không đọc vào Buffer / mảng trung gian");
});

test("getFileMeta returns the file's metadata when it sits in the configured folder", async () => {
  const { fetcher } = fakeFetch(() => ({ body: { id: "f1", name: "giao-ban.mp3", mimeType: "audio/mpeg", size: "1000", createdTime: "2026-10-10T01:00:00Z", parents: [FOLDER_ID] } }));
  const client = new DriveClient(() => GOOGLE_WITH_DRIVE, FOLDER_ID, { fetcher });
  assert.deepEqual(await client.getFileMeta("f1"), { id: "f1", name: "giao-ban.mp3", mimeType: "audio/mpeg", size: 1000, createdTime: "2026-10-10T01:00:00Z" });
});

test("getFileMeta refuses a file outside the configured folder", async () => {
  const { fetcher } = fakeFetch(() => ({ body: { id: "f1", name: "x.mp3", mimeType: "audio/mpeg", size: "10", parents: ["mot-thu-muc-khac"] } }));
  const client = new DriveClient(() => GOOGLE_WITH_DRIVE, FOLDER_ID, { fetcher });
  await assert.rejects(client.getFileMeta("f1"), (error) => error instanceof GoogleSheetsError && /không nằm trong thư mục/.test(error.message));
});

test("getFileMeta turns a 404 into a file-specific (not folder-specific) message", async () => {
  const { fetcher } = fakeFetch(() => ({ status: 404, body: { error: { message: "File not found" } } }));
  const client = new DriveClient(() => GOOGLE_WITH_DRIVE, FOLDER_ID, { fetcher });
  await assert.rejects(client.getFileMeta("khong-co"), (error) => error instanceof GoogleSheetsError && /Không thấy tệp này/.test(error.message));
});

test("not connected to Google is reported before any Drive call", async () => {
  const { fetcher, urls } = fakeFetch(() => ({ body: {} }));
  const client = new DriveClient(() => GOOGLE_NOT_CONNECTED, FOLDER_ID, { fetcher });
  await assert.rejects(client.checkFolder(), (error) => error instanceof GoogleSheetsError && /Chưa kết nối Google/.test(error.message));
  assert.equal(urls.length, 0);
});

test("missing the Drive scope is reported without calling Google, telling the admin to reconnect", async () => {
  const { fetcher, urls } = fakeFetch(() => ({ body: {} }));
  const client = new DriveClient(() => GOOGLE_NO_DRIVE_SCOPE, FOLDER_ID, { fetcher });
  await assert.rejects(client.checkFolder(), (error) => error instanceof GoogleSheetsError && /Chưa có quyền đọc Google Drive/.test(error.message));
  assert.equal(urls.length, 0);
});

test("network errors and Drive API failures become actionable messages", async () => {
  const offlineFetcher = (async (input: string | URL | Request) => (String(input).includes("oauth2")
    ? new Response(JSON.stringify({ access_token: "at" }))
    : Promise.reject(new Error("boom")))) as typeof fetch;
  const offlineClient = new DriveClient(() => GOOGLE_WITH_DRIVE, FOLDER_ID, { fetcher: offlineFetcher });
  await assert.rejects(offlineClient.checkFolder(), (error) => error instanceof GoogleSheetsError && error.message === NETWORK_ERROR_TEXT);

  const { fetcher } = fakeFetch(() => ({ status: 403, body: { error: { message: "Google Drive API has not been used in project 123" } } }));
  const disabledClient = new DriveClient(() => GOOGLE_WITH_DRIVE, FOLDER_ID, { fetcher });
  await assert.rejects(disabledClient.checkFolder(), (error) => error instanceof GoogleSheetsError && /bật Google Drive API/.test(error.message));
});

test("isAudioFile matches by mime type or by a familiar extension when Drive reports a generic mime", () => {
  assert.equal(isAudioFile({ name: "x.mp3", mimeType: "audio/mpeg" }), true);
  assert.equal(isAudioFile({ name: "x.mp3", mimeType: "application/octet-stream" }), true);
  assert.equal(isAudioFile({ name: "x.m4a", mimeType: "application/octet-stream" }), true);
  assert.equal(isAudioFile({ name: "x.pdf", mimeType: "application/pdf" }), false);
  assert.equal(isAudioFile({ name: "no-extension", mimeType: "application/octet-stream" }), false);
});
