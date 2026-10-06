import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMentions } from "./group-mentions.js";

const MEMBERS = [
  { uid: "1", name: "Gia Bảo" },
  { uid: "2", name: "Gia Bảo Nguyễn" },
  { uid: "3", name: "An" },
];

test("gắn thẻ tên khớp, tên dài khớp trước", () => {
  const text = "Phân công:\n- @Gia Bảo Nguyễn: chốt giá\n- @gia bảo: gửi báo giá";
  assert.deepEqual(buildMentions(text, MEMBERS), [
    { pos: text.indexOf("@Gia Bảo Nguyễn"), uid: "2", len: "@Gia Bảo Nguyễn".length },
    { pos: text.indexOf("@gia bảo"), uid: "1", len: "@gia bảo".length },
  ]);
});

test("không gắn khi tên chỉ là phần đầu của chữ khác", () => {
  assert.deepEqual(buildMentions("@Anh Tuấn làm việc này", MEMBERS), []);
  assert.deepEqual(buildMentions("nhờ @An.", MEMBERS), [{ pos: 4, uid: "3", len: 3 }]);
});

test("không có @ thì không gắn", () => {
  assert.deepEqual(buildMentions("Gia Bảo gửi báo giá", MEMBERS), []);
});
