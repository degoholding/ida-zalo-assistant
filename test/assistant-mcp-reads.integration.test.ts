// Phase 6 plan «trợ lý qua MCP» — họ `reads` trên MySQL THẬT: mỗi công cụ chạy đường CŨ (SQL trực tiếp) và đường MCP (tools/call JSON-RPC thật) trên CÙNG
// dữ liệu cho CÙNG kết quả, với nhiều người hỏi (vai Danh bạ chưa có tài khoản, tài khoản bị khoanh nhóm, có / không cờ Mật, tài khoản đã tắt, hỏi trong nhóm).
// Khác biệt có chủ ý: BC2 (che bật → từ chối dò ≥ 9 số). Cộng năng lực MỚI mở cho MCP ngoài.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_p6 npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import type { AssistantMcpBridge } from "../src/assistant/mcp-bridge/assistant-mcp-bridge-config.js";
import { parseMcpFamilies } from "../src/assistant/mcp-bridge/assistant-mcp-families.js";
import { AssistantMcpTurn } from "../src/assistant/mcp-bridge/assistant-mcp-turn.js";
import { openMcpTurn } from "../src/assistant/mcp-bridge/open-mcp-turn.js";
import { groupContextSource } from "../src/assistant/group-context.js";
import { groupContextSourceLegacy } from "../src/assistant/group-context-legacy.js";
import { resolveAskerAccess, type AskerAccess } from "../src/assistant/infra/asker-access.js";
import { runTool, type ToolContext } from "../src/assistant/tools.js";
import { ContactRole, McpCallSource, UserRole } from "../src/constants.js";
import { runTool as runCoreTool } from "../src/data-access/tool-runner.js";
import { findTool } from "../src/data-access/read-tool-catalog.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { ConcurrencyGate } from "../src/mcp/mcp-concurrency-gate.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { ensureGroup, updateGroupSettings } from "../src/sync/group-repository.js";
import { ingestDirectMessage, ingestGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";
import { logMcpCall } from "../src/mcp/mcp-call-log.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["mcp_call_log", "assistant_turn", "message_search", "message", "group_member", "bot_group", "zalo_group", "contact_tag", "contact",
  "company", "session_event", "bot_account", "user_group_scope", "app_user", "recipient_group", "recipient"];
const NOW = new Date("2026-10-01T05:00:00Z");
const WINDOW = { from: "2026-10-01T00:00:00+07:00", to: "2026-10-02T00:00:00+07:00" };

function incoming(overrides: Partial<IncomingGroupMessage>): IncomingGroupMessage {
  return { zaloGroupId: "g-1", msgId: "1", cliMsgId: "", msgType: "webchat", senderUid: "u-x", senderName: "X", sentAtMs: NOW.getTime() - 3_600_000,
    content: "", quote: null, mentions: null, ...overrides };
}

/** Kết quả công cụ về JSON thuần để so (Date → chuỗi, undefined bị bỏ). */
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("họ reads: đường cũ = đường MCP trên MySQL thật", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let botId = 0;
  const ids: Record<string, number> = {};
  const open: { close: () => Promise<void> }[] = [];

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => {
    await db?.end();
  });

  async function member(group: number, uid: string, displayName: string): Promise<void> {
    await db.query("INSERT INTO group_member (group_id, zalo_uid, display_name, zalo_name) VALUES (?, ?, ?, ?)", [group, uid, displayName, displayName]);
  }

  async function webUser(uid: string, options: { groups?: number[]; allGroups?: boolean; confidential?: boolean; active?: boolean }): Promise<void> {
    await db.query("INSERT IGNORE INTO contact (zalo_uid, display_name) VALUES (?, ?)", [uid, uid]);
    const [contact] = await db.query<RowDataPacket[]>("SELECT id FROM contact WHERE zalo_uid = ?", [uid]);
    const [result] = await db.query<any>(
      "INSERT INTO app_user (email, username, full_name, role, contact_id, all_groups, can_view_confidential, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [`${uid}@ida.vn`, uid, uid, UserRole.Manager, contact[0].id, options.allGroups ? 1 : 0, options.confidential ? 1 : 0, options.active === false ? 0 : 1]);
    for (const groupId of options.groups ?? []) await db.query("INSERT INTO user_group_scope (user_id, group_id) VALUES (?, ?)", [result.insertId, groupId]);
  }

  async function accessOf(uid: string, options: { groupScopeId?: number; maskPersonal?: boolean } = {}): Promise<AskerAccess> {
    await db.query("INSERT IGNORE INTO contact (zalo_uid, display_name) VALUES (?, ?)", [uid, uid]);
    const [linked] = await db.query<RowDataPacket[]>("SELECT 1 FROM app_user u JOIN contact c ON c.id = u.contact_id WHERE c.zalo_uid = ?", [uid]);
    if (!linked.length) await db.query("UPDATE contact SET role = ? WHERE zalo_uid = ?", [ContactRole.Manager, uid]);
    const contact = (await findContactByUid(db, uid))!;
    return resolveAskerAccess(db, contact, { groupScopeId: options.groupScopeId, maskPersonal: options.maskPersonal ?? false, now: NOW });
  }

  /** Hai ngữ cảnh lượt cho cùng người hỏi: cũ (không phiên MCP) và MCP (họ reads, phiên mô hình đã mở). */
  async function pair(uid: string, options: { groupScopeId?: number; maskPersonal?: boolean } = {}): Promise<{ legacy: ToolContext; mcp: ToolContext; call: (name: string, args: Record<string, unknown>) => Promise<{ legacy: unknown; mcp: unknown }> }> {
    const access = await accessOf(uid, options);
    const base = (): ToolContext => ({ db, askerUid: uid, access, filesToSend: [], now: NOW, scopeGroupId: options.groupScopeId });
    const bridge: AssistantMcpBridge = { families: () => parseMcpFamilies("reads"), gate: new ConcurrencyGate(5, 100) };
    const turn = openMcpTurn(access, bridge, { groupScopeId: options.groupScopeId, coreQueryTools: true })!;
    open.push(turn);
    await turn.model();
    const legacy = base();
    const mcp = { ...base(), mcp: turn };
    return {
      legacy, mcp,
      call: async (name, args) => ({ legacy: plain(await runTool(legacy, name, args)), mcp: plain(await runTool(mcp, name, args)) }),
    };
  }

  beforeEach(async () => {
    while (open.length) await open.pop()!.close();
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    botId = ((await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')"))[0] as any).insertId;
    const deps = { db, defaults: { readMessages: true, captureFiles: false } };
    for (const [key, zaloId, name] of [["g1", "g-1", "Bán hàng K52"], ["g2", "g-2", "Kế toán"], ["gm", "g-mat", "Ban điều hành mật"]] as const) {
      const { group } = await ensureGroup(db, zaloId, { readMessages: true, captureFiles: false });
      ids[key] = group.id;
      await db.query("UPDATE zalo_group SET name = ? WHERE id = ?", [name, group.id]);
    }
    await db.query("UPDATE zalo_group SET label = 'K52' WHERE id = ?", [ids.g1]);
    await updateGroupSettings(db, ids.gm, { isConfidential: true });
    const company = ((await db.query<any>("INSERT INTO company (code, name) VALUES ('MP', 'Minh Phát')"))[0] as any).insertId;
    await db.query("INSERT INTO contact (zalo_uid, display_name, zalo_name, kind, kind_source, company_id, last_dm_at) VALUES ('u-binh', 'Anh Bình', 'Binh Z', 1, 1, ?, NOW())", [company]);
    await db.query("INSERT INTO contact (zalo_uid, display_name, zalo_name, kind, kind_source) VALUES ('u-lan', 'Chị Lan', 'Lan Z', 2, 0)");
    await db.query("INSERT INTO contact (zalo_uid, display_name, zalo_name, kind, kind_source) VALUES ('u-hoa', 'Hòa', 'Hoa K', 0, 0)");
    await member(ids.g1, "u-binh", "Bình K52"); await member(ids.g1, "u-lan", "Lan K52"); await member(ids.g2, "u-hoa", "Hòa kế toán");
    await member(ids.gm, "u-binh", "Bình mật"); await member(ids.g1, "u-mgr", "Quản lý");
    await ingestGroupMessage(deps, botId, incoming({ msgId: "a", senderUid: "u-binh", senderName: "Anh Bình", content: "báo cáo công nợ Minh Phát đã gửi" }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "b", senderUid: "u-lan", senderName: "Chị Lan", sentAtMs: NOW.getTime() - 3_000_000,
      content: "@Quản lý xem báo cáo giúp em", mentions: [{ uid: "u-mgr", pos: 0, len: 9 }] }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "c", zaloGroupId: "g-2", senderUid: "u-hoa", senderName: "Hòa", content: "báo cáo thuế tháng 9 và số 0912345678" }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "d", zaloGroupId: "g-mat", senderUid: "u-binh", senderName: "Anh Bình", content: "báo cáo lương mật của ban điều hành" }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "e", senderUid: "u-sep", senderName: "Sếp", sentAtMs: NOW.getTime() - 2_000_000,
      content: "@Bình làm tiếp nhé", mentions: [{ uid: "u-binh", pos: 0, len: 6 }] }));
    await ingestDirectMessage(deps, botId, incoming({ zaloGroupId: "u-binh", senderUid: "u-binh", senderName: "Anh Bình", msgId: "d1", content: "riêng của Bình với bot" }));
    await ingestDirectMessage(deps, botId, incoming({ zaloGroupId: "u-mgr", senderUid: "u-mgr", senderName: "Quản lý", msgId: "d2", content: "riêng của quản lý với bot báo cáo" }));
    await webUser("u-scoped", { groups: [ids.g1] });
    await webUser("u-conf", { allGroups: true, confidential: true });
    await webUser("u-noconf", { allGroups: true });
    await webUser("u-off", { allGroups: true, active: false });
  });

  const ASKERS = ["u-mgr", "u-scoped", "u-conf", "u-noconf", "u-off"] as const;
  const cases: [string, Record<string, unknown>][] = [
    ["list_groups", {}], ["list_groups", { query: "k52" }], ["list_groups", { query: "ke toan" }],
    ["get_group_messages", { group_id: 0, ...WINDOW }], ["get_group_messages", { group_id: 99999, ...WINDOW }],
    ["find_people", { name: "Bình" }], ["find_people", { name: "lan" }], ["find_people", { name: "B" }],
    ["get_conversation_with_person", { person_uid: "u-binh", ...WINDOW }], ["get_conversation_with_person", { person_uid: "u-binh", ...WINDOW, include_me: false }],
    ["get_conversation_with_person", { person_uid: "u-mgr", ...WINDOW }],
    ["list_contacts", {}], ["list_contacts", { kind: "customer" }], ["list_contacts", { scope: "everyone" }], ["list_contacts", { query: "Minh Phát" }],
    ["search_messages", { query: "báo cáo" }], ["search_messages", { query: "bao cao", group: "k52" }], ["search_messages", { query: "báo cáo", person: "Lan" }],
    ["search_messages", { query: "công nợ", from: "2026-10-01", to: "2026-10-01" }], ["search_messages", { mentions_me: true }], ["search_messages", { mentions_me: true, query: "báo cáo" }],
    ["search_messages", { query: "báo cáo", group: "không có nhóm này" }], ["search_messages", {}], ["search_messages", { query: "báo cáo", limit: 1 }],
  ];

  test("mọi công cụ × mọi người hỏi: kết quả đường cũ = đường MCP", async () => {
    // Chống so hai lỗi / hai rỗng với nhau: dữ liệu mẫu phải cho kết quả thật với người hỏi rộng quyền
    const wide = await pair("u-conf");
    const real = async (name: string, args: Record<string, unknown>) => (await wide.call(name, args)).mcp as Record<string, any>;
    assert.equal((await real("list_groups", {})).groups.length, 3);
    assert.ok((await real("search_messages", { query: "báo cáo" })).results.length >= 3);
    assert.equal((await real("search_messages", { mentions_me: true })).results.length, 0, "u-conf không bị ai tag");
    assert.ok((await real("find_people", { name: "Bình" })).people.length >= 1);
    assert.ok((await real("get_conversation_with_person", { person_uid: "u-binh", ...WINDOW })).message_count >= 3);
    assert.ok((await real("list_contacts", { scope: "everyone" })).total_matching >= 3);
    assert.match((await real("get_group_messages", { group_id: ids.g1, ...WINDOW })).messages, /công nợ Minh Phát/);
    const manager = await pair("u-mgr");
    assert.equal(((await manager.call("search_messages", { mentions_me: true })).mcp as Record<string, any>).results.length, 1, "u-mgr bị Lan tag một lần");
    for (const uid of ASKERS) {
      const rig = await pair(uid);
      const groupCases: [string, Record<string, unknown>][] = [...Object.values(["g1", "g2", "gm"]).map((key): [string, Record<string, unknown>] => ["get_group_messages", { group_id: ids[key], ...WINDOW }]),
        ["get_group_messages", { group_id: ids.g1, from: "2026-09-01T00:00:00+07:00", to: "2026-09-02T00:00:00+07:00" }]];
      for (const [name, args] of [...cases, ...groupCases]) {
        const { legacy, mcp } = await rig.call(name, args);
        // Khác biệt DUY NHẤT có chủ ý ngoài BC2: tài khoản đã tắt (không nhóm nào) + «ai nhắc tôi» — đường cũ ghép `IN ()` rỗng ⇒ lỗi cú pháp SQL; lõi trả rỗng
        if (uid === "u-off" && args.mentions_me === true) {
          assert.match(String((legacy as { error?: string }).error), /SQL syntax/);
          assert.deepEqual((mcp as { results: unknown[] }).results, []);
          continue;
        }
        assert.deepEqual(mcp, legacy, `${uid} · ${name} ${JSON.stringify(args)}`);
      }
    }
  });

  test("hỏi trong nhóm: chỉ nhóm đó; group_id mô hình truyền bị đè; người / Danh bạ bị chặn; kết quả cũ = MCP", async () => {
    const rig = await pair("u-scoped", { groupScopeId: ids.g1 });
    for (const [name, args] of [
      ["list_groups", {}], ["get_group_messages", { group_id: ids.gm, ...WINDOW }], ["get_group_messages", { group_id: ids.g2, ...WINDOW }],
      ["search_messages", { query: "báo cáo" }], ["search_messages", { query: "báo cáo", group: "kế toán" }], ["search_messages", { mentions_me: true }],
      ["find_people", { name: "Lan" }], ["list_contacts", {}], ["get_conversation_with_person", { person_uid: "u-binh", ...WINDOW }],
    ] as [string, Record<string, unknown>][]) {
      const { legacy, mcp } = await rig.call(name, args);
      assert.deepEqual(mcp, legacy, `${name} ${JSON.stringify(args)}`);
    }
    const stolen = (await rig.call("get_group_messages", { group_id: ids.gm, ...WINDOW })).mcp as { group: string; messages: string };
    assert.equal(stolen.group, "Bán hàng K52");
    assert.doesNotMatch(stolen.messages, /lương mật/);
    assert.match(String(((await rig.call("find_people", { name: "Lan" })).mcp as { error: string }).error), /chỉ dùng được dữ liệu của nhóm/);
  });

  test("Mật: nhóm Mật không cờ → «bị Mật chặn» (khác «không có»); có cờ → đọc được; cả hai đường cùng chữ", async () => {
    const noConf = await pair("u-noconf");
    const blocked = await noConf.call("get_group_messages", { group_id: ids.gm, ...WINDOW });
    assert.deepEqual(blocked.mcp, blocked.legacy);
    assert.match(String((blocked.mcp as { error: string }).error), /chế độ Mật/);
    const missing = await noConf.call("get_group_messages", { group_id: 987654, ...WINDOW });
    assert.match(String((missing.mcp as { error: string }).error), /Không có nhóm này/);
    const conf = await pair("u-conf");
    assert.match(String(((await conf.call("get_group_messages", { group_id: ids.gm, ...WINDOW })).mcp as { messages: string }).messages), /lương mật/);
    const found = (await noConf.call("search_messages", { query: "lương mật" })).mcp as { results: unknown[] };
    assert.equal(found.results.length, 0, "tìm không lộ tin nhóm Mật");
  });

  test("H1: get_conversation_with_person không lộ cuộc riêng của người khác; người khoanh nhóm không thấy ngoài phạm vi", async () => {
    const third = await pair("u-noconf");
    const other = (await third.call("get_conversation_with_person", { person_uid: "u-binh", ...WINDOW })).mcp as { messages: string };
    assert.match(other.messages, /@Bình làm tiếp nhé/, "tin nhắc tên (trong nhóm) vẫn có");
    assert.doesNotMatch(other.messages, /riêng của Bình với bot/, "cuộc riêng Bình–bot không lộ cho người thứ ba");
    const scoped = await pair("u-scoped");
    const groups = (await scoped.call("list_groups", {})).mcp as { groups: { id: number }[] };
    assert.deepEqual(groups.groups.map((group) => group.id), [ids.g1]);
  });

  test("BC2: che bật → tìm «0912345678» bị từ chối invalid_value (đường cũ trả kết quả); số ngắn vẫn tìm được", async () => {
    const rig = await pair("u-mgr", { maskPersonal: true });
    const legacy = plain(await runTool(rig.legacy, "search_messages", { query: "0912345678" })) as { results?: unknown[]; error?: string };
    assert.ok(legacy.results, "đường cũ không chặn");
    const mcp = plain(await runTool(rig.mcp, "search_messages", { query: "0912345678" })) as { error?: string };
    assert.match(String(mcp.error), /che dữ liệu cá nhân/);
    const ok = plain(await runTool(rig.mcp, "search_messages", { query: "báo cáo" })) as { results: unknown[] };
    assert.ok(ok.results.length > 0);
    // Nhật ký ghi không chờ (không chặn lời gọi) — đợi tối đa ~2 giây
    let logged = 0;
    for (let attempt = 0; attempt < 40 && logged < 2; attempt += 1) {
      [{ n: logged }] = (await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM mcp_call_log WHERE tool = 'search_messages' AND source = ?", [McpCallSource.Assistant]))[0] as { n: number }[];
      if (logged < 2) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(logged, 2, "mọi lời gọi qua MCP có dòng nhật ký (kể cả lời gọi bị từ chối)");
  });

  test("ngữ cảnh nhóm: lệnh group_context qua MCP = SQL cũ (kể cả mốc before_message_id); ghi nhật ký nguồn lệnh", async () => {
    const access = await accessOf("u-scoped", { groupScopeId: ids.g1 });
      const logs: number[] = [];
    const logged = new AssistantMcpTurn({ ...access, groupScopeId: ids.g1 }, new Set(["reads"]),
      { gate: new ConcurrencyGate(5, 100), families: new Set(["reads"]), logCall: async (entry) => { logs.push(entry.source); await logMcpCall(db, entry); } });
    open.push(logged);
    const [last] = await db.query<RowDataPacket[]>("SELECT MAX(id) AS id FROM message WHERE group_id = ?", [ids.g1]);
    for (const before of [null, Number(last[0].id)]) {
      const viaMcp = await groupContextSource(db, ids.g1, before, logged);
      const viaSql = await groupContextSourceLegacy(db, ids.g1, before);
      assert.deepEqual(viaMcp, viaSql, `before=${before}`);
      assert.ok(viaMcp.context.includes("báo cáo công nợ"));
      assert.ok(viaMcp.memberNames.includes("Bình K52"));
    }
    assert.deepEqual(logs, [McpCallSource.AssistantCommand, McpCallSource.AssistantCommand]);
    // Không có phiên MCP (họ tắt) → đường cũ y nguyên
    assert.deepEqual(await groupContextSource(db, ids.g1, null), await groupContextSourceLegacy(db, ids.g1, null));
    // Họ tắt trong phiên: không gọi lệnh
    const noFamily = openMcpTurn(access, { families: () => parseMcpFamilies("core"), gate: new ConcurrencyGate(5, 100) }, { groupScopeId: ids.g1 })!;
    open.push(noFamily);
    assert.deepEqual(await groupContextSource(db, ids.g1, null, noFamily), await groupContextSourceLegacy(db, ids.g1, null));
    assert.equal(noFamily.opened, 0);
  });

  test("MCP ngoài (năng lực mới): search_messages mentions_me / group_name, find_people, get_conversation_with_person qua lõi", async () => {
    const access = await accessOf("u-mgr");
    const ctx = { ...access, source: McpCallSource.Http };
    const search = await runCoreTool(findTool("search_messages")!, ctx, { mentions_me: true });
    assert.equal(search.isError, false, search.text);
    assert.deepEqual((search.structured as { hits: { snippet: string }[] }).hits.map((hit) => hit.snippet), ["@Quản lý xem báo cáo giúp em"]);
    const byGroup = await runCoreTool(findTool("search_messages")!, ctx, { query: "báo cáo", group_name: "k52" });
    assert.deepEqual((byGroup.structured as { hits: { thread_id: number }[] }).hits.map((hit) => hit.thread_id).sort(), [ids.g1, ids.g1].sort());
    const none = await runCoreTool(findTool("search_messages")!, ctx, {});
    assert.equal(none.errorCode, "invalid_value");
    const people = await runCoreTool(findTool("find_people")!, ctx, { name: "Bình" });
    assert.equal((people.structured as { people: { uid: string }[] }).people[0].uid, "u-binh");
    const talk = await runCoreTool(findTool("get_conversation_with_person")!, ctx, { person_uid: "u-binh", ...WINDOW });
    assert.match((talk.structured as { messages: string }).messages, /báo cáo công nợ/);
    // Khóa MCP không gắn liên hệ: «ai nhắc tôi» không có nghĩa → báo lỗi, không đoán
    const anonymous = await runCoreTool(findTool("search_messages")!, { ...ctx, contactActor: undefined, ownDirectUid: null }, { mentions_me: true });
    assert.equal(anonymous.errorCode, "invalid_value");
  });
});

