// Phase 4 trên MySQL THẬT: đăng nhập (mật khẩu quản trị + Google), phiên lưu CSDL, quyền theo vai trò, phạm vi nhóm
// trên mọi API đọc dữ liệu, người dùng / người nhận, kênh nhắn riêng người nhận đi qua hàng đợi. Google và Zalo là giả.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, describe, test } from "node:test";
import type http from "node:http";
import type { RowDataPacket } from "mysql2";
import { SessionStore } from "../src/auth/session-store.js";
import { AttachmentStatus, JobKind, UserRole } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { isActiveRecipientUid, listActiveRecipients } from "../src/recipients/recipient-repository.js";
import { ensureGroup, ensureThread, directKey } from "../src/sync/group-repository.js";
import { ingestGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";
import { handleApiRequest, type ApiDeps } from "../src/web/api/api-router.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["web_session", "user_group_scope", "recipient_vip", "recipient_group", "recipient", "app_user", "job", "audit_log",
  "attachment", "message", "group_member", "bot_group", "zalo_group", "contact", "bot_account"];
const ADMIN_PASSWORD = "mat-khau-quan-tri-thu";
const GOOGLE_CLIENT = "123-abc.apps.googleusercontent.com";

function message(overrides: Partial<IncomingGroupMessage>): IncomingGroupMessage {
  return {
    zaloGroupId: "g-a", msgId: "1", cliMsgId: "", msgType: "webchat", senderUid: "u-lan", senderName: "Chị Lan",
    sentAtMs: Date.now() - 60_000, content: "xin chào", quote: null, mentions: null, ...overrides,
  };
}

interface Reply { status: number; body: any; cookie: string }

describe("phase 4 — tài khoản, quyền, phạm vi, người nhận", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let deps: ApiDeps;
  let googleEmail = "";
  const realFetch = globalThis.fetch;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    const service = {
      db, config: { google: { loginClientId: GOOGLE_CLIENT }, privacy: { allowedAiProviders: ["1"] } },
      jobs: { wake: () => undefined },
    };
    deps = { service: service as unknown as ApiDeps["service"], sessions: new SessionStore(db, ADMIN_PASSWORD), qrLogins: {} as ApiDeps["qrLogins"] };
    // Google tokeninfo giả: trả email đang đặt trong `googleEmail`
    globalThis.fetch = (async (input: unknown) => {
      if (String(input).startsWith("https://oauth2.googleapis.com/tokeninfo")) {
        return { ok: true, json: async () => ({ aud: GOOGLE_CLIENT, iss: "accounts.google.com", exp: String(Math.floor(Date.now() / 1000) + 600),
          email: googleEmail, email_verified: true, sub: "1" }) };
      }
      return realFetch(input as string);
    }) as typeof fetch;
  });
  after(async () => {
    globalThis.fetch = realFetch;
    await db?.end();
  });
  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    await db.query("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
  });

  /** Gọi API như trình duyệt: phương thức, đường, thân JSON, cookie phiên. */
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

  async function seedData() {
    const deps2 = { db, defaults: { readMessages: true, captureFiles: true } };
    const { group: a } = await ensureGroup(db, "g-a", { readMessages: true, captureFiles: true });
    const { group: b } = await ensureGroup(db, "g-b", { readMessages: true, captureFiles: true });
    await ingestGroupMessage(deps2, 1, message({ zaloGroupId: "g-a", msgId: "a1", senderUid: "u-lan", msgType: "share.file", content: { title: "a.pdf", href: "https://f/a", params: "{}" } }));
    await ingestGroupMessage(deps2, 1, message({ zaloGroupId: "g-b", msgId: "b1", senderUid: "u-binh", msgType: "share.file", content: { title: "b.pdf", href: "https://f/b", params: "{}" } }));
    await db.query("INSERT INTO group_member (group_id, zalo_uid, display_name) VALUES (?, 'u-lan', 'Lan'), (?, 'u-binh', 'Bình')", [a.id, b.id]);
    await db.query("UPDATE attachment SET status = ?", [AttachmentStatus.Stored]);
    return { a: a.id, b: b.id };
  }

  test("password login works, a wrong password does not, and the session survives in the database", async () => {
    assert.equal((await call("POST", "/api/auth/login", { password: "sai" })).status, 401);
    const ok = await call("POST", "/api/auth/login", { password: ADMIN_PASSWORD });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.user.role, UserRole.Admin);
    // Phiên mới (như sau khi khởi động lại) vẫn nhận mã cũ vì phiên nằm trong CSDL
    deps = { ...deps, sessions: new SessionStore(db, ADMIN_PASSWORD) };
    const me = await call("GET", "/api/auth/me", undefined, ok.cookie);
    assert.equal(me.body.data.full_name, "Quản trị");
    await call("POST", "/api/auth/logout", undefined, ok.cookie);
    assert.equal((await call("GET", "/api/auth/me", undefined, ok.cookie)).status, 401);
  });

  test("Google login only lets in registered, active users", async () => {
    googleEmail = "la@ida.vn";
    assert.equal((await call("POST", "/api/auth/google", { credential: "a.b.c" })).status, 403);
    await db.query("INSERT INTO app_user (email, full_name, role, is_active) VALUES ('la@ida.vn', 'Lạ', 3, 0)");
    assert.equal((await call("POST", "/api/auth/google", { credential: "a.b.c" })).status, 403);
    await db.query("UPDATE app_user SET is_active = 1");
    const ok = await call("POST", "/api/auth/google", { credential: "a.b.c" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.user.email, "la@ida.vn");
    const [rows] = await db.query<RowDataPacket[]>("SELECT last_login_at FROM app_user");
    assert.ok(rows[0].last_login_at);
    assert.equal((await call("GET", "/api/auth/config")).body.data.google_client_id, GOOGLE_CLIENT);
  });

  test("a scoped staff user sees only their groups, files and people, and gets 404 / 403 elsewhere", async () => {
    const { a, b } = await seedData();
    const [inserted] = await db.query<any>("INSERT INTO app_user (email, full_name, role) VALUES ('nv@ida.vn', 'NV', ?)", [UserRole.Staff]);
    await db.query("INSERT INTO user_group_scope (user_id, group_id) VALUES (?, ?)", [inserted.insertId, a]);
    googleEmail = "nv@ida.vn";
    const token = (await call("POST", "/api/auth/google", { credential: "a.b.c" })).cookie;

    const groups = await call("GET", "/api/groups", undefined, token);
    assert.deepEqual(groups.body.data.items.map((group: { id: number }) => group.id), [a]);
    assert.equal((await call("GET", `/api/groups/${b}`, undefined, token)).status, 404);
    assert.equal((await call("GET", `/api/conversations/${b}/messages`, undefined, token)).status, 404);
    const conversations = await call("GET", "/api/conversations", undefined, token);
    assert.deepEqual(conversations.body.data.items.map((item: { id: number }) => item.id), [a]);
    const files = await call("GET", "/api/files", undefined, token);
    assert.deepEqual(files.body.data.items.map((file: { file_name: string }) => file.file_name), ["a.pdf"]);
    const [fileB] = await db.query<RowDataPacket[]>("SELECT id FROM attachment WHERE group_id = ?", [b]);
    assert.equal((await call("GET", `/api/files/${fileB[0].id}/download`, undefined, token)).status, 404);
    const contacts = await call("GET", "/api/contacts", undefined, token);
    assert.deepEqual(contacts.body.data.items.map((contact: { zalo_uid: string }) => contact.zalo_uid), ["u-lan"]);
    assert.equal((await call("GET", "/api/contact-cards/u-binh", undefined, token)).status, 404);
    const lookups = await call("GET", "/api/lookups/groups", undefined, token);
    assert.deepEqual(lookups.body.data.map((group: { id: number }) => group.id), [a]);
    // Nhân viên: chỉ đọc; khu chỉ quản trị: cấm
    assert.equal((await call("PATCH", `/api/groups/${a}`, { label: "x" }, token)).status, 403);
    for (const path of ["/api/settings", "/api/users", "/api/recipients", "/api/ai-keys", "/api/accounts", "/api/audit-logs?entity=group&entity_id=1"]) {
      assert.equal((await call("GET", path, undefined, token)).status, 403, path);
    }
  });

  test("changing a user's role revokes their open sessions, and the admin can manage users", async () => {
    const { a } = await seedData();
    const admin = (await call("POST", "/api/auth/login", { password: ADMIN_PASSWORD })).cookie;
    const created = await call("POST", "/api/users", { email: "QL@IDA.vn ", full_name: "Quản lý", role: UserRole.Manager, group_ids: [a] }, admin);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.email, "ql@ida.vn");
    assert.deepEqual(created.body.data.group_ids, [a]);
    assert.equal((await call("POST", "/api/users", { email: "ql@ida.vn", role: 3 }, admin)).status, 422);
    assert.equal((await call("POST", "/api/users", { email: "khong-phai-email", role: 3 }, admin)).status, 422);
    assert.equal((await call("POST", "/api/users", { email: "x@ida.vn", role: 9 }, admin)).status, 422);
    assert.equal((await call("POST", "/api/users", { email: "y@ida.vn", role: 3, group_ids: [999999] }, admin)).status, 422);

    googleEmail = "ql@ida.vn";
    const managerToken = (await call("POST", "/api/auth/google", { credential: "a.b.c" })).cookie;
    assert.equal((await call("PATCH", `/api/groups/${a}`, { label: "Bán hàng A" }, managerToken)).status, 200);
    await call("PATCH", `/api/users/${created.body.data.id}`, { role: UserRole.Staff }, admin);
    assert.equal((await call("GET", "/api/auth/me", undefined, managerToken)).status, 401);
    const [audit] = await db.query<RowDataPacket[]>("SELECT actor FROM audit_log WHERE entity = 'group' AND action = 'update'");
    assert.equal(audit[0].actor, "Quản lý");
  });

  test("recipients: one per Zalo person, they may always DM the bot, and the test message goes through the queue", async () => {
    await seedData();
    const [contacts] = await db.query<RowDataPacket[]>("SELECT id, zalo_uid FROM contact ORDER BY zalo_uid");
    const admin = (await call("POST", "/api/auth/login", { password: ADMIN_PASSWORD })).cookie;
    const created = await call("POST", "/api/recipients", {
      name: "Trưởng phòng DVKH", title: "Trưởng phòng", rank_order: 1, contact_id: contacts[0].id, vip_contact_ids: [contacts[1].id],
      morning_brief_at: "07:30", evening_brief_at: "",
    }, admin);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.data.vip_contact_ids, [contacts[1].id]);
    assert.equal((await call("POST", "/api/recipients", { name: "Trùng", contact_id: contacts[0].id }, admin)).status, 422);
    assert.equal((await call("POST", "/api/recipients", { name: "Sai giờ", contact_id: contacts[1].id, morning_brief_at: "25:00" }, admin)).status, 422);
    assert.equal((await call("POST", "/api/recipients", { name: "Không Zalo" }, admin)).status, 422);
    assert.equal(await isActiveRecipientUid(db, String(contacts[0].zalo_uid)), true);
    assert.equal((await listActiveRecipients(db)).length, 1);

    assert.equal((await call("POST", `/api/recipients/${created.body.data.id}/test`, undefined, admin)).status, 200);
    const [jobs] = await db.query<RowDataPacket[]>("SELECT kind, payload FROM job");
    assert.equal(jobs[0].kind, JobKind.RecipientMessage);
    assert.equal((typeof jobs[0].payload === "string" ? JSON.parse(jobs[0].payload) : jobs[0].payload).recipientId, created.body.data.id);

    await call("PATCH", `/api/recipients/${created.body.data.id}`, { is_active: false }, admin);
    assert.equal(await isActiveRecipientUid(db, String(contacts[0].zalo_uid)), false);
  });

  test("a direct thread is created for a recipient the bot has never talked to", async () => {
    const { group } = await ensureThread(db, directKey(1, "u-moi"), { readMessages: true, captureFiles: true }, "Người mới");
    assert.equal(group.zalo_group_id, "u-moi");
  });
});
