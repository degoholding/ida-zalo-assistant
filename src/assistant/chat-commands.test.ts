import assert from "node:assert/strict";
import { test } from "node:test";
import { ContactRole } from "../constants.js";
import { buildHelpText, parseChatCommand } from "./chat-commands.js";

test("help is recognised with or without diacritics, including the way people actually type it", () => {
  for (const text of ["hướng dẫn", "Hướng dẫn tôi", "huong dan", "HUONG DAN SU DUNG", "/help", "menu", "hướng dẫn cho em!", "trợ giúp?"]) {
    assert.deepEqual(parseChatCommand(text), { kind: "help" }, text);
  }
});

test("ordinary questions are not swallowed as commands", () => {
  for (const text of ["hướng dẫn anh cách xuất Excel báo cáo tuần", "tóm tắt nhóm Bán hàng hôm nay", "có gì mới không",
    "ok cảm ơn em", "thêm vip", "xong", "phút chờ bao nhiêu", "cấu hình máy chủ thế nào", ""]) {
    assert.equal(parseChatCommand(text), null, text);
  }
});

test("keyword commands keep the user's diacritics in the keyword even when matched without them", () => {
  assert.deepEqual(parseChatCommand("Thêm từ khẩn Bể Bao"), { kind: "keyword", add: true, level: "urgent", keyword: "bể bao" });
  assert.deepEqual(parseChatCommand("bo tu quan trong cong no"), { kind: "keyword", add: false, level: "important", keyword: "cong no" });
  assert.deepEqual(parseChatCommand("xóa từ khóa khẩn «giận»"), { kind: "keyword", add: false, level: "urgent", keyword: "giận" });
});

test("wait, VIP, done, confirm and cancel commands", () => {
  assert.deepEqual(parseChatCommand("phút chờ 90"), { kind: "wait_minutes", vip: false, minutes: 90 });
  assert.deepEqual(parseChatCommand("phut cho vip 20 phut"), { kind: "wait_minutes", vip: true, minutes: 20 });
  assert.deepEqual(parseChatCommand("thêm vip Đại lý Minh Phát"), { kind: "vip", add: true, name: "đại lý minh phát" });
  assert.deepEqual(parseChatCommand("xong #4512"), { kind: "mark_done", messageId: 4512 });
  assert.deepEqual(parseChatCommand("Xong tin số 7"), { kind: "mark_done", messageId: 7 });
  assert.deepEqual(parseChatCommand("Đồng ý"), { kind: "confirm" });
  assert.deepEqual(parseChatCommand("ok"), { kind: "confirm" });
  assert.deepEqual(parseChatCommand("hủy"), { kind: "cancel" });
  assert.deepEqual(parseChatCommand("cấu hình"), { kind: "show_config" });
  assert.deepEqual(parseChatCommand("có gì cần xử lý?"), { kind: "list_pending" });
});

test("text with emoji or other surrogate pairs keeps argument offsets aligned", () => {
  assert.deepEqual(parseChatCommand("thêm từ khẩn hàng 🔥 cháy"), { kind: "keyword", add: true, level: "urgent", keyword: "hàng 🔥 cháy" });
});

test("help lists only the commands the asker may use", () => {
  const staff = buildHelpText(null, false);
  assert.doesNotMatch(staff, /cần xử lý|từ khẩn/);
  const recipient = buildHelpText({ uid: "u", name: "A", role: ContactRole.None, recipientId: 3 }, false);
  assert.match(recipient, /thêm vip/);
  assert.doesNotMatch(recipient, /từ khẩn/);
  const manager = buildHelpText({ uid: "u", name: "A", role: ContactRole.Manager, recipientId: null }, false);
  assert.match(manager, /thêm từ khẩn/);
  assert.doesNotMatch(manager, /thêm vip/);
  assert.match(buildHelpText(null, true), /TRONG NHÓM/);
});
