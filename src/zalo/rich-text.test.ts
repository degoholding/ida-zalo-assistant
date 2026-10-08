import assert from "node:assert/strict";
import { test } from "node:test";
import { TextStyle } from "zca-js";
import { toStyledContent, toStyledText } from "./rich-text.js";

test("quoted parts become bold and the guillemets are removed, positions counted on the cleaned text", () => {
  const { msg, styles } = toStyledText("Nhắn «T-1» để xem, «T-1: <nội dung>» để bổ sung.");
  assert.equal(msg, "Nhắn T-1 để xem, T-1: <nội dung> để bổ sung.");
  assert.deepEqual(styles, [
    { start: 5, len: 3, st: TextStyle.Bold },
    { start: 17, len: 15, st: TextStyle.Bold },
  ]);
  assert.equal(msg.slice(17, 32), "T-1: <nội dung>");
});

test("unpaired, empty or line-crossing guillemets are left alone; plain text has no styles", () => {
  assert.deepEqual(toStyledText("chỉ có « một nửa"), { msg: "chỉ có « một nửa", styles: [] });
  assert.deepEqual(toStyledText("«»"), { msg: "«»", styles: [] });
  assert.equal(toStyledText("«dòng\nmới»").msg, "«dòng\nmới»");
  assert.deepEqual(toStyledContent("không có gì"), { msg: "không có gì" });
});
