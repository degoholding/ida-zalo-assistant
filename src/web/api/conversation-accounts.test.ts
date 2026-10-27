import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../../db/pool.js";
import { ACCOUNT_FILTER_FIELD, accountKindLabel, loadThreadAccounts, parseAccountIds, threadOfAccountsCondition } from "./conversation-accounts.js";
import { CONVERSATION_LIST_SPEC, WEB_CONVERSATION_LIST_SPEC } from "./conversations-api.js";
import { parseListRequest } from "./list-query.js";
import { requiredPermission } from "./route-permissions.js";

test("parseAccountIds: một id, nhiều id cách phẩy, bỏ rác / trùng / số âm", () => {
  assert.deepEqual(parseAccountIds(["3"]), [3]);
  assert.deepEqual(parseAccountIds(["3,5", "5"]), [3, 5]);
  assert.deepEqual(parseAccountIds(["x, -1, 0, 2.5, 7"]), [7]);
  assert.deepEqual(parseAccountIds([""]), []);
});

test("threadOfAccountsCondition: nhóm qua bot_group CÒN Ở, cuộc riêng qua owner_bot_id, tham số hóa", () => {
  assert.equal(threadOfAccountsCondition([]), null);
  const part = threadOfAccountsCondition([3, 5]);
  assert.ok(part);
  assert.match(part.sql, /g\.owner_bot_id IN \(\?\)/);
  assert.match(part.sql, /bga\.left_at IS NULL/);
  assert.match(part.sql, /bga\.bot_account_id IN \(\?\)/);
  assert.deepEqual(part.params, [[3, 5], [3, 5]]);
});

test("danh sách Hội thoại nhận account_id (một hoặc nhiều, kể cả dạng __in); giá trị rác thì bỏ qua lọc", () => {
  const one = parseListRequest(new URLSearchParams("account_id=3"), WEB_CONVERSATION_LIST_SPEC);
  assert.match(one.where.sql, /owner_bot_id IN/);
  assert.deepEqual(one.where.params, [[3], [3]]);

  const many = parseListRequest(new URLSearchParams("account_id__in=3,5"), WEB_CONVERSATION_LIST_SPEC);
  assert.deepEqual(many.where.params, [[3, 5], [3, 5]]);

  const bare = parseListRequest(new URLSearchParams("account_id=3,5"), WEB_CONVERSATION_LIST_SPEC);
  assert.deepEqual(bare.where.params, [[3, 5], [3, 5]], "dạng trần có dấu phẩy cũng nhận nhiều id");

  const excluded = ACCOUNT_FILTER_FIELD.build?.("not_in", ["3"]);
  assert.match(excluded?.sql ?? "", /^NOT \(/);

  assert.equal(parseListRequest(new URLSearchParams("account_id=abc"), WEB_CONVERSATION_LIST_SPEC).where.sql, "");
});

test("loadThreadAccounts: MỘT truy vấn cho cả trang, gom theo cuộc, bỏ trùng, ghi loại Trợ lý / Chỉ thu thập", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return [[
        { thread_id: 10, id: 1, name: "Lạc Lạc", kind: 0 },
        { thread_id: 10, id: 2, name: "Bot kho", kind: 1 },
        { thread_id: 10, id: 2, name: "Bot kho", kind: 1 },
        { thread_id: 11, id: 2, name: "Bot kho", kind: 1 },
      ]];
    },
  } as unknown as Db;
  const map = await loadThreadAccounts(db, [10, 11, 12]);
  assert.equal(calls.length, 1, "không N+1");
  assert.deepEqual(calls[0].params, [[10, 11, 12], [10, 11, 12]]);
  assert.match(calls[0].sql, /UNION ALL/);
  assert.deepEqual(map.get(10), [
    { id: 1, name: "Lạc Lạc", kind: 0, kind_label: "Trợ lý" },
    { id: 2, name: "Bot kho", kind: 1, kind_label: "Chỉ thu thập" },
  ]);
  assert.deepEqual(map.get(11)?.map((account) => account.id), [2]);
  assert.equal(map.get(12), undefined);

  const empty = await loadThreadAccounts(db, []);
  assert.equal(empty.size, 0);
  assert.equal(calls.length, 1, "trang rỗng không hỏi CSDL");
});

test("spec chung (dùng cho MCP) KHÔNG có account_id — chỉ spec web có, khỏi lộ điều kiện chạm bot_account sang MCP", () => {
  assert.equal(CONVERSATION_LIST_SPEC.fields.account_id, undefined);
  assert.ok(WEB_CONVERSATION_LIST_SPEC.fields.account_id);
  assert.deepEqual(Object.keys(WEB_CONVERSATION_LIST_SPEC.sorts), Object.keys(CONVERSATION_LIST_SPEC.sorts));
});

test("accountKindLabel + quyền ô tra tài khoản bot = quyền xem hội thoại (nhân viên thấy ô lọc)", () => {
  assert.equal(accountKindLabel(0), "Trợ lý");
  assert.equal(accountKindLabel(1), "Chỉ thu thập");
  assert.deepEqual(requiredPermission("GET", "/api/lookups/bot-accounts"), { entity: "conversation", action: "read" });
});
