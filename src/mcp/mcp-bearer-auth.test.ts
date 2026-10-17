import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBearerToken } from "./mcp-bearer-auth.js";

test("parseBearerToken: tách khóa từ tiêu đề Authorization", () => {
  assert.equal(parseBearerToken("Bearer idamcp_abc"), "idamcp_abc");
  assert.equal(parseBearerToken("bearer   idamcp_abc  "), "idamcp_abc");
  assert.equal(parseBearerToken("BEARER\tidamcp_abc"), "idamcp_abc");
});

test("parseBearerToken: thiếu / sai khuôn → null", () => {
  assert.equal(parseBearerToken(undefined), null);
  assert.equal(parseBearerToken(["Bearer a"]), null);
  assert.equal(parseBearerToken(""), null);
  assert.equal(parseBearerToken("Bearer"), null);
  assert.equal(parseBearerToken("Bearer "), null);
  assert.equal(parseBearerToken("Basic dXNlcjpwYXNz"), null);
  assert.equal(parseBearerToken("Bearer a b"), null);
  assert.equal(parseBearerToken("idamcp_abc"), null);
});
