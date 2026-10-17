// Phase 4 (MCP) trên MySQL THẬT: vá H2 (Quản lý không đổi vai trò Danh bạ), «Lấy tin cũ» cho Quản lý, cờ «Xem lịch sử thao tác»
// chỉ thấy dòng của bản ghi trong phạm vi, ticket theo phạm vi nhóm nguồn, cờ Mật + chặn trùng người Zalo ở màn Người dùng.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, describe, test } from "node:test";
import type http from "node:http";
import { SessionStore } from "../src/auth/session-store.js";
import { ensureAdminUser } from "../src/auth/user-admin.js";
import { ContactRole, UserRole } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { ensureGroup } from "../src/sync/group-repository.js";
import { handleApiRequest, type ApiDeps } from "../src/web/api/api-router.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["web_session", "user_group_scope", "app_user", "audit_log", "ticket_event", "ticket_attachment", "ticket",
  "group_member", "bot_group", "zalo_group", "contact", "bot_account"];
const ADMIN = { username: "admin", password: "admin" };

interface Reply { status: number; body: any; cookie: string }

describe("phase 4 (MCP) — cờ cấp quyền, H2, lấy tin cũ, phạm vi ticket + nhật ký", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let deps: ApiDeps;
  const backfills: number[] = [];

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    const service = {
      db, config: { google: { loginClientId: "" }, privacy: { allowedAiProviders: ["1"] } },
      jobs: { wake: () => undefined }, alerts: { invalidate: () => undefined },
      getBackfillJob: () => undefined,
      startBackfill: async (id: number) => { backfills.push(id); return { full: true, running: true, finishedAt: null, startedAt: Date.now() }; },
    };
    deps = { service: service as unknown as ApiDeps["service"], sessions: new SessionStore(db), qrLogins: {} as ApiDeps["qrLogins"] };
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    backfills.length = 0;
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    await db.query("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    await ensureAdminUser(db, ADMIN.username, ADMIN.password);
    deps = { ...deps, sessions: new SessionStore(db) };
  });

  async function call(method: string, path: string, body?: unknown, token?: string): Promise<Reply> {
    const request = new PassThrough() as unknown as http.IncomingMessage & PassThrough;
    Object.assign(request, { method, url: path, headers: { host: "localhost" } });
    (request as unknown as PassThrough).end(body === undefined ? undefined : JSON.stringify(body));
    let status = 200;
    let raw = "";
    let cookie = "";
    const response = {
      headersSent: false,
      setHeader: (name: string, value: string) => { if (name === "Set-Cookie") cookie = value; },
      writeHead: (code: number) => { status = code; return response; },
      end: (chunk?: string) => { raw = chunk ?? ""; },
      write: () => true, on: () => response, destroy: () => undefined,
    } as unknown as http.ServerResponse;
    await handleApiRequest({ request, response, url: new URL(path, "http://localhost") }, deps,
      { token, clientKey: "test", setCookie: (value) => value ? `s=${value}` : "s=" });
    return { status, body: raw ? JSON.parse(raw) : null, cookie: cookie.replace(/^s=/, "") };
  }

  async function seed() {
    const { group: a } = await ensureGroup(db, "g-a", { readMessages: true, captureFiles: true });
    const { group: b } = await ensureGroup(db, "g-b", { readMessages: true, captureFiles: true });
    await db.query("INSERT INTO contact (zalo_uid, zalo_name) VALUES ('u-lan', 'Lan'), ('u-binh', 'Bình')");
    await db.query("INSERT INTO group_member (group_id, zalo_uid, display_name) VALUES (?, 'u-lan', 'Lan'), (?, 'u-binh', 'Bình')", [a.id, b.id]);
    const [lan] = await db.query<any>("SELECT id FROM contact WHERE zalo_uid = 'u-lan'");
    const [binh] = await db.query<any>("SELECT id FROM contact WHERE zalo_uid = 'u-binh'");
    return { a: a.id as number, b: b.id as number, lanId: Number(lan[0].id), binhId: Number(binh[0].id) };
  }

  async function addUser(adminToken: string, username: string, role: UserRole, extra: Record<string, unknown>): Promise<string> {
    const created = await call("POST", "/api/users", { username, password: "1234", role, ...extra }, adminToken);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return (await call("POST", "/api/auth/login", { username, password: "1234" })).cookie;
  }

  test("H2: Quản lý PATCH vai trò Danh bạ → 403 (không ghi), trường khác vẫn sửa; quản trị đổi được", async () => {
    const { a, lanId } = await seed();
    const admin = (await call("POST", "/api/auth/login", ADMIN)).cookie;
    const manager = await addUser(admin, "quanly", UserRole.Manager, { group_ids: [a] });
    const denied = await call("PATCH", `/api/contacts/${lanId}`, { role: ContactRole.Manager, note: "x" }, manager);
    assert.equal(denied.status, 403);
    const [rows] = await db.query<any>("SELECT role, note FROM contact WHERE id = ?", [lanId]);
    assert.notEqual(Number(rows[0].role), ContactRole.Manager);
    assert.equal(rows[0].note ?? "", "");
    assert.equal((await call("PATCH", `/api/contacts/${lanId}`, { note: "ghi chú" }, manager)).status, 200);
    // Biểu mẫu web gửi cả ô vai trò không sửa: giá trị bằng hiện tại thì không phải «đổi»
    assert.equal((await call("PATCH", `/api/contacts/${lanId}`, { role: rows[0].role, note: "lần hai" }, manager)).status, 200);
    assert.equal((await call("PATCH", `/api/contacts/${lanId}`, { role: ContactRole.Manager }, admin)).status, 200);
  });

  test("Lấy tin cũ: Quản lý chạy được ở nhóm trong phạm vi, nhóm ngoài phạm vi 404, Nhân viên 403", async () => {
    const { a, b } = await seed();
    const admin = (await call("POST", "/api/auth/login", ADMIN)).cookie;
    const manager = await addUser(admin, "quanly", UserRole.Manager, { group_ids: [a] });
    const staff = await addUser(admin, "nhanvien", UserRole.Staff, { group_ids: [a] });
    assert.equal((await call("POST", `/api/groups/${a}/backfill`, {}, manager)).status, 200);
    assert.deepEqual(backfills, [a]);
    assert.equal((await call("POST", `/api/groups/${b}/backfill`, {}, manager)).status, 404);
    assert.equal((await call("POST", `/api/groups/${a}/backfill`, {}, staff)).status, 403);
    assert.deepEqual(backfills, [a]);
  });

  test("Lịch sử thao tác: người được cấp cờ chỉ thấy dòng của bản ghi trong phạm vi; không cờ → 403", async () => {
    const { a, b } = await seed();
    const admin = (await call("POST", "/api/auth/login", ADMIN)).cookie;
    const staff = await addUser(admin, "nhanvien", UserRole.Staff, { group_ids: [a], can_view_audit: true });
    const plain = await addUser(admin, "nhanvien2", UserRole.Staff, { group_ids: [a] });
    await db.query("INSERT INTO audit_log (entity, entity_id, action, message, actor) VALUES ('group', ?, 'update', 'sửa A', 'x'), ('group', ?, 'update', 'sửa B', 'x')", [a, b]);
    const seen = await call("GET", `/api/audit-logs?entity=group&entity_id=${a}`, undefined, staff);
    assert.equal(seen.status, 200);
    assert.deepEqual(seen.body.data.map((row: any) => row.message), ["sửa A"]);
    assert.equal((await call("GET", `/api/audit-logs?entity=group&entity_id=${b}`, undefined, staff)).status, 404);
    // Bản ghi trong phạm vi nhưng chưa có dòng nào → danh sách rỗng, không phải 404; loại chỉ quản trị (người dùng) → 404
    const { group: empty } = await ensureGroup(db, "g-empty", { readMessages: true, captureFiles: true });
    await db.query("INSERT INTO user_group_scope (user_id, group_id) SELECT id, ? FROM app_user WHERE username = 'nhanvien'", [empty.id]);
    assert.deepEqual((await call("GET", `/api/audit-logs?entity=group&entity_id=${empty.id}`, undefined, staff)).body.data, []);
    assert.equal((await call("GET", `/api/audit-logs?entity=user&entity_id=1`, undefined, staff)).status, 404);
    assert.equal((await call("GET", `/api/audit-logs?entity=group&entity_id=${a}`, undefined, plain)).status, 403);
    assert.equal((await call("GET", `/api/audit-logs?entity=group&entity_id=${b}`, undefined, admin)).body.data.length, 1);
  });

  test("Ticket: danh sách / chi tiết / thao tác lọc theo nhóm nguồn; cuộc riêng người khác không thấy", async () => {
    const { a, b } = await seed();
    const admin = (await call("POST", "/api/auth/login", ADMIN)).cookie;
    const staff = await addUser(admin, "nhanvien", UserRole.Staff, { group_ids: [a] });
    let ticketSeq = 0;
    const insert = async (title: string, thread: number | null) => {
      const [result] = await db.query<any>("INSERT INTO ticket (code, status, title, requester_uid, requester_name, source_thread_id) VALUES (?, 1, ?, 'u-lan', 'Lan', ?)", [`T-${++ticketSeq}`, title, thread]);
      return Number(result.insertId);
    };
    const inA = await insert("trong A", a);
    const inB = await insert("trong B", b);
    const noThread = await insert("không nhóm", null);
    const list = await call("GET", "/api/tickets", undefined, staff);
    assert.deepEqual(list.body.data.items.map((row: any) => row.title), ["trong A"]);
    assert.equal((await call("GET", `/api/tickets/${inA}`, undefined, staff)).status, 200);
    assert.equal((await call("GET", `/api/tickets/${inB}`, undefined, staff)).status, 404);
    assert.equal((await call("GET", `/api/tickets/${noThread}`, undefined, staff)).status, 404);
    assert.equal((await call("GET", `/api/tickets/${inB}/files/1`, undefined, staff)).status, 404);
    assert.equal((await call("GET", "/api/tickets", undefined, admin)).body.data.items.length, 3);
    assert.equal((await call("GET", `/api/tickets/${inB}`, undefined, admin)).status, 200);
    const manager = await addUser(admin, "quanly", UserRole.Manager, { group_ids: [a] });
    assert.equal((await call("POST", `/api/tickets/${inB}/actions`, { action: "note", note: "x" }, manager)).status, 404);
  });

  test("Người dùng: bật / tắt hai cờ có ghi nhật ký; gắn trùng người Zalo của tài khoản đang dùng → 422", async () => {
    const { lanId } = await seed();
    const admin = (await call("POST", "/api/auth/login", ADMIN)).cookie;
    const first = await call("POST", "/api/users", { username: "mot", password: "1234", role: UserRole.Staff, contact_id: lanId }, admin);
    assert.equal(first.status, 201);
    assert.equal(first.body.data.can_view_confidential, false);
    const dup = await call("POST", "/api/users", { username: "hai", password: "1234", role: UserRole.Staff, contact_id: lanId }, admin);
    assert.equal(dup.status, 422);
    const second = await call("POST", "/api/users", { username: "hai", password: "1234", role: UserRole.Staff }, admin);
    assert.equal((await call("PATCH", `/api/users/${second.body.data.id}`, { contact_id: lanId }, admin)).status, 422);
    // Tài khoản cũ đã tắt thì người Zalo được gắn lại
    await call("PATCH", `/api/users/${first.body.data.id}`, { is_active: false }, admin);
    assert.equal((await call("PATCH", `/api/users/${second.body.data.id}`, { contact_id: lanId }, admin)).status, 200);
    const patched = await call("PATCH", `/api/users/${second.body.data.id}`, { can_view_confidential: true, can_view_audit: true }, admin);
    assert.equal(patched.body.data.can_view_confidential, true);
    assert.equal(patched.body.data.can_view_audit, true);
    assert.equal((await call("PATCH", `/api/users/${second.body.data.id}`, { can_view_audit: "yes" }, admin)).status, 422);
    const [logs] = await db.query<any>("SELECT changed_fields FROM audit_log WHERE entity = 'user' AND entity_id = ? AND action = 'update' ORDER BY id DESC LIMIT 1", [second.body.data.id]);
    assert.match(logs[0].changed_fields, /Cho AI đọc nhóm Mật/);
    assert.match(logs[0].changed_fields, /Xem lịch sử thao tác/);
  });
});
