import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageKind, SharedLinkKind } from "../constants.js";
import { MAX_LINKS_PER_MESSAGE, MAX_URL_CHARS, extractSharedLinks, findUrlCandidates, storeSharedLinks } from "./shared-links.js";

const fromText = (text: string) => extractSharedLinks({ text, kind: MessageKind.Text });

test("bóc nhiều link trong một tin chữ, đúng thứ tự, bỏ trùng trong tin", () => {
  const links = fromText("Anh xem https://degoholding.vn/bao-gia và http://example.com/a?b=1 nhé, lại https://degoholding.vn/bao-gia");
  assert.deepEqual(links.map((link) => link.url), ["https://degoholding.vn/bao-gia", "http://example.com/a?b=1"]);
  assert.deepEqual(links.map((link) => link.kind), [SharedLinkKind.Web, SharedLinkKind.Web]);
  assert.equal(links[0].host, "degoholding.vn");
  assert.equal(links[0].googleFileId, null);
  assert.equal(links[0].title, null);
});

test("phân loại link Google: Sheets / Docs / Slides / Drive tệp / Drive thư mục, kèm id tệp", () => {
  const cases: [string, SharedLinkKind, string | null][] = [
    ["https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp_q-rs/edit#gid=0", SharedLinkKind.GoogleSheets, "1AbCdEfGhIjKlMnOp_q-rs"],
    ["https://docs.google.com/document/d/1DocIdDocIdDocId/edit?usp=sharing", SharedLinkKind.GoogleDocs, "1DocIdDocIdDocId"],
    ["https://docs.google.com/presentation/d/1SlideIdSlideId/view", SharedLinkKind.GoogleSlides, "1SlideIdSlideId"],
    ["https://docs.google.com/spreadsheets/u/1/d/1SecondAccountSheet/edit", SharedLinkKind.GoogleSheets, "1SecondAccountSheet"],
    ["https://docs.google.com/spreadsheets/d/e/2PACX-1vPublishedSheetId/pubhtml", SharedLinkKind.GoogleSheets, "2PACX-1vPublishedSheetId"],
    ["https://drive.google.com/file/d/1FileIdFileIdFile/view?usp=drive_link", SharedLinkKind.GoogleDriveFile, "1FileIdFileIdFile"],
    ["https://drive.google.com/open?id=1OldStyleIdOldStyle", SharedLinkKind.GoogleDriveFile, "1OldStyleIdOldStyle"],
    ["https://drive.google.com/drive/folders/1FolderIdFolderId?usp=sharing", SharedLinkKind.GoogleDriveFolder, "1FolderIdFolderId"],
    ["https://drive.google.com/drive/u/0/folders/1FolderIdUser0Abc", SharedLinkKind.GoogleDriveFolder, "1FolderIdUser0Abc"],
    // Google khác (Forms, trang chủ Drive) = web khác; máy giả mạo không được coi là Google
    ["https://docs.google.com/forms/d/e/1FAIpQLSformId/viewform", SharedLinkKind.Web, null],
    ["https://drive.google.com/drive/my-drive", SharedLinkKind.Web, null],
    ["https://docs.google.com.evil.io/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit", SharedLinkKind.Web, null],
    ["https://evildocs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit", SharedLinkKind.Web, null],
  ];
  for (const [url, kind, id] of cases) {
    const [link] = fromText(`link: ${url}`);
    assert.equal(link?.kind, kind, url);
    assert.equal(link?.googleFileId, id, url);
  }
});

test("cắt ký tự cuối câu, ngoặc thừa, nháy cong; giữ ngoặc cân trong link", () => {
  assert.deepEqual(findUrlCandidates("Xem https://a.vn/x. Rồi (https://b.vn/y), và https://c.vn/z!!! hoặc “https://d.vn/q”…"),
    ["https://a.vn/x", "https://b.vn/y", "https://c.vn/z", "https://d.vn/q"]);
  assert.deepEqual(findUrlCandidates("https://vi.wikipedia.org/wiki/Cà_phê_(định_hướng)"), ["https://vi.wikipedia.org/wiki/Cà_phê_(định_hướng)"]);
  assert.deepEqual(findUrlCandidates("<https://e.vn/a>, 'https://f.vn/b'; https://g.vn/c?x=1&y=2:"), ["https://e.vn/a", "https://f.vn/b", "https://g.vn/c?x=1&y=2"]);
  // Chữ tiếng Việt trong đường dẫn: lưu bản chuẩn hóa (mã hóa %), tên miền chữ thường
  const [link] = fromText("https://Example.COM/Cà_phê");
  assert.equal(link.url, "https://example.com/C%C3%A0_ph%C3%AA");
  assert.equal(link.host, "example.com");
});

test("bỏ thứ không phải link http(s) và link hỏng; tin rỗng / không chữ = không link", () => {
  assert.deepEqual(fromText("ftp://a.vn/x mailto:a@b.vn javascript:alert(1) https:// http://"), []);
  assert.deepEqual(fromText(""), []);
  assert.deepEqual(extractSharedLinks({ text: null, kind: MessageKind.Image }), []);
  assert.deepEqual(fromText("ghé degoholding.vn nhé"), []);
});

test("trần độ dài URL và số link một tin", () => {
  const [long] = fromText(`https://a.vn/${"x".repeat(3000)}`);
  assert.equal(long.url.length, MAX_URL_CHARS);
  const many = Array.from({ length: MAX_LINKS_PER_MESSAGE + 10 }, (_, index) => `https://a.vn/${index}`).join(" ");
  assert.equal(fromText(many).length, MAX_LINKS_PER_MESSAGE);
});

test("thẻ link Zalo: lấy href + tiêu đề thẻ; tin tệp có href (đường tải của Zalo) thì KHÔNG coi là link chia sẻ", () => {
  const card = extractSharedLinks({
    kind: MessageKind.Link,
    text: "Bảng giá tháng 10\nGoogle Sheets\nhttps://docs.google.com/spreadsheets/d/1CardSheetIdCard/edit",
    content: { title: "Bảng giá tháng 10", href: "https://docs.google.com/spreadsheets/d/1CardSheetIdCard/edit", params: "{}" },
  });
  assert.equal(card.length, 1);
  assert.equal(card[0].title, "Bảng giá tháng 10");
  assert.equal(card[0].kind, SharedLinkKind.GoogleSheets);
  // href để trong params (chuỗi JSON lồng) cũng nhận
  const nested = extractSharedLinks({ kind: MessageKind.Link, text: "", content: { title: "T", params: JSON.stringify({ href: "https://x.vn/p" }) } });
  assert.deepEqual(nested.map((link) => [link.url, link.title]), [["https://x.vn/p", "T"]]);
  const file = extractSharedLinks({ kind: MessageKind.File, text: "bao-gia.xlsx", content: { title: "bao-gia.xlsx", href: "https://f21-zpc.zdn.vn/abc/bao-gia.xlsx" } });
  assert.deepEqual(file, []);
});

test("storeSharedLinks: một câu INSERT IGNORE nhiều dòng, đủ cột; không link thì không gọi DB", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = { query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return [{ affectedRows: 2 }, []]; } } as never;
  const sentAt = new Date("2026-10-28T03:00:00Z");
  const base = { messageId: 7, groupId: 3, senderUid: "u1", senderName: "Lan", sentAt, kind: MessageKind.Text };
  assert.equal(await storeSharedLinks(db, { ...base, text: "không có link" }), 0);
  assert.equal(calls.length, 0);
  assert.equal(await storeSharedLinks(db, { ...base, text: "https://a.vn https://docs.google.com/document/d/1DocIdDocIdDocId/edit" }), 2);
  assert.match(calls[0].sql, /^INSERT IGNORE INTO shared_link/);
  assert.deepEqual(calls[0].params, [[
    [7, 3, "https://a.vn/", "a.vn", SharedLinkKind.Web, null, null, "u1", "Lan", sentAt],
    [7, 3, "https://docs.google.com/document/d/1DocIdDocIdDocId/edit", "docs.google.com", SharedLinkKind.GoogleDocs, "1DocIdDocIdDocId", null, "u1", "Lan", sentAt],
  ]]);
});
