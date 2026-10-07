import assert from "node:assert/strict";
import { test } from "node:test";
import { LinkReadError, htmlToText, isPrivateAddress, readLinkContent, resolveLinkTarget } from "./link-reader.js";
import { linkFingerprint } from "./read-link-tool.js";

test("resolveLinkTarget: link Google đổi sang đường xuất tệp", () => {
  assert.deepEqual(resolveLinkTarget("https://docs.google.com/spreadsheets/d/16Kf_RxhoeS8cwFZEm2HR5CPzJG_lXDNZJn0Dyy8929I/edit?usp=sharing"),
    { kind: "sheet", fetchUrl: "https://docs.google.com/spreadsheets/d/16Kf_RxhoeS8cwFZEm2HR5CPzJG_lXDNZJn0Dyy8929I/export?format=xlsx" });
  assert.equal(resolveLinkTarget("https://docs.google.com/document/d/abcdefghijkl/edit").fetchUrl, "https://docs.google.com/document/d/abcdefghijkl/export?format=txt");
  assert.equal(resolveLinkTarget("https://drive.google.com/file/d/abcdefghijkl/view").kind, "drive");
  assert.equal(resolveLinkTarget("https://vnexpress.net/abc").kind, "page");
  assert.throws(() => resolveLinkTarget("file:///etc/passwd"), LinkReadError);
  assert.throws(() => resolveLinkTarget("không phải link"), LinkReadError);
});

test("isPrivateAddress: chặn địa chỉ nội bộ, cho địa chỉ công khai", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "142.250.66.78", "172.32.0.1", "2404:6800:4005::200e"]) assert.equal(isPrivateAddress(address), false, address);
});

test("readLinkContent: link trỏ vào máy nội bộ bị chặn trước khi gọi mạng", async () => {
  let called = false;
  const fetcher = (async () => { called = true; return new Response("x"); }) as typeof fetch;
  await assert.rejects(readLinkContent("http://127.0.0.1:3308/", undefined, fetcher), LinkReadError);
  await assert.rejects(readLinkContent("http://localhost/", undefined, fetcher), LinkReadError);
  assert.equal(called, false);
});

test("htmlToText: lấy tiêu đề + chữ, bỏ script / style", () => {
  assert.equal(htmlToText("<html><title>Tin</title><style>p{}</style><script>x()</script><p>Một &amp; hai</p><p>Ba</p></html>"), "# Tin\nMột & hai\nBa");
});

test("linkFingerprint: id tệp Google, hoặc máy + đường dẫn", () => {
  assert.equal(linkFingerprint("https://docs.google.com/spreadsheets/d/16Kf_RxhoeS8cwFZEm2HR5CPzJG_lXDNZJn0Dyy8929I/edit?usp=sharing"), "16Kf_RxhoeS8cwFZEm2HR5CPzJG_lXDNZJn0Dyy8929I");
  assert.equal(linkFingerprint("https://vnexpress.net/abc/?x=1"), "vnexpress.net/abc");
  assert.equal(linkFingerprint("rác"), null);
});
