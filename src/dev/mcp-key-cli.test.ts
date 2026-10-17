import assert from "node:assert/strict";
import { test } from "node:test";
import { McpAccessLevel } from "../constants.js";
import { parseCreateArgs } from "./mcp-key-cli.js";

test("create: mặc định chỉ đọc, không hết hạn, không Mật", () => {
  assert.deepEqual(parseCreateArgs(["admin", "Claude máy văn phòng"]),
    { login: "admin", name: "Claude máy văn phòng", accessLevel: McpAccessLevel.Read, days: null, includeConfidential: false });
});

test("create: write + --days + --confidential ở bất kỳ vị trí nào", () => {
  const parsed = parseCreateArgs(["--confidential", "a@x.vn", "Codex", "write", "--days", "30"]);
  assert.equal(parsed.accessLevel, McpAccessLevel.ReadWrite);
  assert.equal(parsed.days, 30);
  assert.equal(parsed.includeConfidential, true);
});

test("create: sai cú pháp → lỗi", () => {
  assert.throws(() => parseCreateArgs([]));
  assert.throws(() => parseCreateArgs(["admin"]));
  assert.throws(() => parseCreateArgs(["admin", "k", "admin"]), /read \| write/);
  assert.throws(() => parseCreateArgs(["admin", "k", "read", "thừa"]));
  assert.throws(() => parseCreateArgs(["admin", "k", "--days"]), /--days/);
  assert.throws(() => parseCreateArgs(["admin", "k", "--days", "0"]), /--days/);
  assert.throws(() => parseCreateArgs(["admin", "k", "--days", "x"]), /--days/);
  assert.throws(() => parseCreateArgs(["admin", "k", "--lạ"]), /tùy chọn/);
});
