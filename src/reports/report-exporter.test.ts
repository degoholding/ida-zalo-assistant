import assert from "node:assert/strict";
import { test } from "node:test";
import type { Readable } from "node:stream";
import type { AppConfig } from "../config.js";
import type { GoogleSheetsClient } from "../google/sheets-client.js";
import { GoogleSheetsError } from "../google/sheets-error-messages.js";
import type { FileStorage } from "../storage/file-storage.js";
import { ReportExporter, vnTimestamp } from "./report-exporter.js";
import { normalizeReportTable } from "./report-table.js";

// Không gọi Google thật, không ghi đĩa: kho tệp trong bộ nhớ + client Sheets giả.

const NOW = new Date("2026-10-05T10:20:45Z"); // 17:20:45 giờ Việt Nam
const TABLE = normalizeReportTable({ title: "Báo cáo tuần", columns: ["Nhóm", "Việc"], rows: [["K52", "Thiếu thợ hàn"]] });
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const ACCOUNT = {
  type: "service_account", client_email: "bot@demo.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n", token_uri: "https://oauth2.googleapis.com/token",
};

function memoryStorage(): FileStorage & { saved: Map<string, Buffer> } {
  const saved = new Map<string, Buffer>();
  return {
    saved,
    put: async (key, body) => { saved.set(key, body); return key; },
    delete: async (key) => { saved.delete(key); },
    read: async () => { throw new Error("không dùng") as never as Readable; },
  };
}

function fakeSheets(behaviour: { fail?: GoogleSheetsError }) {
  const calls: { addSheet: string[]; appended: (string | number)[][][] } = { addSheet: [], appended: [] };
  const client = {
    addSheet: async (_id: string, title: string) => {
      if (behaviour.fail) throw behaviour.fail;
      calls.addSheet.push(title);
      return 777;
    },
    appendRows: async (_id: string, _title: string, rows: (string | number)[][]) => { calls.appended.push(rows); return "A1:B6"; },
  } as unknown as GoogleSheetsClient;
  return { calls, factory: () => client };
}

const google = (connected: boolean): AppConfig["google"] =>
  connected ? { serviceAccount: ACCOUNT, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit` } : { serviceAccount: null, spreadsheetUrl: "" };

test("formats Vietnam time for display and for file names", () => {
  assert.deepEqual(vnTimestamp(NOW), { text: "05/10/2026 17:20", stamp: "20261005-172045" });
});

test("auto without Google Sheets builds an Excel file in storage for the bot to send", async () => {
  const storage = memoryStorage();
  const outcome = await new ReportExporter(storage, () => google(false)).export(TABLE, "auto", NOW, "Trần Được");
  assert.equal(outcome.response.format, "excel");
  assert.equal(outcome.file?.fileName, "Bao-cao-tuan - 05-10-2026 - Tran-Duoc.xlsx");
  // Dấu giờ trong khóa kho: hai báo cáo cùng tên trong ngày không đè nhau
  assert.equal(outcome.file?.storageKey, "reports/202610/20261005-172045-Bao-cao-tuan - 05-10-2026 - Tran-Duoc.xlsx");
  assert.ok(storage.saved.get(outcome.file!.storageKey)!.length > 1000);
});

test("auto with Google Sheets connected writes a new tab and returns a link to it", async () => {
  const sheets = fakeSheets({});
  const storage = memoryStorage();
  const outcome = await new ReportExporter(storage, () => google(true), sheets.factory).export(TABLE, "auto", NOW);
  assert.equal(outcome.file, null);
  assert.equal(outcome.response.link, `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=777`);
  assert.deepEqual(sheets.calls.addSheet, ["Báo cáo tuần 20261005-172045"]);
  assert.deepEqual(sheets.calls.appended[0].at(-1), ["K52", "Thiếu thợ hàn"]);
  assert.equal(storage.saved.size, 0);
});

test("explicit excel wins even when Google Sheets is connected", async () => {
  const sheets = fakeSheets({});
  const outcome = await new ReportExporter(memoryStorage(), () => google(true), sheets.factory).export(TABLE, "excel", NOW);
  assert.equal(outcome.response.format, "excel");
  assert.equal(sheets.calls.addSheet.length, 0);
});

test("explicit sheets without a connection tells the model instead of silently making Excel", async () => {
  const outcome = await new ReportExporter(memoryStorage(), () => google(false)).export(TABLE, "sheets", NOW);
  assert.match(String(outcome.response.error), /chưa kết nối/);
  assert.equal(outcome.file, null);
});

test("a Google failure falls back to Excel on auto, but reports the error when Sheets was asked for", async () => {
  const fail = new GoogleSheetsError("Trang tính chưa chia sẻ cho bot@demo.iam.gserviceaccount.com", 403);
  const auto = await new ReportExporter(memoryStorage(), () => google(true), fakeSheets({ fail }).factory).export(TABLE, "auto", NOW);
  assert.equal(auto.response.format, "excel");
  assert.match(String(auto.response.note), /chưa chia sẻ/);
  assert.ok(auto.file);
  const strict = await new ReportExporter(memoryStorage(), () => google(true), fakeSheets({ fail }).factory).export(TABLE, "sheets", NOW);
  assert.match(String(strict.response.error), /chưa chia sẻ/);
  assert.equal(strict.file, null);
});

test("reads the Google connection at export time, so a change on the Settings screen applies immediately", async () => {
  let connected = false;
  const exporter = new ReportExporter(memoryStorage(), () => google(connected), fakeSheets({}).factory);
  assert.equal((await exporter.export(TABLE, "auto", NOW)).response.format, "excel");
  connected = true;
  assert.equal((await exporter.export(TABLE, "auto", NOW)).response.format, "sheets");
});
