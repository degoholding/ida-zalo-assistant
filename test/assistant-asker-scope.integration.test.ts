// Phase 6 — trợ lý trong app: người hỏi → phạm vi (H1 rò tệp / cuộc riêng của người khác) + nhóm Mật theo cờ, trên MySQL THẬT.
// Công cụ chạy qua `runTool` với ngữ cảnh do `resolveAskerAccess` dựng thật (không giả quyền).
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { mayAskInConfidentialGroup, resolveAskerAccess } from "../src/assistant/infra/asker-access.js";
import { runTool, type ToolContext } from "../src/assistant/tools.js";
import { AttachmentStatus, ContactRole, UserRole } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { ensureGroup, updateGroupSettings } from "../src/sync/group-repository.js";
import { ingestDirectMessage, ingestGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";
import type { ReadFileResult } from "../src/assistant/file-reader.js";
import { askerWithAccess } from "./assistant-access-test-support.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["assistant_turn", "attachment_text", "attachment", "message_search", "message", "group_member", "bot_group", "zalo_group", "contact",
  "company", "session_event", "bot_account", "user_group_scope", "app_user", "recipient_group", "recipient"];
const NOW = new Date("2026-10-01T05:00:00Z");
const WINDOW = { from: "2026-10-01T00:00:00+07:00", to: "2026-10-02T00:00:00+07:00" };
const SECRET_LINK = "https://docs.google.com/spreadsheets/d/SECRETSHEETID123/edit";

function incoming(overrides: Partial<IncomingGroupMessage>): IncomingGroupMessage {
  return { zaloGroupId: "g-1", msgId: "1", cliMsgId: "", msgType: "webchat", senderUid: "u-x", senderName: "X", sentAtMs: NOW.getTime() - 3_600_000,
    content: "", quote: null, mentions: null, ...overrides };
}

describe("trợ lý: phạm vi theo người hỏi + nhóm Mật theo cờ", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let botId: number;
  const ids: Record<string, number> = {};
  const readCalls: number[] = [];

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => {
    await db?.end();
  });

  async function attach(text: string, groupId: number, name: string): Promise<number> {
    const [msg] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE text = ?", [text]);
    const [result] = await db.query<any>(
      "INSERT INTO attachment (message_id, group_id, file_name, file_ext, source_url, storage_key, status) VALUES (?, ?, ?, 'xlsx', 'https://f', ?, ?)",
      [msg[0].id, groupId, name, `k/${name}`, AttachmentStatus.Stored]);
    return result.insertId as number;
  }

  /** Tài khoản web gắn với liên hệ `uid`; `groups` rỗng + allGroups = thấy mọi nhóm. */
  async function webUser(uid: string, options: { groups?: number[]; allGroups?: boolean; confidential?: boolean; active?: boolean }): Promise<void> {
    await db.query("INSERT IGNORE INTO contact (zalo_uid, display_name) VALUES (?, ?)", [uid, uid]);
    const [contact] = await db.query<RowDataPacket[]>("SELECT id FROM contact WHERE zalo_uid = ?", [uid]);
    const [result] = await db.query<any>(
      "INSERT INTO app_user (email, username, full_name, role, contact_id, all_groups, can_view_confidential, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [`${uid}@ida.vn`, uid, uid, UserRole.Manager, contact[0].id, options.allGroups ? 1 : 0, options.confidential ? 1 : 0, options.active === false ? 0 : 1]);
    for (const groupId of options.groups ?? []) await db.query("INSERT INTO user_group_scope (user_id, group_id) VALUES (?, ?)", [result.insertId, groupId]);
  }

  async function ask(uid: string, groupScopeId?: number): Promise<ToolContext> {
    await db.query("INSERT IGNORE INTO contact (zalo_uid, display_name) VALUES (?, ?)", [uid, uid]);
    const contact = (await findContactByUid(db, uid))!;
    if (contact.role === ContactRole.None && !(await hasRecipient(contact.id))) await db.query("UPDATE contact SET role = ? WHERE id = ?", [ContactRole.Manager, contact.id]);
    const fresh = (await findContactByUid(db, uid))!;
    const access = await resolveAskerAccess(db, fresh, { groupScopeId, maskPersonal: false, now: NOW });
    return {
      db, askerUid: uid, access, filesToSend: [], now: NOW, scopeGroupId: groupScopeId,
      readFile: async (id): Promise<ReadFileResult | { error: string }> => {
        readCalls.push(id);
        return { fileName: "f", method: "xlsx", summary: "", charCount: 3, text: "ABC", inputTokens: 0, outputTokens: 0 } as ReadFileResult;
      },
      readLink: async () => ({ how: "web", text: "NỘI DUNG LINK", inputTokens: 0, outputTokens: 0 }) as any,
    };
  }
  const hasRecipient = async (contactId: number) => {
    const [rows] = await db.query<RowDataPacket[]>("SELECT 1 FROM recipient WHERE contact_id = ?", [contactId]);
    return rows.length > 0;
  };

  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    readCalls.length = 0;
    const [bot] = await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    botId = bot.insertId;
    const deps = { db, defaults: { readMessages: true, captureFiles: true } };
    for (const [key, zaloId] of [["g1", "g-1"], ["g2", "g-2"], ["gm", "g-mat"]] as const) {
      const { group } = await ensureGroup(db, zaloId, { readMessages: true, captureFiles: true });
      ids[key] = group.id;
      await db.query("UPDATE zalo_group SET name = ? WHERE id = ?", [`Nhóm ${key}`, group.id]);
    }
    await updateGroupSettings(db, ids.gm, { isConfidential: true });
    await ingestGroupMessage(deps, botId, incoming({ zaloGroupId: "g-1", msgId: "a", content: "tin nhóm một" }));
    await ingestGroupMessage(deps, botId, incoming({ zaloGroupId: "g-2", msgId: "b", content: "tin nhóm hai" }));
    await ingestGroupMessage(deps, botId, incoming({ zaloGroupId: "g-mat", msgId: "c", content: "tin mật cực kỳ" }));
    await ingestGroupMessage(deps, botId, incoming({ zaloGroupId: "g-mat", msgId: "d", content: `xem bảng ${SECRET_LINK}` }));
    const dmA = await ingestDirectMessage(deps, botId, incoming({ zaloGroupId: "u-a", senderUid: "u-a", senderName: "A", msgId: "da", content: "tin riêng của A" }));
    const dmB = await ingestDirectMessage(deps, botId, incoming({ zaloGroupId: "u-b", senderUid: "u-b", senderName: "B", msgId: "db", content: "tin riêng của B bí mật" }));
    ids.dmA = dmA.thread.id;
    ids.dmB = dmB.thread.id;
    ids.fileA = await attach("tin riêng của A", ids.dmA, "bao cao A.xlsx");
    ids.fileB = await attach("tin riêng của B bí mật", ids.dmB, "bao cao B.xlsx");
    ids.fileG1 = await attach("tin nhóm một", ids.g1, "ke hoach G1.xlsx");
    ids.fileG2 = await attach("tin nhóm hai", ids.g2, "ke hoach G2.xlsx");
    ids.fileM = await attach("tin mật cực kỳ", ids.gm, "luong mat.xlsx");
  });

  test("H1: không đọc / gửi / liệt kê tệp ở cuộc riêng của người khác, vẫn thấy tệp của chính mình", async () => {
    const asker = await ask("u-a");
    const stolen = await runTool(asker, "read_file", { attachment_id: ids.fileB }) as any;
    assert.match(stolen.error, /Không có tệp này/);
    const sent = await runTool(asker, "send_file", { attachment_id: ids.fileB }) as any;
    assert.match(sent.error, /Không có tệp này/);
    assert.deepEqual(asker.filesToSend, []);
    assert.deepEqual(readCalls, []);

    const listed = await runTool(asker, "search_files", { query: "bao cao" }) as any;
    assert.deepEqual(listed.files.map((f: { id: number }) => f.id), [ids.fileA]);
    const recent = await runTool(asker, "search_files", { query: "" }) as any;
    assert.ok(!recent.files.some((f: { id: number }) => f.id === ids.fileB));

    assert.equal(((await runTool(asker, "read_file", { attachment_id: ids.fileA }) as any).content), "ABC");
    assert.equal(((await runTool(asker, "send_file", { attachment_id: ids.fileA }) as any).queued), true);
  });

  test("H1: đoán id tệp liên tiếp (prompt injection) chỉ lấy được tệp trong phạm vi", async () => {
    const asker = await ask("u-a");
    const reached: number[] = [];
    for (let id = 1; id <= 50; id += 1) {
      const result = await runTool(asker, "send_file", { attachment_id: id }) as any;
      if (result.queued) reached.push(id);
    }
    // u-a là người có vai trò (đọc mọi nhóm đang bật) nhưng KHÔNG có cuộc riêng của B và KHÔNG có nhóm Mật
    assert.deepEqual(reached.sort((x, y) => x - y), [ids.fileA, ids.fileG1, ids.fileG2].sort((x, y) => x - y));
  });

  test("H1: cuộc riêng của người khác không lộ qua get_conversation_with_person / tìm tin / đọc cuộc theo id", async () => {
    const asker = await ask("u-a");
    const talk = await runTool(asker, "get_conversation_with_person", { person_uid: "u-b", ...WINDOW }) as any;
    assert.doesNotMatch(talk.messages, /bí mật/);
    const byId = await runTool(asker, "get_group_messages", { group_id: ids.dmB, ...WINDOW }) as any;
    assert.match(byId.error, /Không có nhóm/);
    const found = await runTool(asker, "search_messages", { query: "bí mật" }) as any;
    assert.equal(found.count, 0);
    const mine = await ask("u-b");
    assert.equal(((await runTool(mine, "search_messages", { query: "bí mật" }) as any).count), 1);
    const own = await runTool(mine, "get_conversation_with_person", { person_uid: "u-b", ...WINDOW }) as any;
    assert.match(own.messages, /tin riêng của B bí mật/);
  });

  test("người có tài khoản bị khoanh nhóm: chỉ thấy nhóm được gán + cuộc riêng của mình", async () => {
    await webUser("u-w", { groups: [ids.g1] });
    await ingestDirectMessage({ db, defaults: { readMessages: true, captureFiles: true } }, botId,
      incoming({ zaloGroupId: "u-w", senderUid: "u-w", senderName: "W", msgId: "dw", content: "tin riêng của W" }));
    const asker = await ask("u-w");
    assert.equal(asker.access.origin, "web_user");
    const groups = await runTool(asker, "list_groups", {}) as any;
    assert.deepEqual(groups.groups.map((g: { id: number }) => g.id), [ids.g1]);
    assert.match(((await runTool(asker, "get_group_messages", { group_id: ids.g2, ...WINDOW }) as any).error), /Không có nhóm/);
    assert.match(((await runTool(asker, "read_file", { attachment_id: ids.fileG2 }) as any).error), /Không có tệp này/);
    assert.equal(((await runTool(asker, "read_file", { attachment_id: ids.fileG1 }) as any).content), "ABC");
    assert.equal(((await runTool(asker, "search_messages", { query: "nhóm hai" }) as any).count), 0);
    assert.equal(((await runTool(asker, "search_messages", { query: "nhóm một" }) as any).count), 1);
    assert.equal(((await runTool(asker, "search_messages", { query: "riêng của W" }) as any).count), 1);
    assert.equal(((await runTool(asker, "search_messages", { query: "riêng của A" }) as any).count), 0);
  });

  test("nhóm Mật: người không có cờ bị chặn ở mọi công cụ đọc (kể cả khi đoán id)", async () => {
    const asker = await ask("u-a");
    assert.ok(!((await runTool(asker, "list_groups", {}) as any).groups.some((g: { id: number }) => g.id === ids.gm)));
    assert.match(((await runTool(asker, "get_group_messages", { group_id: ids.gm, ...WINDOW }) as any).error), /Mật/);
    assert.match(((await runTool(asker, "read_file", { attachment_id: ids.fileM }) as any).error), /Mật/);
    assert.match(((await runTool(asker, "send_file", { attachment_id: ids.fileM }) as any).error), /Mật/);
    assert.equal(((await runTool(asker, "search_files", { query: "luong" }) as any).files.length), 0);
    assert.equal(((await runTool(asker, "search_messages", { query: "mật cực kỳ" }) as any).count), 0);
    assert.match(((await runTool(asker, "read_link", { url: SECRET_LINK }) as any).error), /không có trong tin nhắn/);
    assert.deepEqual(readCalls, []);
  });

  test("nhóm Mật: người có tài khoản + cờ đọc bình thường; có tài khoản nhưng thiếu cờ thì vẫn chặn", async () => {
    await webUser("u-flag", { allGroups: true, confidential: true });
    await webUser("u-noflag", { allGroups: true, confidential: false });
    const flagged = await ask("u-flag");
    assert.ok((await runTool(flagged, "list_groups", {}) as any).groups.some((g: { id: number }) => g.id === ids.gm));
    assert.match(((await runTool(flagged, "get_group_messages", { group_id: ids.gm, ...WINDOW }) as any).messages), /tin mật cực kỳ/);
    assert.equal(((await runTool(flagged, "read_file", { attachment_id: ids.fileM }) as any).content), "ABC");
    assert.equal(((await runTool(flagged, "search_files", { query: "luong" }) as any).files.length), 1);
    assert.equal(((await runTool(flagged, "search_messages", { query: "mật cực kỳ" }) as any).count), 1);
    assert.equal(((await runTool(flagged, "read_link", { url: SECRET_LINK }) as any).content), "NỘI DUNG LINK");
    // Người cờ bật vẫn KHÔNG đọc cuộc riêng của người khác (câu bot trả lời Mật nằm trong cuộc riêng)
    assert.match(((await runTool(flagged, "read_file", { attachment_id: ids.fileB }) as any).error), /Không có tệp này/);

    const unflagged = await ask("u-noflag");
    assert.match(((await runTool(unflagged, "get_group_messages", { group_id: ids.gm, ...WINDOW }) as any).error), /Mật/);
  });

  test("người có cờ nhưng bị khoanh nhóm khác: nhóm Mật ngoài phạm vi trả như không có (không lộ tồn tại)", async () => {
    await webUser("u-scoped", { groups: [ids.g1], confidential: true });
    const asker = await ask("u-scoped");
    assert.match(((await runTool(asker, "get_group_messages", { group_id: ids.gm, ...WINDOW }) as any).error), /Không có nhóm/);
    assert.match(((await runTool(asker, "read_file", { attachment_id: ids.fileM }) as any).error), /Không có tệp này/);
  });

  test("hỏi trong nhóm Mật: chỉ người có tài khoản + cờ được trả lời; nhóm khác không lẫn vào", async () => {
    await webUser("u-flag", { allGroups: true, confidential: true });
    await webUser("u-noflag", { allGroups: true });
    const asked = async (uid: string) => (await findContactByUid(db, uid))!;
    assert.equal(await mayAskInConfidentialGroup(db, await asked("u-flag"), ids.gm), true);
    assert.equal(await mayAskInConfidentialGroup(db, await asked("u-noflag"), ids.gm), false);
    await db.query("INSERT IGNORE INTO contact (zalo_uid, display_name, role) VALUES ('u-role', 'R', ?)", [ContactRole.Manager]);
    assert.equal(await mayAskInConfidentialGroup(db, await asked("u-role"), ids.gm), false);

    const inGroup = await ask("u-flag", ids.gm);
    assert.match(((await runTool(inGroup, "get_group_messages", {}) as any).messages), /tin mật cực kỳ/);
    assert.match(((await runTool(inGroup, "read_file", { attachment_id: ids.fileG1 }) as any).error), /Không có tệp này/);
    assert.match(((await runTool(inGroup, "send_file", { attachment_id: ids.fileM }) as any).error), /chỉ dùng được dữ liệu của nhóm/);
  });

  test("tài khoản bị tắt: KHÔNG rơi về vai trò Danh bạ — không nhóm, không Mật, chỉ cuộc riêng của mình", async () => {
    await webUser("u-off", { allGroups: true, confidential: true, active: false });
    const asker = await ask("u-off");
    assert.equal(asker.access.origin, "disabled_account");
    assert.equal(asker.access.includeConfidential, false);
    assert.match(((await runTool(asker, "get_group_messages", { group_id: ids.gm, ...WINDOW }) as any).error), /Không có nhóm này/);
    assert.match(((await runTool(asker, "get_group_messages", { group_id: ids.g1, ...WINDOW }) as any).error), /Không có nhóm này/);
  });

  test("người nhận không vai trò, không tài khoản: phạm vi theo recipient_group", async () => {
    await db.query("INSERT INTO contact (zalo_uid, display_name) VALUES ('u-rcp', 'Người nhận')");
    const contact = (await findContactByUid(db, "u-rcp"))!;
    const [rcp] = await db.query<any>("INSERT INTO recipient (contact_id, name, all_groups) VALUES (?, 'Người nhận', 0)", [contact.id]);
    await db.query("INSERT INTO recipient_group (recipient_id, group_id) VALUES (?, ?)", [rcp.insertId, ids.g1]);
    const asker = await ask("u-rcp");
    assert.equal(asker.access.origin, "derived_recipient");
    const groups = await runTool(asker, "list_groups", {}) as any;
    assert.deepEqual(groups.groups.map((g: { id: number }) => g.id), [ids.g1]);
    assert.match(((await runTool(asker, "read_file", { attachment_id: ids.fileG2 }) as any).error), /Không có tệp này/);
  });

  test("suggest_replies: tin gốc ở cuộc riêng của người khác / nhóm Mật không cờ bị từ chối trước khi gọi mô hình", async () => {
    const asker = await ask("u-a");
    asker.replySuggestion = { db, model: {} as never, usage: { inputTokens: 0, outputTokens: 0 }, maskPersonal: false, now: NOW,
      tenantId: 1, askerContactId: 1, askerUid: "u-a" };
    const [other] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE text = 'tin riêng của B bí mật'");
    const [secret] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE text = 'tin mật cực kỳ'");
    assert.match(((await runTool(asker, "suggest_replies", { request: "trả lời", message_id: other[0].id }) as any).error), /Không tìm thấy tin này/);
    assert.match(((await runTool(asker, "suggest_replies", { request: "trả lời", message_id: secret[0].id }) as any).error), /Mật/);
  });
});
