import assert from "node:assert/strict";
import { test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { BRIEF_LIST_SPEC, briefFileContentType, buildBriefCreatedAtCondition, decorate, parseBriefFiles } from "./briefs-api.js";

test("buildBriefCreatedAtCondition: đúng ngày / ≤ / > / trong khoảng lấy trọn ngày theo giờ Việt Nam, rác thì bỏ lọc", () => {
  const start = new Date("2026-10-04T17:00:00Z");
  const next = new Date("2026-10-05T17:00:00Z");
  assert.deepEqual(buildBriefCreatedAtCondition("eq", ["2026-10-05"]), { sql: "(b.created_at >= ? AND b.created_at < ?)", params: [start, next] });
  assert.deepEqual(buildBriefCreatedAtCondition("lte", ["2026-10-05"]), { sql: "b.created_at < ?", params: [next] });
  assert.deepEqual(buildBriefCreatedAtCondition("gt", ["2026-10-05"]), { sql: "b.created_at >= ?", params: [next] });
  assert.deepEqual(buildBriefCreatedAtCondition("between", ["2026-10-01", "2026-10-05"]),
    { sql: "(b.created_at >= ? AND b.created_at < ?)", params: [new Date("2026-09-30T17:00:00Z"), next] });
  assert.equal(buildBriefCreatedAtCondition("between", ["2026-10-01"]), null);
  assert.equal(buildBriefCreatedAtCondition("eq", ["rác"]), null);
  assert.equal(buildBriefCreatedAtCondition("isnull", ["1"]), null);
});

test("BRIEF_LIST_SPEC: khai đủ bộ lọc + sắp xếp + tìm mà màn web dùng (CLAUDE.md — trường không khai thì bộ lọc bỏ qua im lặng)", () => {
  assert.deepEqual(Object.keys(BRIEF_LIST_SPEC.fields).sort(), ["created_at", "kind", "recipient_id", "status", "trigger_source"]);
  assert.deepEqual(Object.keys(BRIEF_LIST_SPEC.sorts).sort(), ["created_at", "sent_at"]);
  assert.equal(BRIEF_LIST_SPEC.search?.param, "q");
  assert.deepEqual(BRIEF_LIST_SPEC.search?.columns, ["r.name", "b.period_label"]);
  assert.deepEqual(BRIEF_LIST_SPEC.defaultSort, { by: "created_at", dir: "desc" });
});

test("briefFileContentType: pdf / xlsx đúng kiểu, hoa thường đều nhận, đuôi lạ hoặc không có đuôi thì octet-stream", () => {
  assert.equal(briefFileContentType("Bao-cao-tuan.pdf"), "application/pdf");
  assert.equal(briefFileContentType("BAO-CAO.XLSX"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(briefFileContentType("tep-la.docx"), "application/octet-stream");
  assert.equal(briefFileContentType("khong-co-duoi"), "application/octet-stream");
  assert.equal(briefFileContentType(""), "application/octet-stream");
});

// decorate: lỗi nội bộ không được lộ cho người không quản trị (review phase 8, Low).
const errorRow = { recipient_id: 1, kind: 1, trigger_source: 1, status: 4, file_count: 0, ai_note: "", error: "Error: ECONNREFUSED 10.0.0.5:3306" } as unknown as RowDataPacket;

test("decorate: quản trị thấy nguyên văn lỗi nội bộ", () => {
  const [row] = decorate([errorRow], true);
  assert.equal(row.error, "Error: ECONNREFUSED 10.0.0.5:3306");
});

test("decorate: người không quản trị chỉ thấy câu chung, không lộ chi tiết nội bộ", () => {
  const [row] = decorate([errorRow], false);
  assert.equal(row.error, "Có lỗi khi soạn / gửi — báo quản trị kiểm tra nhật ký hệ thống.");
});

test("decorate: không có lỗi (chuỗi rỗng) thì vẫn rỗng cho cả hai vai trò", () => {
  const okRow = { ...errorRow, error: "" } as unknown as RowDataPacket;
  assert.equal(decorate([okRow], false)[0].error, "");
  assert.equal(decorate([okRow], true)[0].error, "");
});

test("parseBriefFiles: null/undefined → rỗng; chuỗi JSON (phòng hờ driver) hay mảng object đều đọc được; không phải mảng → rỗng", () => {
  assert.deepEqual(parseBriefFiles(null), []);
  assert.deepEqual(parseBriefFiles(undefined), []);
  assert.deepEqual(parseBriefFiles(""), []);
  const files = [{ fileName: "a.pdf", storageKey: "reports/202610/a.pdf", bytes: 10 }];
  assert.deepEqual(parseBriefFiles(files), files);
  assert.deepEqual(parseBriefFiles(JSON.stringify(files)), files);
  assert.deepEqual(parseBriefFiles({ fileName: "không phải mảng" }), []);
  assert.deepEqual(parseBriefFiles(123), []);
});
