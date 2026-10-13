import assert from "node:assert/strict";
import { test } from "node:test";
import { METRIC_SOURCE_LIST_SPEC, toSourceApi } from "./metric-sources-api.js";
import { parseSourceDraft } from "./metric-source-input.js";

const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const MAPPING = { date: "Ngày", staff: "Nhân viên", staff_by: "name", area: "", metrics: [{ code: "doanh_so", label: "Doanh số", column: "D", unit: "đ" }] };

test("METRIC_SOURCE_LIST_SPEC: khai đủ cột lọc / sắp xếp / tìm", () => {
  assert.deepEqual(Object.keys(METRIC_SOURCE_LIST_SPEC.fields).sort(), ["daily_report", "is_active", "name", "status"]);
  assert.deepEqual(Object.keys(METRIC_SOURCE_LIST_SPEC.sorts).sort(), ["created_at", "last_ok_at", "last_sync_at", "name", "status"]);
  assert.equal(METRIC_SOURCE_LIST_SPEC.search?.param, "q");
});

test("parseSourceDraft: thêm mới đủ trường, link đầy đủ hoặc mã trần đều ra mã bảng; ánh xạ về dạng chuẩn", () => {
  const draft = parseSourceDraft({
    name: " BCSale ", spreadsheet_url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`, sheet_title: "T10", header_row: "2",
    mapping: MAPPING, daily_report: true,
  }, true);
  assert.equal(draft.name, "BCSale");
  assert.equal(draft.spreadsheetId, SHEET_ID);
  assert.equal(draft.headerRow, 2);
  assert.equal(draft.dailyReport, true);
  assert.deepEqual(draft.mapping?.metrics, [{ code: "doanh_so", label: "Doanh số", column: "D", unit: "đ", aggregate: "sum" }]);
  assert.equal(parseSourceDraft({ spreadsheet_id: SHEET_ID }, false).spreadsheetId, SHEET_ID);
});

test("parseSourceDraft: thiếu / sai thì 422 bằng câu tiếng Việt", () => {
  assert.throws(() => parseSourceDraft({ sheet_title: "T10", mapping: MAPPING }, true), /link bảng/);
  assert.throws(() => parseSourceDraft({ spreadsheet_url: SHEET_ID, mapping: MAPPING }, true), /tên tab/);
  assert.throws(() => parseSourceDraft({ spreadsheet_url: SHEET_ID, sheet_title: "T10" }, true), /ánh xạ/);
  assert.throws(() => parseSourceDraft({ sheet_title: "x".repeat(151) }, false), /tối đa 150/);
  assert.throws(() => parseSourceDraft({ header_row: 0 }, false), /Dòng tiêu đề/);
  assert.throws(() => parseSourceDraft({ spreadsheet_url: "https://example.com/abc" }, false), /Google Sheets/);
  assert.throws(() => parseSourceDraft({ mapping: { date: "Ngày", staff: "NV", metrics: [] } }, false), /chỉ tiêu/);
  assert.throws(() => parseSourceDraft({ is_active: "có" }, false), /không hợp lệ/);
});

test("parseSourceDraft: PATCH một phần chỉ trả trường được gửi", () => {
  assert.deepEqual(parseSourceDraft({ daily_report: false }, false), { dailyReport: false });
});

test("toSourceApi: dựng link bảng, đếm chỉ tiêu, không có khóa nào ngoài trường khai", () => {
  const api = toSourceApi({
    id: 3, name: "BCSale", spreadsheetId: SHEET_ID, sheetTitle: "T10", headerRow: 1, mapping: MAPPING, dailyReport: true, isActive: true,
    status: 1, lastSyncAt: null, lastOkAt: null, lastError: "", lastRowCount: 0, lastWarningCount: 0, lastWarnings: [],
  });
  assert.equal(api.spreadsheet_url, `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
  assert.equal(api.metric_count, 1);
});
