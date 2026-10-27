import assert from "node:assert/strict";
import type http from "node:http";
import { test } from "node:test";
import { PRIVACY_HTML, serveLegalPage, TERMS_HTML } from "./legal-pages.js";

function fakeResponse() {
  const sent: { status?: number; headers?: Record<string, string>; body?: string } = {};
  const response = {
    writeHead(status: number, headers: Record<string, string>) { sent.status = status; sent.headers = headers; },
    end(body?: string) { sent.body = body; },
  } as unknown as http.ServerResponse;
  return { response, sent };
}

test("trang /privacy và /terms trả HTML công khai", () => {
  for (const [path, html] of [["/privacy", PRIVACY_HTML], ["/terms/", TERMS_HTML]] as const) {
    const { response, sent } = fakeResponse();
    assert.equal(serveLegalPage(path, "GET", response), true);
    assert.equal(sent.status, 200);
    assert.match(String(sent.headers?.["Content-Type"]), /text\/html/);
    assert.equal(sent.body, html);
  }
});

test("chính sách nêu đủ phạm vi Google và cam kết Limited Use", () => {
  for (const scope of ["calendar.events", "drive.readonly", "openid"]) assert.ok(PRIVACY_HTML.includes(scope), scope);
  assert.ok(PRIVACY_HTML.includes("Limited Use"));
});

test("đường khác hoặc phương thức ghi thì để máy chủ xử lý tiếp", () => {
  const { response } = fakeResponse();
  assert.equal(serveLegalPage("/app/", "GET", response), false);
  assert.equal(serveLegalPage("/privacy", "POST", response), false);
});
