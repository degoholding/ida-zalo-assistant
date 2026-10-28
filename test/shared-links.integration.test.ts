// Phase 13.2 — link chia sẻ trên MySQL THẬT: bóc link lúc ghi tin (tin trùng giữa hai tài khoản chỉ một lần), thu hồi bỏ link,
// lệnh nạp lại tin cũ chạy lại không trùng, entity MCP `links` đúng phạm vi + chặn nhóm Mật + lọc account_id / kind / host, API web.
// Dữ liệu có tiền tố `sl-it-` và tự dọn.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { MessageKind, SharedLinkKind } from "../src/constants.js";
import { admin, makeCtx, staff } from "../src/data-access/data-access-test-support.js";
import { findTool } from "../src/data-access/read-tool-catalog.js";
import { runTool } from "../src/data-access/tool-runner.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { ingestGroupMessage, recallGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";
import { backfillSharedLinks } from "../src/sync/shared-links.js";
import { listSharedLinks } from "../src/web/api/shared-links-api.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const PREFIX = "sl-it-";
const SHEET = "https://docs.google.com/spreadsheets/d/1SlItSheetIdAbc/edit#gid=0";
const DOC = "https://docs.google.com/document/d/1SlItDocIdAbcdef/edit";
const SECRET = "https://drive.google.com/drive/folders/1SlItSecretFolder";

describe("link chia sẻ (MySQL)", { skip: databaseUrl ? false : "cần TEST_DATABASE_URL" }, () => {
  let db: Db;
  const bots: number[] = [];
  const groups: Record<string, number> = {};

  const incoming = (zaloGroupId: string, msgId: string, content: unknown, overrides: Partial<IncomingGroupMessage> = {}): IncomingGroupMessage => ({
    zaloGroupId: `${PREFIX}${zaloGroupId}`, msgId: `${PREFIX}${msgId}`, cliMsgId: "", msgType: "webchat", senderUid: `${PREFIX}u1`, senderName: "Lan",
    sentAtMs: Date.parse("2026-10-27T03:00:00Z"), content, quote: null, mentions: null, ...overrides,
  });
  const deps = () => ({ db, defaults: { readMessages: true, captureFiles: false } });

  async function cleanup(): Promise<void> {
    await db.query("DELETE FROM zalo_group WHERE zalo_group_id LIKE ?", [`${PREFIX}%`]);
    await db.query("DELETE FROM contact WHERE zalo_uid LIKE ?", [`${PREFIX}%`]);
    await db.query("DELETE FROM bot_group WHERE bot_account_id IN (SELECT id FROM bot_account WHERE label LIKE ?)", [`${PREFIX}%`]);
    await db.query("DELETE FROM bot_account WHERE label LIKE ?", [`${PREFIX}%`]);
  }

  async function groupId(zaloGroupId: string): Promise<number> {
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM zalo_group WHERE zalo_group_id = ?", [`${PREFIX}${zaloGroupId}`]);
    return Number(rows[0].id);
  }

  async function linksOf(group: number): Promise<RowDataPacket[]> {
    const [rows] = await db.query<RowDataPacket[]>("SELECT url, host, kind, google_file_id, title, sender_name FROM shared_link WHERE group_id = ? ORDER BY id", [group]);
    return rows;
  }

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    await cleanup();
    for (const label of ["a", "b"]) {
      const [result] = await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES (?, ?, 'x')", [`${PREFIX}${label}`, `${PREFIX}bot-${label}`]);
      bots.push(result.insertId as number);
    }
    // Nhóm "kd": cả hai tài khoản cùng ở; "mat": nhóm Mật (chỉ tài khoản b)
    assert.equal(await ingestGroupMessage(deps(), bots[0], incoming("kd", "m1", `Bảng giá ${SHEET}. Chi tiết: ${DOC}, xem thêm (https://degoholding.vn/tin-tuc)!`)), "stored");
    assert.equal(await ingestGroupMessage(deps(), bots[1], incoming("kd", "m1", `Bảng giá ${SHEET}. Chi tiết: ${DOC}, xem thêm (https://degoholding.vn/tin-tuc)!`)), "duplicate");
    await db.query("INSERT IGNORE INTO bot_group (bot_account_id, group_id) VALUES (?, ?)", [bots[1], await groupId("kd")]);
    await ingestGroupMessage(deps(), bots[1], incoming("mat", "m2", `Thư mục mật ${SECRET}`));
    await db.query("UPDATE zalo_group SET is_confidential = 1 WHERE zalo_group_id = ?", [`${PREFIX}mat`]);
    // Thẻ link của Zalo: tiêu đề thẻ ghi vào title
    await ingestGroupMessage(deps(), bots[0], incoming("kd", "m3", { title: "Kế hoạch tuần", href: "https://docs.google.com/presentation/d/1SlItSlidesIdAb/edit", params: "{}" },
      { msgType: "chat.link", senderUid: `${PREFIX}u2`, senderName: "Minh" }));
    groups.kd = await groupId("kd");
    await db.query("UPDATE zalo_group SET name = 'Kinh doanh' WHERE id = ?", [groups.kd]);
    groups.mat = await groupId("mat");
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.end();
    }
  });

  test("ghi tin = bóc link (đúng loại, id Google, cắt dấu câu); tin trùng giữa hai tài khoản chỉ lưu MỘT lần", async () => {
    const rows = await linksOf(groups.kd);
    assert.deepEqual(rows.map((row) => [row.url, Number(row.kind), row.google_file_id]), [
      [SHEET, SharedLinkKind.GoogleSheets, "1SlItSheetIdAbc"],
      [DOC, SharedLinkKind.GoogleDocs, "1SlItDocIdAbcdef"],
      ["https://degoholding.vn/tin-tuc", SharedLinkKind.Web, null],
      ["https://docs.google.com/presentation/d/1SlItSlidesIdAb/edit", SharedLinkKind.GoogleSlides, "1SlItSlidesIdAb"],
    ]);
    assert.equal(rows[3].title, "Kế hoạch tuần");
    assert.equal(rows[3].sender_name, "Minh");
  });

  test("lệnh nạp lại cho tin cũ: bóc tin chưa có link, chạy lại không sinh trùng, bỏ tin đã thu hồi", async () => {
    const insert = async (key: string, text: string, recalled = false) => {
      await db.query(
        "INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text, recalled_at) VALUES (?, ?, ?, ?, 'Cũ', '2026-09-01 08:00:00', ?, ?)",
        [groups.kd, `${PREFIX}${key}`, MessageKind.Text, `${PREFIX}u3`, text, recalled ? "2026-09-01 09:00:00" : null]);
    };
    await insert("old1", "link cũ https://example.com/a?x=1 và https://example.com/b");
    await insert("old2", "đã thu hồi https://example.com/recalled", true);
    const before = (await linksOf(groups.kd)).length;
    const first = await backfillSharedLinks(db, { batchSize: 2 });
    assert.ok(first.inserted >= 2, JSON.stringify(first));
    const afterFirst = await linksOf(groups.kd);
    assert.equal(afterFirst.length, before + 2);
    assert.ok(!afterFirst.some((row) => row.url === "https://example.com/recalled"));
    const second = await backfillSharedLinks(db, { batchSize: 2 });
    assert.equal(second.inserted, 0);
    assert.equal((await linksOf(groups.kd)).length, before + 2);
  });

  test("thu hồi tin = bỏ link của tin đó", async () => {
    await ingestGroupMessage(deps(), bots[0], incoming("kd", "m9", "lỡ gửi https://example.com/nham"));
    assert.ok((await linksOf(groups.kd)).some((row) => row.url === "https://example.com/nham"));
    assert.equal(await recallGroupMessage(db, `${PREFIX}kd`, `${PREFIX}m9`), true);
    assert.ok(!(await linksOf(groups.kd)).some((row) => row.url === "https://example.com/nham"));
  });

  const query = (ctx: ReturnType<typeof makeCtx>, input: Record<string, unknown> = {}) =>
    runTool(findTool("query_records")!, ctx, { entity: "links", fields: ["url", "kind", "host", "thread_id", "title"], page: { size: 100 }, ...input });
  const urls = (result: Awaited<ReturnType<typeof query>>) => {
    assert.equal(result.isError, false, result.text);
    return (result.structured as { items: { url: string; thread_id: number }[] }).items.filter((item) => item.url.includes("SlIt") || item.url.includes("degoholding")).map((item) => item.url);
  };

  test("MCP links: nhóm Mật bị chặn khi không có cờ, thấy khi có cờ; url / title là dữ liệu không đáng tin", async () => {
    const noMat = await query(makeCtx(admin(), {}, db));
    assert.ok(!urls(noMat).includes(SECRET));
    assert.ok(urls(noMat).includes(SHEET));
    assert.ok((noMat.structured as { untrusted_fields: string[] }).untrusted_fields.includes("url"));
    assert.ok((noMat.structured as { untrusted_fields: string[] }).untrusted_fields.includes("title"));
    assert.ok(urls(await query(makeCtx(admin({ canViewConfidential: true }), {}, db))).includes(SECRET));
  });

  test("MCP links: người bị khoanh nhóm chỉ thấy nhóm của mình; lọc kind / host / account_id / group_id", async () => {
    assert.deepEqual(urls(await query(makeCtx(staff({ groupIds: [groups.mat], canViewConfidential: true }), {}, db))), [SECRET]);
    assert.deepEqual(urls(await query(makeCtx(staff({ groupIds: [groups.mat] }), {}, db))), []);
    const ctx = makeCtx(admin({ canViewConfidential: true }), {}, db);
    assert.deepEqual(urls(await query(ctx, { filters: [{ field: "kind", op: "eq", value: SharedLinkKind.GoogleSheets }] })), [SHEET]);
    assert.deepEqual(urls(await query(ctx, { filters: [{ field: "host", op: "eq", value: "degoholding.vn" }] })), ["https://degoholding.vn/tin-tuc"]);
    // Tài khoản a chỉ ở nhóm kd; tài khoản b ở cả kd lẫn mat
    assert.ok(!urls(await query(ctx, { filters: [{ field: "account_id", op: "eq", value: bots[0] }] })).includes(SECRET));
    assert.ok(urls(await query(ctx, { filters: [{ field: "account_id", op: "eq", value: bots[1] }] })).includes(SECRET));
    assert.deepEqual(urls(await query(ctx, { filters: [{ field: "group_id", op: "eq", value: groups.mat }] })), [SECRET]);
  });

  test("API web /api/files/links: phạm vi nhóm của người xem, lọc loại, tìm theo url / người gửi", async () => {
    const list = async (params: Record<string, string>, groupIds: number[] | null = null) => {
      const result = await listSharedLinks(db, new URLSearchParams({ page_size: "100", ...params }), staff({ groupIds }));
      return (result.items as { url: string; thread_name: string; kind: number }[]).filter((item) => item.url.includes("SlIt") || item.url.includes("degoholding"));
    };
    const all = await list({});
    assert.ok(all.some((item) => item.url === SECRET));
    assert.deepEqual((await list({}, [groups.kd])).map((item) => item.url).sort(), [DOC, SHEET, "https://degoholding.vn/tin-tuc", "https://docs.google.com/presentation/d/1SlItSlidesIdAb/edit"].sort());
    assert.deepEqual((await list({ kind: String(SharedLinkKind.GoogleDocs) })).map((item) => item.url), [DOC]);
    assert.deepEqual((await list({ q: "Minh" })).map((item) => item.url), ["https://docs.google.com/presentation/d/1SlItSlidesIdAb/edit"]);
    assert.equal(all.find((item) => item.url === SHEET)?.thread_name, "Kinh doanh");
  });
});
