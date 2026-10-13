import assert from "node:assert/strict";
import { test } from "node:test";
import { ContactRole } from "../constants.js";
import { buildHelpText } from "./chat-commands.js";

test("«hướng dẫn» tin riêng: người có vai trò thấy gợi ý trả lời + số liệu; người lạ / trong nhóm thì không", () => {
  const asker = { role: ContactRole.Manager, recipientId: null } as unknown as Parameters<typeof buildHelpText>[0];
  const text = buildHelpText(asker, false);
  assert.match(text, /GỢI Ý TRẢ LỜI/);
  assert.match(text, /em KHÔNG gửi cho khách/);
  assert.match(text, /SỐ LIỆU/);
  assert.doesNotMatch(buildHelpText(null, false), /GỢI Ý TRẢ LỜI/);
  assert.doesNotMatch(buildHelpText(asker, true), /GỢI Ý TRẢ LỜI/);
});
