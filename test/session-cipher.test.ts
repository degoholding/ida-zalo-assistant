import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptJson, encryptJson, generateKey } from "../src/crypto/session-cipher.js";
import { buildStorageKey, sanitizeFileName } from "../src/sync/attachment-downloader.js";

test("mã hóa rồi giải mã ra đúng phiên ban đầu, chuỗi lưu không lộ cookie", () => {
  const key = generateKey();
  const session = { imei: "abc", cookie: [{ name: "zpw_sek", value: "BI-MAT" }], userAgent: "UA" };
  const stored = encryptJson(session, key);
  assert.ok(!stored.includes("BI-MAT"));
  assert.deepEqual(decryptJson(stored, key), session);
});

test("sai khóa thì không giải mã được (GCM kiểm toàn vẹn)", () => {
  const stored = encryptJson({ a: 1 }, generateKey());
  assert.throws(() => decryptJson(stored, generateKey()));
});

test("bị sửa một ký tự thì không giải mã được", () => {
  const key = generateKey();
  const stored = encryptJson({ a: 1 }, key);
  const tampered = stored.slice(0, -2) + (stored.endsWith("A") ? "B" : "A") + stored.slice(-1);
  assert.throws(() => decryptJson(tampered, key));
});

test("khóa không đủ 32 byte bị chặn ngay", () => {
  assert.throws(() => encryptJson({}, Buffer.from("ngan").toString("base64")), /32 byte/);
});

test("tên tệp bỏ ký tự cấm, khóa lưu chia theo nhóm + tháng", () => {
  assert.equal(sanitizeFileName('a/b:c*?"<>|.pdf'), "a_b_c_.pdf");
  const key = buildStorageKey(
    { id: 7, zalo_group_id: "g1", sent_at: new Date("2026-10-01T03:00:00Z"), file_name: "", file_ext: "" },
    "image/jpeg",
  );
  assert.equal(key, "g1/2026-10/7-tep.jpg");
  const named = buildStorageKey(
    { id: 8, zalo_group_id: "g1", sent_at: new Date("2026-10-01T03:00:00Z"), file_name: "Bao gia", file_ext: "xlsx" },
    "application/octet-stream",
  );
  assert.equal(named, "g1/2026-10/8-Bao gia.xlsx");
});
