import assert from "node:assert/strict";
import { test } from "node:test";
import { createFreeWebSearch, extractPageText, isPublicUrl, parseBing, parseDuckDuckGo } from "./free-web-search.js";

const DDG_HTML = `
<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsjc.com.vn%2Fgia-vang&amp;rut=x">Giá vàng <b>SJC</b> hôm nay</a>
<a class="result__snippet" href="#">Vàng miếng 140 &ndash; 143 triệu&nbsp;đồng/lượng</a>
<a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Quảng cáo</a>
<a class="result__a" href="https://vnexpress.net/gia-vang">VnExpress &amp; giá vàng</a>
<a class="result__snippet" href="#">Cập nhật 08/10</a>`;

const BING_HTML = `<ol><li class="b_algo"><h2><a href="https://fpt.com.vn/ir" h="x">Báo cáo tài chính FPT</a></h2><p>Quý 2/2026 &amp; năm</p></li>
<li class="b_algo"><h2><a href="/relative">bỏ</a></h2></li></ol>`;

test("DuckDuckGo results: redirect links unwrapped, ads dropped, entities decoded", () => {
  assert.deepEqual(parseDuckDuckGo(DDG_HTML), [
    { title: "Giá vàng SJC hôm nay", url: "https://sjc.com.vn/gia-vang", snippet: "Vàng miếng 140 &ndash; 143 triệu đồng/lượng" },
    { title: "VnExpress & giá vàng", url: "https://vnexpress.net/gia-vang", snippet: "Cập nhật 08/10" },
  ]);
  assert.deepEqual(parseDuckDuckGo("<html>chặn bot</html>"), []);
});

test("Bing results keep only absolute links", () => {
  assert.deepEqual(parseBing(BING_HTML), [{ title: "Báo cáo tài chính FPT", url: "https://fpt.com.vn/ir", snippet: "Quý 2/2026 & năm" }]);
});

test("page text drops scripts, styles, menus and footers", () => {
  const html = `<html><head><style>body{}</style><script>var giá = 1;</script></head><body><nav>Menu</nav>
    <h1>Giá vàng</h1><p>SJC 143 triệu</p><!-- quảng cáo --><footer>© báo</footer></body></html>`;
  assert.equal(extractPageText(html), "Giá vàng SJC 143 triệu");
});

test("only public addresses are fetched — localhost, private ranges and metadata IPs are refused", async () => {
  const resolve = async (host: string) => ({ "a.vn": ["1.2.3.4"], "noi-bo.vn": ["10.0.0.5"], "lan.vn": ["192.168.1.2", "1.1.1.1"] } as Record<string, string[]>)[host] ?? [];
  assert.equal(await isPublicUrl("https://a.vn/x", resolve), true);
  for (const url of ["http://localhost:8090/api", "http://127.0.0.1/", "http://169.254.169.254/latest", "https://noi-bo.vn/", "https://lan.vn/",
    "http://[::1]/", "file:///etc/passwd", "https://khong-co.vn/", "http://172.20.0.3:3306/", "http://bot-tro-ly-mysql-1/"]) {
    assert.equal(await isPublicUrl(url, resolve), false, url);
  }
});

test("search + read: pages are read in parallel, a redirect into the private network is not followed, nothing found is an error", async () => {
  const requested: string[] = [];
  const fetchImpl = async (url: string) => {
    requested.push(url);
    if (url.startsWith("https://html.duckduckgo.com")) return new Response(DDG_HTML, { status: 200 });
    if (url === "https://sjc.com.vn/gia-vang") return new Response("", { status: 302, headers: { location: "http://10.0.0.9/admin" } });
    if (url === "https://vnexpress.net/gia-vang") return new Response("<p>SJC bán 143 triệu</p>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("", { status: 404 });
  };
  const resolve = async (host: string) => (host === "10.0.0.9" ? ["10.0.0.9"] : ["93.184.216.34"]);
  const result = await createFreeWebSearch({ fetchImpl, resolve })("giá vàng hôm nay");
  assert.match(result.text, /\[1\] Giá vàng SJC hôm nay — https:\/\/sjc\.com\.vn\/gia-vang\nTóm tắt kết quả tìm: Vàng miếng/);
  assert.match(result.text, /\[2\] VnExpress & giá vàng — https:\/\/vnexpress\.net\/gia-vang\nTóm tắt kết quả tìm: Cập nhật 08\/10\nNội dung trang: SJC bán 143 triệu/);
  assert.ok(!requested.includes("http://10.0.0.9/admin"), "đã đi theo chuyển hướng vào mạng nội bộ");
  assert.equal(result.sources.length, 2);

  const blocked = createFreeWebSearch({ fetchImpl: async () => new Response("captcha", { status: 200 }), resolve });
  await assert.rejects(blocked("q"), /không tìm được kết quả/);
});
