import assert from "node:assert/strict";
import { test } from "node:test";
import { UserRole } from "../constants.js";
import { manager } from "../data-access/data-access-test-support.js";
import { accessFingerprint, ReportFileStore, signReportLink, verifyReportLink, type StoredReport } from "./mcp-report-files.js";

const SECRET = "khoa-ky-thu-0123456789abcdef";
const NOW = Date.UTC(2026, 9, 28, 3, 0, 0);
const report = (overrides: Partial<StoredReport> = {}): StoredReport => ({
  keyId: 5, fingerprint: "f", fileName: "a.xlsx", contentType: "x", data: Buffer.alloc(10), rowCount: 1, expiresAtMs: NOW + 600_000, ...overrides,
});
const parse = (link: string) => {
  const url = new URL(link);
  return { path: url.pathname, params: url.searchParams };
};

test("link báo cáo: đúng chữ ký + còn hạn thì qua; sửa mã tệp / khóa / hạn / chữ ký hoặc quá hạn đều bị từ chối", () => {
  const link = signReportLink("https://bot.vn", "AbCdEfGhIjKlMnOpQrStUvWx", 5, NOW + 600_000, SECRET);
  const { path, params } = parse(link);
  assert.deepEqual(verifyReportLink(path, params, SECRET, NOW), { token: "AbCdEfGhIjKlMnOpQrStUvWx", keyId: 5 });
  assert.equal(verifyReportLink(path, params, SECRET, NOW + 601_000), null, "quá hạn");
  assert.equal(verifyReportLink(path, params, "khoa-khac-0123456789abcdef", NOW), null, "khóa ký khác");
  assert.equal(verifyReportLink(path.replace("AbCd", "XbCd"), params, SECRET, NOW), null, "đổi mã tệp");
  for (const [name, value] of [["k", "6"], ["e", String(Math.floor(NOW / 1000) + 9999)], ["s", "ngan"], ["s", ""]]) {
    const tampered = new URLSearchParams(params);
    tampered.set(name, value);
    assert.equal(verifyReportLink(path, tampered, SECRET, NOW), null, `${name}=${value}`);
  }
  assert.equal(verifyReportLink("/mcp-reports/../mcp-files/1", params, SECRET, NOW), null, "đường lạ");
  assert.equal(verifyReportLink("/mcp-files/123", params, SECRET, NOW), null, "không nhận nhầm link tệp gốc");
});

test("chữ ký link báo cáo khác miền với link tệp gốc — không dùng chéo được", async () => {
  const { signFileLink } = await import("./mcp-file-links.js");
  const fileLink = new URL(signFileLink("https://bot.vn", 123, 5, SECRET, NOW));
  const forged = new URLSearchParams(fileLink.searchParams);
  assert.equal(verifyReportLink("/mcp-reports/123123123123123123123", forged, SECRET, NOW), null);
});

test("bộ đệm: hết hạn thì mất; vượt trần số tệp / dung lượng thì bỏ tệp cũ nhất, không phình", () => {
  const store = new ReportFileStore({ maxFiles: 2, maxBytes: 25 });
  const first = store.put(report(), NOW);
  const second = store.put(report(), NOW);
  const third = store.put(report(), NOW);
  assert.equal(store.get(first, NOW), null, "tệp cũ nhất bị bỏ khi quá số tệp");
  assert.ok(store.get(second, NOW) && store.get(third, NOW));
  const big = store.put(report({ data: Buffer.alloc(20) }), NOW);
  assert.ok(store.bytes <= 25, `tổng ${store.bytes} byte`);
  assert.ok(store.get(big, NOW));
  assert.equal(store.get(big, NOW + 600_001), null, "hết hạn");
  assert.equal(store.size, 0);
  assert.notEqual(first, second, "mã tệp ngẫu nhiên");
  assert.ok(/^[A-Za-z0-9_-]{24}$/.test(first));
});

test("dấu quyền đổi khi vai trò / phạm vi nhóm / cờ Mật / cuộc riêng / công tắc che đổi; thứ tự nhóm không ảnh hưởng", () => {
  const base = accessFingerprint(manager({ groupIds: [11, 12] }), null, true);
  assert.equal(accessFingerprint(manager({ groupIds: [12, 11] }), null, true), base);
  for (const changed of [
    accessFingerprint(manager({ groupIds: [11] }), null, true),
    accessFingerprint(manager({ groupIds: null }), null, true),
    accessFingerprint(manager({ groupIds: [11, 12], canViewConfidential: true }), null, true),
    accessFingerprint(manager({ groupIds: [11, 12], role: UserRole.Staff }), null, true),
    accessFingerprint(manager({ groupIds: [11, 12], userId: 8 }), null, true),
    accessFingerprint(manager({ groupIds: [11, 12] }), "uid-1", true),
    accessFingerprint(manager({ groupIds: [11, 12] }), null, false),
  ]) assert.notEqual(changed, base);
  // Phạm vi rỗng (không nhóm nào) khác «mọi nhóm»
  assert.notEqual(accessFingerprint(manager({ groupIds: [] }), null, true), accessFingerprint(manager({ groupIds: null }), null, true));
});
