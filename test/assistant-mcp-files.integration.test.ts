// Phase 7 plan «trợ lý qua MCP» — họ `files` trên MySQL THẬT: mỗi công cụ tệp / link / gợi ý trả lời chạy đường CŨ (SQL trực tiếp) và đường MCP (tools/call JSON-RPC thật)
// trên CÙNG dữ liệu cho CÙNG kết quả, với nhiều người hỏi (vai Danh bạ chưa có tài khoản, tài khoản bị khoanh nhóm, có / không cờ Mật, tài khoản đã tắt, hỏi trong nhóm).
// Thêm: đọc tệp lần đầu GHI cache qua `file_text_store` (nhật ký nguồn 3), lần hai đọc cache; `file_text_store` cho tệp ngoài phạm vi → không dòng attachment_text; MCP ngoài `search_files`.
// Khác biệt có chủ ý: BC2 (che bật → từ chối tìm dãy ≥ 9 số ở search_files).
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_p7 npm test

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { readAttachmentText } from "../src/assistant/file-reader.js";
import type { AssistantMcpBridge } from "../src/assistant/mcp-bridge/assistant-mcp-bridge-config.js";
import { parseMcpFamilies } from "../src/assistant/mcp-bridge/assistant-mcp-families.js";
import { openMcpTurn } from "../src/assistant/mcp-bridge/open-mcp-turn.js";
import { resolveAskerAccess, type AskerAccess } from "../src/assistant/infra/asker-access.js";
import { runTool, type ToolContext } from "../src/assistant/tools.js";
import type { ModelClient } from "../src/assistant/gemini-client.js";
import { AttachmentStatus, ContactRole, McpCallSource, ReplyTemplateStatus, UserRole } from "../src/constants.js";
import { buildDataAccessContext } from "../src/data-access/data-access-context.js";
import { findTool } from "../src/data-access/read-tool-catalog.js";
import { runTool as runCoreTool } from "../src/data-access/tool-runner.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { ConcurrencyGate } from "../src/mcp/mcp-concurrency-gate.js";
import { logMcpCall } from "../src/mcp/mcp-call-log.js";
import type { FileStorage } from "../src/storage/file-storage.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { ensureGroup, updateGroupSettings } from "../src/sync/group-repository.js";
import { ingestDirectMessage, ingestGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";
import type { Principal } from "../src/auth/principal.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["mcp_call_log", "assistant_turn", "attachment_text", "attachment", "message_search", "message", "group_member", "bot_group", "zalo_group", "contact_tag",
  "contact", "company", "session_event", "bot_account", "user_group_scope", "app_user", "recipient_group", "recipient", "reply_template"];
const NOW = new Date("2026-10-01T05:00:00Z");
const SECRET_LINK = "https://docs.google.com/spreadsheets/d/SECRETSHEET123456/edit";
const GROUP_LINK = "https://docs.google.com/document/d/GROUPDOC1234567890/edit";
const DRAFTS = (templateId: number) => JSON.stringify({ template_id: templateId, drafts: [
  { tone: "formal", text: "Dạ em gửi anh giá Flowertop là [giá], áp dụng đến [ngày] ạ." }, { tone: "friendly", text: "Dạ giá Flowertop em báo anh nha: [giá]." },
  { tone: "brief", text: "Flowertop: [giá] ạ." },
] });

function incoming(overrides: Partial<IncomingGroupMessage>): IncomingGroupMessage {
  return { zaloGroupId: "g-1", msgId: "1", cliMsgId: "", msgType: "webchat", senderUid: "u-x", senderName: "X", sentAtMs: NOW.getTime() - 3_600_000, content: "", quote: null, mentions: null, ...overrides };
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("họ files: đường cũ = đường MCP trên MySQL thật", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let botId = 0;
  let templateId = 0;
  const ids: Record<string, number> = {};
  const open: { close: () => Promise<void> }[] = [];
  const files = new Map<string, Buffer>();
  const storage = { read: async (key: string) => Readable.from([files.get(key) ?? Buffer.alloc(0)]) } as unknown as FileStorage;

  before(async () => { await runMigrations(databaseUrl!); db = createPool(databaseUrl!); });
  after(async () => { await db?.end(); });

  async function attach(text: string, groupId: number, name: string, options: { status?: AttachmentStatus; ext?: string; body?: string } = {}): Promise<number> {
    const [msg] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE text = ?", [text]);
    const key = `k/${name}`;
    files.set(key, Buffer.from(options.body ?? "mã,số\nA1,100\nB2,200"));
    const stored = (options.status ?? AttachmentStatus.Stored) === AttachmentStatus.Stored;
    const [result] = await db.query<any>(
      "INSERT INTO attachment (message_id, group_id, file_name, file_ext, source_url, storage_key, stored_bytes, status) VALUES (?, ?, ?, ?, 'https://zalo.example/f', ?, ?, ?)",
      [msg[0].id, groupId, name, options.ext ?? "csv", stored ? key : null, stored ? files.get(key)!.length : null, options.status ?? AttachmentStatus.Stored]);
    return result.insertId as number;
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

  const draftModel = (): ModelClient => ({ generate: async () => ({ content: { role: "model", parts: [{ text: DRAFTS(templateId) }] }, inputTokens: 1, outputTokens: 1 }) });

  /** Hai ngữ cảnh lượt cho cùng người hỏi: cũ (không phiên MCP) và MCP (họ files, phiên mô hình đã mở). */
  async function pair(uid: string, options: { groupScopeId?: number; maskPersonal?: boolean } = {}) {
    const access = await accessOf(uid, options);
    const contact = (await findContactByUid(db, uid))!;
    const bridge: AssistantMcpBridge = { families: () => parseMcpFamilies("files"), gate: new ConcurrencyGate(5, 100) };
    const turn = openMcpTurn(access, bridge, { groupScopeId: options.groupScopeId, coreQueryTools: true })!;
    open.push(turn);
    await turn.model();
    const base = (): ToolContext => ({
      db, askerUid: uid, access, filesToSend: [], now: NOW, scopeGroupId: options.groupScopeId, question: "đọc link giúp",
      readFile: (id) => readAttachmentText({ db, storage, maxFileBytes: 5 * 1024 * 1024 }, id),
      readLink: async () => ({ how: "web", text: "NỘI DUNG LINK", inputTokens: 0, outputTokens: 0 }) as never,
      replySuggestion: options.groupScopeId === undefined ? { db, model: draftModel(), usage: { inputTokens: 0, outputTokens: 0 }, maskPersonal: options.maskPersonal ?? false, now: NOW,
        tenantId: 1, askerContactId: contact.id, askerUid: uid } : undefined,
    });
    const legacy = base();
    const mcp = { ...base(), mcp: turn };
    return {
      legacy, mcp, turn,
      /** Chạy công cụ ở cả hai đường (cũ trước); `reset` xóa cache chữ giữa hai lần để cả hai cùng bóc lần đầu. */
      call: async (name: string, args: Record<string, unknown>, reset = false) => {
        const first = plain(await runTool(legacy, name, args));
        const effectsLegacy = { filesToSend: [...legacy.filesToSend], fixedReply: legacy.fixedReply, followUps: legacy.followUps };
        if (reset) await db.query("DELETE FROM attachment_text");
        const second = plain(await runTool(mcp, name, args));
        const effectsMcp = { filesToSend: [...mcp.filesToSend], fixedReply: mcp.fixedReply, followUps: mcp.followUps };
        return { legacy: first, mcp: second, effectsLegacy: plain(effectsLegacy), effectsMcp: plain(effectsMcp) };
      },
    };
  }

  beforeEach(async () => {
    while (open.length) await open.pop()!.close();
    files.clear();
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    botId = ((await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')"))[0] as any).insertId;
    const deps = { db, defaults: { readMessages: true, captureFiles: true } };
    for (const [key, zaloId, name] of [["g1", "g-1", "Bán hàng K52"], ["g2", "g-2", "Kế toán"], ["gm", "g-mat", "Ban điều hành mật"]] as const) {
      const { group } = await ensureGroup(db, zaloId, { readMessages: true, captureFiles: true });
      ids[key] = group.id;
      await db.query("UPDATE zalo_group SET name = ? WHERE id = ?", [name, group.id]);
    }
    await updateGroupSettings(db, ids.gm, { isConfidential: true });
    await ingestGroupMessage(deps, botId, incoming({ msgId: "a", content: "tin nhóm một" }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "a2", content: `xem tài liệu ${GROUP_LINK}` }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "a3", content: "Flowertop giá sao em?", senderName: "Anh Sáu" }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "a4", content: "gọi em số 0912345678 nhé", senderName: "Anh Sáu" }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "a5", content: "tin chưa tải về" }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "a6", content: "tin tệp đuôi lạ" }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "b", zaloGroupId: "g-2", content: "tin nhóm hai" }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "b2", zaloGroupId: "g-2", content: "tin tệp đã đọc" }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "c", zaloGroupId: "g-mat", content: "tin mật cực kỳ" }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "c2", zaloGroupId: "g-mat", content: `bảng lương ${SECRET_LINK}` }));
    await ingestGroupMessage(deps, botId, incoming({ msgId: "c3", zaloGroupId: "g-mat", content: "Flowertop giá mật bao nhiêu" }));
    const dmA = await ingestDirectMessage(deps, botId, incoming({ zaloGroupId: "u-a", senderUid: "u-a", senderName: "A", msgId: "da", content: "tin riêng của A" }));
    const dmB = await ingestDirectMessage(deps, botId, incoming({ zaloGroupId: "u-b", senderUid: "u-b", senderName: "B", msgId: "db", content: "tin riêng của B bí mật" }));
    ids.dmA = dmA.thread.id; ids.dmB = dmB.thread.id;
    ids.fileA = await attach("tin riêng của A", ids.dmA, "bao cao A.csv");
    ids.fileB = await attach("tin riêng của B bí mật", ids.dmB, "bao cao B.csv");
    ids.fileG1 = await attach("tin nhóm một", ids.g1, "ke hoach G1.csv");
    ids.fileG2 = await attach("tin nhóm hai", ids.g2, "ke hoach G2.csv");
    ids.fileM = await attach("tin mật cực kỳ", ids.gm, "luong mat.csv");
    ids.fileSkip = await attach("tin chưa tải về", ids.g1, "chua tai.csv", { status: AttachmentStatus.Skipped });
    ids.fileBin = await attach("tin tệp đuôi lạ", ids.g1, "la.bin", { ext: "bin" });
    ids.fileRead = await attach("tin tệp đã đọc", ids.g2, "da doc.csv");
    await db.query("INSERT INTO attachment_text (attachment_id, method, char_count, summary, text) VALUES (?, 'text', 14, 'csv', 'noi dung bong da')", [ids.fileRead]);
    templateId = ((await db.query<any>(
      `INSERT INTO reply_template (tenant_id, name, situation, keywords, body, tone, status) VALUES (1, 'Báo giá sản phẩm', 'Khách hỏi giá', 'giá, báo giá', 'Dạ giá [giá] /bao, áp dụng đến [ngày].', 1, ?)`,
      [ReplyTemplateStatus.Approved]))[0] as any).insertId;
    await webUser("u-scoped", { groups: [ids.g1] });
    await webUser("u-conf", { allGroups: true, confidential: true });
    await webUser("u-noconf", { allGroups: true });
    await webUser("u-off", { allGroups: true, active: false });
  });

  const ASKERS = ["u-a", "u-scoped", "u-conf", "u-noconf", "u-off"] as const;
  const msgId = async (text: string) => Number(((await db.query<RowDataPacket[]>("SELECT id FROM message WHERE text LIKE ?", [`${text}%`]))[0] as RowDataPacket[])[0].id);

  test("search_files: ma trận người hỏi × từ khóa cho CÙNG kết quả", async () => {
    const cases: Record<string, unknown>[] = [
      { query: "bao cao" }, { query: "" }, { query: "luong" }, { query: "ke hoach" }, { query: "bong da" }, { query: "KE HOACH G1" }, { query: "x" },
      { query: "ke hoach", group_id: ids.g1 }, { query: "", group_id: ids.g2 }, { query: "ke hoach", from: "2026-09-30T00:00:00+07:00", to: "2026-10-02T00:00:00+07:00" },
      { query: "ke hoach", from: "2030-01-01" }, { query: "tin nhóm một" },
    ];
    let withRows = 0;
    for (const uid of ASKERS) {
      const rig = await pair(uid);
      for (const args of cases) {
        const { legacy, mcp } = await rig.call("search_files", args);
        assert.deepEqual(mcp, legacy, `${uid} · ${JSON.stringify(args)}`);
        if ((legacy as { files?: unknown[] }).files?.length) withRows += 1;
      }
    }
    assert.ok(withRows >= 15, `ma trận phải có đủ ca có dòng (có ${withRows})`);
    const conf = await pair("u-conf");
    const found = (await conf.call("search_files", { query: "luong" })).mcp as { files: { id: number; can_send: boolean }[] };
    assert.deepEqual(found.files.map((f) => f.id), [ids.fileM]);
    const text = (await conf.call("search_files", { query: "bong da" })).mcp as { files: { id: number; already_read: boolean }[] };
    assert.deepEqual(text.files.map((f) => [f.id, f.already_read]), [[ids.fileRead, true]]);
    const none = (await (await pair("u-noconf")).call("search_files", { query: "luong" })).mcp as { files: unknown[] };
    assert.equal(none.files.length, 0, "không cờ Mật: không thấy tệp nhóm Mật");
  });

  test("hỏi trong nhóm: search_files chỉ nhóm đó (group_id mô hình truyền bị đè); kết quả cũ = MCP", async () => {
    const rig = await pair("u-conf", { groupScopeId: ids.g1 });
    for (const args of [{ query: "" }, { query: "ke hoach" }, { query: "ke hoach", group_id: ids.g2 }, { query: "luong", group_id: ids.gm }]) {
      const { legacy, mcp } = await rig.call("search_files", args);
      assert.deepEqual(mcp, legacy, JSON.stringify(args));
    }
    const listed = (await rig.call("search_files", { query: "", group_id: ids.g2 })).mcp as { files: { id: number }[] };
    assert.ok(listed.files.length > 0 && listed.files.every((f) => [ids.fileG1, ids.fileSkip, ids.fileBin].includes(f.id)));
  });

  test("read_file × send_file × mọi người hỏi × mọi tệp (kể cả Mật / cuộc riêng người khác / chưa vào kho / không tồn tại): kết quả + tác động cũ = MCP", async () => {
    const targets = [ids.fileA, ids.fileB, ids.fileG1, ids.fileG2, ids.fileM, ids.fileSkip, ids.fileBin, ids.fileRead, 999_999];
    const outcomes = new Set<string>();
    for (const uid of ASKERS) {
      for (const id of targets) {
        const rig = await pair(uid);
        const read = await rig.call("read_file", { attachment_id: id }, true);
        assert.deepEqual(read.mcp, read.legacy, `${uid} · read_file ${id}`);
        const send = await rig.call("send_file", { attachment_id: id });
        assert.deepEqual(send.mcp, send.legacy, `${uid} · send_file ${id}`);
        assert.deepEqual(send.effectsMcp.filesToSend, send.effectsLegacy.filesToSend, `${uid} · filesToSend ${id}`);
        for (const result of [read.mcp, send.mcp] as Record<string, unknown>[]) outcomes.add(String(result.error ?? (result.content ? "ok-read" : "ok-send")).slice(0, 25));
      }
    }
    for (const expected of ["ok-read", "ok-send", "Không có tệp này.", "Nhóm này để chế độ Mật"]) assert.ok([...outcomes].some((text) => text.startsWith(expected)), `thiếu ca ${expected}: ${[...outcomes].join(" | ")}`);
    // Trần 3 tệp mỗi lượt giữ ở phía trợ lý
    const rig = await pair("u-conf");
    for (const id of [ids.fileG1, ids.fileG2, ids.fileM]) await runTool(rig.mcp, "send_file", { attachment_id: id });
    assert.match(String(((await runTool(rig.mcp, "send_file", { attachment_id: ids.fileRead })) as { error: string }).error), /tối đa 3 tệp/);
    assert.deepEqual(rig.mcp.filesToSend, [ids.fileG1, ids.fileG2, ids.fileM]);
  });

  /** Nhật ký gọi ghi KHÔNG chặn lời gọi (xong sau) — chờ ghi xong rồi mới đọc. */
  async function callLog(): Promise<{ tool: string; source: number; status: number }[]> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const [rows] = await db.query<RowDataPacket[]>("SELECT tool, source, status FROM mcp_call_log ORDER BY id");
    return rows.map((row) => ({ tool: String(row.tool), source: Number(row.source), status: Number(row.status) }));
  }
  const cacheRows = async () => (await db.query<RowDataPacket[]>("SELECT attachment_id, method, char_count, summary, text FROM attachment_text ORDER BY attachment_id"))[0];

  test("đọc tệp lần đầu ghi cache qua file_text_store (nhật ký nguồn 3), lần hai đọc từ cache — cache giống hệt đường cũ", async () => {
    const rig = await pair("u-a");
    await db.query("DELETE FROM attachment_text");
    await runTool(rig.legacy, "read_file", { attachment_id: ids.fileG1 });
    const legacyCache = plain(await cacheRows());
    await db.query("DELETE FROM attachment_text");
    await db.query("TRUNCATE TABLE mcp_call_log");
    const first = await runTool(rig.mcp, "read_file", { attachment_id: ids.fileG1 }) as { content: string };
    assert.match(first.content, /A1,100|A1 \| 100|mã/);
    assert.deepEqual(plain(await cacheRows()), legacyCache);
    const afterFirst = (await callLog()).filter((entry) => entry.source === McpCallSource.AssistantCommand).map((entry) => entry.tool);
    assert.deepEqual(afterFirst, ["file_read_prepare", "file_text_store"]);
    await runTool(rig.mcp, "read_file", { attachment_id: ids.fileG1 });
    const afterSecond = (await callLog()).filter((entry) => entry.source === McpCallSource.AssistantCommand).map((entry) => entry.tool);
    assert.deepEqual(afterSecond, ["file_read_prepare", "file_text_store", "file_read_prepare"], "lần hai chỉ kiểm quyền + lấy cache, không ghi lại");
  });

  test("đuôi lạ (unsupported): cả hai đường ghi dòng cache text NULL và trả cùng câu báo", async () => {
    const rig = await pair("u-a");
    const both = await rig.call("read_file", { attachment_id: ids.fileBin }, true);
    assert.deepEqual(both.mcp, both.legacy);
    assert.match(String((both.mcp as { error: string }).error), /chưa đọc được đuôi \.bin/);
    const [rows] = await db.query<RowDataPacket[]>("SELECT method, text FROM attachment_text WHERE attachment_id = ?", [ids.fileBin]);
    assert.deepEqual(plain(rows), [{ method: "unsupported", text: null }]);
  });

  test("file_text_store cho tệp ngoài phạm vi → not_found, KHÔNG dòng attachment_text; tệp Mật không cờ cũng bị chặn", async () => {
    await db.query("DELETE FROM attachment_text");
    const rig = await pair("u-a");
    const store = (attachmentId: number) => rig.turn.callTool("assistant_command", "file_text_store", { attachment_id: attachmentId, method: "text", text: "dữ liệu lạ", summary: "x", input_tokens: 0, output_tokens: 0 });
    // u-a có vai trò nhưng không cờ Mật: tệp Mật trong phạm vi → «confidential»; cuộc riêng người khác / không tồn tại → «not_found» (không lộ tồn tại)
    for (const [id, code] of [[ids.fileB, "not_found"], [ids.fileM, "confidential"], [999_999, "not_found"]] as const) {
      const result = await store(id);
      assert.equal(result.isError, true, `tệp ${id}`);
      assert.equal(((result._meta as Record<string, { code: string }>)["bot-tro-ly/error"]).code, code, `tệp ${id}`);
    }
    assert.equal((await cacheRows()).length, 0);
    assert.ok(!(await store(ids.fileG1)).isError);
    assert.equal((await cacheRows()).length, 1, "tệp trong phạm vi thì ghi");
  });

  test("read_link: kết quả cũ = MCP (link trong tin, trong câu hỏi, link Mật, link lạ, link hỏng); nhật ký có link_shared_check", async () => {
    for (const uid of ASKERS) {
      const rig = await pair(uid);
      for (const url of [GROUP_LINK, SECRET_LINK, "https://khong-co.example/x", "không phải link"]) {
        const { legacy, mcp } = await rig.call("read_link", { url });
        assert.deepEqual(mcp, legacy, `${uid} · ${url}`);
      }
      rig.mcp.question = `đọc giúp ${SECRET_LINK}`; rig.legacy.question = rig.mcp.question;
      const inQuestion = await rig.call("read_link", { url: SECRET_LINK });
      assert.deepEqual(inQuestion.mcp, inQuestion.legacy);
    }
    assert.ok((await callLog()).some((entry) => entry.tool === "link_shared_check" && entry.source === McpCallSource.AssistantCommand));
    const conf = await pair("u-conf");
    assert.equal(((await conf.call("read_link", { url: SECRET_LINK })).mcp as { content: string }).content, "NỘI DUNG LINK");
    const noconf = await pair("u-noconf");
    assert.match(String(((await noconf.call("read_link", { url: SECRET_LINK })).mcp as { error: string }).error), /không có trong tin nhắn/);
  });

  test("suggest_replies: tin gốc ngoài phạm vi / Mật / cuộc riêng người khác / không có tin / quá trần giờ — kết quả + câu dựng sẵn cũ = MCP", async () => {
    const own = await msgId("Flowertop giá sao");
    const secret = await msgId("Flowertop giá mật");
    const other = await msgId("tin riêng của B");
    const phone = await msgId("gọi em số");
    const cases: Record<string, unknown>[] = [
      { request: "trả lời tin hỏi giá Flowertop", message_id: own }, { request: "trả lời tin hỏi giá Flowertop", message_id: secret },
      { request: "trả lời giá", message_id: other }, { request: "trả lời giá", message_id: 999_999 }, { request: "trả lời giá", message_id: -3 },
      { request: "báo giá giúp" }, { request: "chào buổi sáng" }, { request: "" }, { request: "giá", message_id: "abc" }, { request: "trả lời giá số điện thoại", message_id: phone },
    ];
    let drafted = 0;
    for (const uid of ASKERS) for (const maskPersonal of [false, true]) {
      const rig = await pair(uid, { maskPersonal });
      for (const args of cases) {
        // Mỗi ca một ngữ cảnh mới (câu dựng sẵn của lượt chỉ có một)
        const fresh = await pair(uid, { maskPersonal });
        const { legacy, mcp, effectsLegacy, effectsMcp } = await fresh.call("suggest_replies", args);
        assert.deepEqual(mcp, legacy, `${uid} · mask ${maskPersonal} · ${JSON.stringify(args)}`);
        assert.deepEqual(effectsMcp, effectsLegacy, `${uid} · mask ${maskPersonal} · hiệu ứng ${JSON.stringify(args)}`);
        if (effectsLegacy.followUps?.length) drafted += 1;
      }
      void rig;
    }
    assert.ok(drafted >= 5, `phải có đủ ca ra bản nháp (có ${drafted})`);
    // Quá 30 lượt / giờ: cả hai đường cùng từ chối trước khi gọi mô hình
    const contact = (await findContactByUid(db, "u-conf"))!;
    for (let index = 0; index < 30; index += 1) {
      await db.query("INSERT INTO assistant_turn (bot_account_id, contact_id, thread_id, status, model, tool_calls, created_at) VALUES (?, ?, 1, 1, 'm', ?, ?)",
        [botId, contact.id, JSON.stringify([{ name: "suggest_replies" }]), new Date(NOW.getTime() - 60_000)]);
    }
    const capped = await (await pair("u-conf")).call("suggest_replies", { request: "giá", message_id: own });
    assert.deepEqual(capped.mcp, capped.legacy);
    assert.match(String(capped.effectsMcp.fixedReply), /30 lần/);
    assert.ok((await callLog()).some((entry) => entry.tool === "reply_sources" && entry.source === McpCallSource.AssistantCommand));
  });

  test("MCP ngoài: search_files tìm trong chữ đã bóc của tệp (có dặn dữ liệu không đáng tin), đúng phạm vi tài khoản", async () => {
    const principal = (overrides: Partial<Principal> = {}): Principal => ({ userId: 9, tenantId: 1, fullName: "Quản lý", email: "q@x", role: UserRole.Manager, groupIds: null, ...overrides });
    const ctx = (p: Principal) => buildDataAccessContext({ db, principal: p, maskPersonal: false, source: McpCallSource.Http, now: NOW });
    const tool = findTool("search_files")!;
    assert.deepEqual(tool.surfaces, ["mcp_http"], "findTool lấy bản cổng ngoài (đứng trước)");
    const result = await runCoreTool(tool, ctx(principal()), { query: "bong da" });
    assert.equal(result.isError, false);
    const data = result.structured as { files: { id: number; already_read: boolean }[]; untrusted_fields: string[] };
    assert.deepEqual(data.files.map((f) => f.id), [ids.fileRead]);
    assert.deepEqual(data.untrusted_fields, ["files"]);
    const scoped = await runCoreTool(tool, ctx(principal({ groupIds: [ids.g1] })), { query: "bong da" });
    assert.deepEqual((scoped.structured as { files: unknown[] }).files, [], "ngoài phạm vi nhóm: không thấy");
    const secret = await runCoreTool(tool, ctx(principal()), { query: "luong" });
    assert.deepEqual((secret.structured as { files: unknown[] }).files, [], "nhóm Mật không cờ: không thấy");
    const masked = await runCoreTool(tool, buildDataAccessContext({ db, principal: principal(), maskPersonal: true, source: McpCallSource.Http, now: NOW }), { query: "0912345678" });
    assert.equal(masked.errorCode, "invalid_value", "che bật: dò ≥ 9 số bị từ chối");
  });

  test("BC2: trợ lý bật che → search_files từ chối dãy ≥ 9 số ở đường MCP (đường cũ không chặn)", async () => {
    const rig = await pair("u-conf", { maskPersonal: true });
    const viaMcp = await runTool(rig.mcp, "search_files", { query: "0912345678" }) as { error?: string };
    assert.match(String(viaMcp.error), /che dữ liệu cá nhân/);
    const legacy = await runTool(rig.legacy, "search_files", { query: "0912345678" }) as { files?: unknown[] };
    assert.deepEqual(legacy.files, []);
  });
});
