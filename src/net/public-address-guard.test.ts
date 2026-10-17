import assert from "node:assert/strict";
import { test } from "node:test";
import { UnsafeUrlError, assertPublicHttpUrl, isPrivateAddress } from "./public-address-guard.js";

test("isPrivateAddress: IPv4 nội bộ / metadata bị chặn, IPv4 công khai qua", () => {
  for (const a of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1"]) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ["8.8.8.8", "172.32.0.1", "142.250.66.78"]) assert.equal(isPrivateAddress(a), false, a);
});

test("isPrivateAddress: IPv6 NAT64 / 6to4 / mapped / compatible đều bị chặn", () => {
  for (const a of [
    "::1", "::", "fd00::1", "fe80::1", "ff02::1",
    "64:ff9b::7f00:1", "64:ff9b::127.0.0.1", "64:ff9b::a9fe:a9fe", // NAT64 tới 127.0.0.1 / 169.254.169.254
    "64:ff9b:1::5db8:d822", // NAT64 dùng nội bộ
    "2002:7f00:1::", "2002:a9fe:a9fe::1", // 6to4 nhúng 127.0.0.1 / metadata
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:a00:5",
    "::127.0.0.1", "::7f00:1", // IPv4-compatible
  ]) assert.equal(isPrivateAddress(a), true, a);
  for (const a of ["2404:6800:4005::200e", "::ffff:5db8:d822", "::ffff:93.184.216.34", "2606:4700::1111",
    "64:ff9b::5db8:d822", // NAT64 tới IPv4 công khai (máy chỉ IPv6 + DNS64)
  ]) {
    assert.equal(isPrivateAddress(a), false, a);
  }
});

test("assertPublicHttpUrl: giao thức lạ, không tìm thấy máy, trỏ nội bộ, và trường hợp qua", async () => {
  const lookup = async (host: string) => (host === "cdn.test" ? ["93.184.216.34"] : host === "evil.test" ? ["93.184.216.34", "10.0.0.2"] : []);
  await assert.rejects(assertPublicHttpUrl(new URL("ftp://cdn.test/x"), lookup), (e: UnsafeUrlError) => e.reason === "protocol");
  await assert.rejects(assertPublicHttpUrl(new URL("http://nope.test/"), lookup), (e: UnsafeUrlError) => e.reason === "not-found");
  await assert.rejects(assertPublicHttpUrl(new URL("http://evil.test/"), lookup), (e: UnsafeUrlError) => e.reason === "private");
  await assert.rejects(assertPublicHttpUrl(new URL("http://[::1]/"), lookup), (e: UnsafeUrlError) => e.reason === "private");
  await assert.rejects(assertPublicHttpUrl(new URL("http://2130706433/"), lookup), (e: UnsafeUrlError) => e.reason === "private");
  await assertPublicHttpUrl(new URL("https://cdn.test/a.jpg"), lookup);
});
