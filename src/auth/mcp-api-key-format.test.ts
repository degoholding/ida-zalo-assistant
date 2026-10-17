import assert from "node:assert/strict";
import { test } from "node:test";
import { extractBearerToken, generateMcpKey, hashMcpKey, parseMcpKey } from "./mcp-api-key-format.js";

test("khóa sinh ra đúng định dạng, băm SHA-256 hex 64 ký tự, tiền tố 8 ký tự base62", () => {
  const key = generateMcpKey();
  assert.match(key.token, /^idamcp_[0-9A-Za-z]{8}_[A-Za-z0-9_-]{43}$/);
  assert.match(key.prefix, /^[0-9A-Za-z]{8}$/);
  assert.match(key.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(key.tokenHash, hashMcpKey(key.token));
  assert.ok(key.token.startsWith(`idamcp_${key.prefix}_`));
  assert.ok(!key.token.includes(key.tokenHash));
});

test("hai lần sinh không trùng nhau", () => {
  const tokens = new Set(Array.from({ length: 50 }, () => generateMcpKey().token));
  assert.equal(tokens.size, 50);
});

test("parseMcpKey: khóa hợp lệ → tiền tố + băm; cắt khoảng trắng hai đầu", () => {
  const key = generateMcpKey();
  assert.deepEqual(parseMcpKey(` ${key.token}\n`), { prefix: key.prefix, tokenHash: key.tokenHash });
});

test("parseMcpKey: sai định dạng → null", () => {
  const key = generateMcpKey();
  for (const bad of ["", "abc", "idamcp_", `${key.token}x`, key.token.slice(0, -1), key.token.replace("idamcp", "other"),
    `idamcp_${key.prefix.slice(1)}_${key.token.slice(16)}`, `${key.token} ${key.token}`, "idamcp_ab-cdefg_" + "A".repeat(43)]) {
    assert.equal(parseMcpKey(bad), null, JSON.stringify(bad));
  }
});

test("hashMcpKey xác định và nhạy với từng ký tự", () => {
  assert.equal(hashMcpKey("a"), hashMcpKey("a"));
  assert.notEqual(hashMcpKey("a"), hashMcpKey("b"));
  assert.equal(hashMcpKey("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("extractBearerToken: chỉ nhận «Bearer <khóa>»", () => {
  assert.equal(extractBearerToken("Bearer abc123"), "abc123");
  assert.equal(extractBearerToken("bearer abc123"), "abc123");
  for (const bad of [undefined, "", "Bearer", "Bearer ", "Basic abc", "Bearer a b", "abc"]) assert.equal(extractBearerToken(bad), null, String(bad));
});
