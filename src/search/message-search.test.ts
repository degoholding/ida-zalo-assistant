import assert from "node:assert/strict";
import { test } from "node:test";
import { ConcurrencyLimiter, buildSnippet, isFulltextCacheLimitError, likeOnlyCondition, likeWindowStart, messageTextCondition, splitSearchTerms } from "./message-search.js";

const FULL = { enabled: true, minTokenSize: 1 };

test("splitSearchTerms: cụm trong ngoặc kép giữ nguyên, bỏ toán tử BOOLEAN MODE người gõ lẫn vào", () => {
  assert.deepEqual(splitSearchTerms('công nợ "Minh Phát"'), ["Minh Phát", "công", "nợ"]);
  // «-» không được thành phép loại trừ, «*» không thành gần đúng, ngoặc / @ bị bỏ
  assert.deepEqual(splitSearchTerms("-hàng* (lỗi) @kho +gấp"), ["hàng", "lỗi", "kho", "gấp"]);
  assert.deepEqual(splitSearchTerms("   "), []);
  assert.deepEqual(splitSearchTerms("nợ nợ NỢ"), ["nợ", "NỢ"]);
  // Review 09/10/2026: từ toàn dấu câu / emoji không có trong chỉ mục — giữ lại thì cả câu tìm ra 0 kết quả
  assert.deepEqual(splitSearchTerms("giá vàng ? ... 😀 – A&B"), ["giá", "vàng", "A&B"]);
});

test("messageTextCondition: MySQL đã cấu hình (min token 1) → mọi chữ đi chỉ mục toàn văn, mỗi chữ bắt buộc", () => {
  assert.deepEqual(messageTextCondition("công nợ Minh", FULL), {
    sql: "MATCH(s.text) AGAINST(? IN BOOLEAN MODE)", params: ["+công +nợ +Minh"], fulltext: true,
  });
  assert.equal(messageTextCondition("   ", FULL), null);
});

// Đo 09/10/2026, 300 nghìn tin: MATCH cụm `+"công nợ"` vượt trần bộ nhớ toàn văn và làm MySQL 768 MB bị giết
test("messageTextCondition: cụm KHÔNG vào MATCH — MATCH từng chữ, thứ tự cụm kiểm bằng LIKE", () => {
  assert.deepEqual(messageTextCondition('công nợ "Minh Phát"', FULL), {
    sql: "MATCH(s.text) AGAINST(? IN BOOLEAN MODE) AND s.text LIKE ?", params: ["+Minh +Phát +công +nợ", "%Minh Phát%"], fulltext: true,
  });
  // Chữ có dấu câu: MySQL tách thành nhiều chữ — MATCH từng chữ (trùng thì gộp), cả chuỗi kiểm bằng LIKE
  assert.deepEqual(messageTextCondition("10.000.000 A&B", FULL), {
    sql: "MATCH(s.text) AGAINST(? IN BOOLEAN MODE) AND s.text LIKE ? AND s.text LIKE ?",
    params: ["+10 +000 +A +B", "%10.000.000%", "%A&B%"], fulltext: true,
  });
  for (const condition of [messageTextCondition('"công nợ" thép', FULL), messageTextCondition('"a b c" d', FULL)]) {
    assert.ok(!String(condition?.params[0]).includes('"'), "không còn cụm trong ngoặc kép nào lọt vào MATCH");
  }
});

test("messageTextCondition: MySQL mặc định (min token 3) → từ ngắn đi LIKE (đã thoát % _), phần còn lại vẫn dùng chỉ mục", () => {
  const condition = messageTextCondition("công nợ 5%", { enabled: true, minTokenSize: 3 });
  assert.deepEqual(condition, {
    sql: "MATCH(s.text) AGAINST(? IN BOOLEAN MODE) AND s.text LIKE ? AND s.text LIKE ?", params: ["+công", "%nợ%", "%5\\%%"], fulltext: true,
  });
  // Cụm có chữ ngắn: chữ đủ dài vẫn lọc bằng MATCH, cả cụm kiểm bằng LIKE
  assert.deepEqual(messageTextCondition('"xe tải"', { enabled: true, minTokenSize: 3 }), {
    sql: "MATCH(s.text) AGAINST(? IN BOOLEAN MODE) AND s.text LIKE ?", params: ["+tải", "%xe tải%"], fulltext: true,
  });
  // Toàn chữ ngắn → không dùng được chỉ mục, nơi gọi phải giới hạn khoảng ngày
  assert.equal(messageTextCondition("xe ô", { enabled: true, minTokenSize: 3 })?.fulltext, false);
});

// Đo 09/10/2026: trần bộ nhớ câu tìm để mặc định 2 GB thì một câu tìm từ phổ biến làm MySQL 768 MB hết RAM và bị giết
test("messageTextCondition: MySQL chưa an toàn cho toàn văn → chỉ LIKE (nơi gọi tự giới hạn khoảng ngày)", () => {
  assert.deepEqual(messageTextCondition("hàng lỗi", { enabled: false, minTokenSize: 1 }), {
    sql: "s.text LIKE ? AND s.text LIKE ?", params: ["%hàng%", "%lỗi%"], fulltext: false,
  });
  assert.deepEqual(likeOnlyCondition("hàng lỗi"), { sql: "s.text LIKE ? AND s.text LIKE ?", params: ["%hàng%", "%lỗi%"] });
});

test("vượt trần bộ nhớ toàn văn được nhận ra; cửa sổ quét LIKE mặc định 90 ngày, giữ «từ ngày» người tìm chọn", () => {
  assert.equal(isFulltextCacheLimitError({ errno: 188, code: "ER_FTS_EXCEED_RESULT_CACHE_LIMIT" }), true);
  assert.equal(isFulltextCacheLimitError({ code: "ER_FTS_EXCEED_RESULT_CACHE_LIMIT" }), true);
  assert.equal(isFulltextCacheLimitError(new Error("khác")), false);
  assert.equal(isFulltextCacheLimitError(null), false);
  const now = new Date("2026-10-09T00:00:00Z");
  assert.equal(likeWindowStart(undefined, now).toISOString(), "2026-07-11T00:00:00.000Z");
  const chosen = new Date("2026-01-01T00:00:00Z");
  assert.equal(likeWindowStart(chosen, now), chosen);
  // Chỉ có mốc «đến» (31/12/2025): 90 ngày tính lùi từ mốc đó, không phải từ hôm nay — không thì cửa sổ rỗng
  assert.equal(likeWindowStart(undefined, new Date("2025-12-31T00:00:00Z")).toISOString(), "2025-10-02T00:00:00.000Z");
});

test("buildSnippet: cắt quanh chỗ khớp đầu tiên, không phân biệt dấu / hoa thường, có «…» ở chỗ bị cắt", () => {
  const text = `${"x".repeat(200)} Khách Minh Phát còn NỢ 420 triệu ${"y".repeat(200)}`;
  const snippet = buildSnippet(text, "cong no 420", 30);
  assert.ok(snippet.startsWith("…") && snippet.endsWith("…"));
  assert.match(snippet, /NỢ 420 triệu/);
  assert.equal(buildSnippet("Tin ngắn", "không khớp"), "Tin ngắn");
  // Tin gõ «Unicode tổ hợp» (dấu tách rời) vẫn tìm đúng chỗ khớp
  assert.match(buildSnippet(`${"x ".repeat(100)}Công nợ tháng 9`.normalize("NFD"), "cong no", 5), /Công nợ/);
  // Ký tự nhiều byte (emoji, chữ ghép) không làm lệch vị trí
  assert.equal(buildSnippet("Gửi 😀 báo giá đại lý", "đại lý", 4), "…giá đại lý");
  // Từ khóa dài không bị cắt mất phần cuối
  assert.match(buildSnippet(`${"a ".repeat(100)}hợp đồng nguyên tắc ${"b ".repeat(100)}`, '"hợp đồng nguyên tắc"', 5), /hợp đồng nguyên tắc/);
});

// 09/10/2026: 100 nhóm cùng tìm từ phổ biến, mỗi câu toàn văn được dùng tới 32 MB → không giới hạn thì MySQL 768 MB hết RAM
test("ConcurrencyLimiter: không bao giờ quá max việc cùng lúc, đến trước làm trước, việc lỗi vẫn trả chỗ", async () => {
  const limiter = new ConcurrencyLimiter(3);
  let running = 0;
  let peak = 0;
  const order: number[] = [];
  const job = (id: number, fail = false) => limiter.run(async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    order.push(id);
    if (fail) throw new Error(`lỗi ${id}`);
    return id;
  });
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, id) => job(id, id % 7 === 0)));
  assert.equal(peak, 3);
  assert.equal(results.filter((result) => result.status === "rejected").length, 3);
  assert.deepEqual(order.slice(0, 3).sort(), [0, 1, 2]);
  assert.ok(order.indexOf(19) > order.indexOf(3), "việc đến sau không chen trước");
  assert.deepEqual(limiter.stats, { active: 0, waiting: 0 });
});
