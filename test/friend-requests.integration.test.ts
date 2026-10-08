// Tab «Kết bạn» của tài khoản bot (08/10/2026) trên MySQL THẬT: sự kiện kết bạn từ listener, gửi / đồng ý / từ chối / rút
// lời mời, trần 30 lời mời mỗi ngày (giờ Việt Nam), API + nhật ký. Zalo là bản GIẢ — không đụng phiên Zalo thật.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, describe, test } from "node:test";
import type http from "node:http";
import type { RowDataPacket } from "mysql2";
import { FriendEventType, type FriendEvent } from "zca-js";
import { SessionStore } from "../src/auth/session-store.js";
import { ensureAdminUser, setUserPassword } from "../src/auth/user-admin.js";
import { FriendRequestDirection, FriendRequestStatus, UserRole } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { handleApiRequest, type ApiDeps } from "../src/web/api/api-router.js";
import {
  DAILY_OUTGOING_FRIEND_REQUEST_CAP,
  DEFAULT_FRIEND_REQUEST_MESSAGE,
  FriendRequestManager,
  findFriendRequest,
  type FriendApi,
} from "../src/zalo/friend-requests.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["friend_request", "web_session", "app_user", "audit_log", "contact", "bot_account"];
const BOT_UID = "1000";
const LAN = "2001";
const BINH = "2002";
// 10:00 sáng 08/10/2026 giờ Việt Nam
const NOW = new Date("2026-10-08T03:00:00Z");

/** Zalo giả: ghi lại lệnh nhận được, trả dữ liệu soạn sẵn; `failWith` = lệnh kế tiếp ném lỗi mã Zalo này. */
class FakeZalo implements FriendApi {
  readonly calls: string[] = [];
  users = new Map<string, { uid: string; display_name: string; zalo_name: string; avatar: string }>();
  friends = new Set<string>();
  sent: Record<string, { userId: string; displayName: string; zaloName: string; avatar: string; fReqInfo: { message: string; src: number; time: number } }> = {};
  received: { userId: string; displayName: string; zaloName: string; avatar: string; recommTime: number; message: string }[] = [];
  failWith: number | null = null;

  private maybeFail(name: string) {
    this.calls.push(name);
    if (this.failWith !== null) {
      const code = this.failWith;
      this.failWith = null;
      throw Object.assign(new Error(`Zalo lỗi ${code}`), { code });
    }
  }
  async findUser(phone: string) {
    this.maybeFail(`findUser:${phone}`);
    const user = this.users.get(phone);
    return (user ?? {}) as Awaited<ReturnType<FriendApi["findUser"]>>;
  }
  async sendFriendRequest(msg: string, userId: string) { this.maybeFail(`send:${userId}:${msg}`); return ""; }
  async acceptFriendRequest(userId: string) { this.maybeFail(`accept:${userId}`); this.friends.add(userId); return ""; }
  async rejectFriendRequest(userId: string) { this.maybeFail(`reject:${userId}`); return ""; }
  async undoFriendRequest(userId: string) { this.maybeFail(`undo:${userId}`); return ""; }
  async getSentFriendRequest() { this.calls.push("getSent"); return this.sent as unknown as Awaited<ReturnType<FriendApi["getSentFriendRequest"]>>; }
  async getFriendRequestStatus(userId: string) {
    this.calls.push(`status:${userId}`);
    return { addFriendPrivacy: 0, isSeenFriendReq: false, is_friend: this.friends.has(userId) ? 1 : 0, is_requested: 0, is_requesting: 0 };
  }
  async getFriendRecommendations() {
    this.calls.push("recommendations");
    return {
      expiredDuration: 0, collapseMsgListConfig: { collapseId: 0, collapseXItem: 0, collapseYItem: 0 },
      recommItems: this.received.map((item) => ({ recommItemType: 1, dataInfo: {
        userId: item.userId, zaloName: item.zaloName, displayName: item.displayName, avatar: item.avatar, recommType: 2, recommTime: item.recommTime,
        recommInfo: { message: item.message } } })),
    } as unknown as Awaited<ReturnType<FriendApi["getFriendRecommendations"]>>;
  }
  async getUserInfo(userId: string | string[]) {
    this.calls.push(`userInfo:${String(userId)}`);
    const uid = String(userId);
    return { changed_profiles: { [uid]: { displayName: `Người ${uid}`, zaloName: `zalo ${uid}`, avatar: `https://ava/${uid}.jpg` } } } as unknown as
      Awaited<ReturnType<FriendApi["getUserInfo"]>>;
  }
}

interface Reply { status: number; body: any; cookie: string }

describe("kết bạn với tài khoản bot", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let zalo: FakeZalo;
  let manager: FriendRequestManager;
  let running = true;
  let sendQueueCalls = 0;
  let deps: ApiDeps;
  let botId = 0;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => {
    await db?.end();
  });
  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    const [inserted] = await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', ?, 'x')", [BOT_UID]);
    botId = inserted.insertId;
    await ensureAdminUser(db, "admin", "admin");
    zalo = new FakeZalo();
    running = true;
    sendQueueCalls = 0;
    manager = new FriendRequestManager({
      db, botAccountId: botId, ownUid: () => BOT_UID, api: () => zalo, now: () => NOW,
      send: (task) => { sendQueueCalls += 1; return task(); },
    });
    const service = {
      db, config: { google: { loginClientId: "" }, privacy: { allowedAiProviders: ["1"] } }, jobs: { wake: () => undefined },
      isRunning: () => running, friendsFor: (id: number) => (running && id === botId ? manager : null),
    };
    deps = { service: service as unknown as ApiDeps["service"], sessions: new SessionStore(db), qrLogins: {} as ApiDeps["qrLogins"] };
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
  const login = async () => (await call("POST", "/api/auth/login", { username: "admin", password: "admin" })).cookie;
  const friendEvent = (event: Partial<FriendEvent> & { type: FriendEventType }) => ({ threadId: "", isSelf: false, ...event }) as FriendEvent;

  test("an incoming request event records a pending row with the profile fetched from Zalo; self events are ignored", async () => {
    await manager.handleEvent(friendEvent({ type: FriendEventType.REQUEST, data: { fromUid: LAN, toUid: BOT_UID, src: 1, message: "Cho em kết bạn" } }));
    const row = await findFriendRequest(db, botId, LAN, FriendRequestDirection.Incoming);
    assert.equal(row?.status, FriendRequestStatus.Pending);
    assert.equal(row?.display_name, `Người ${LAN}`);
    assert.equal(row?.avatar_url, `https://ava/${LAN}.jpg`);
    assert.equal(row?.message, "Cho em kết bạn");

    // Sự kiện do chính bot làm, hoặc gửi cho người khác (không phải bot), không ghi gì
    await manager.handleEvent(friendEvent({ type: FriendEventType.REQUEST, isSelf: true, data: { fromUid: BOT_UID, toUid: BINH, src: 1, message: "" } }));
    await manager.handleEvent(friendEvent({ type: FriendEventType.REQUEST, data: { fromUid: BINH, toUid: "9999", src: 1, message: "" } }));
    await manager.handleEvent(friendEvent({ type: FriendEventType.REQUEST, data: { fromUid: "x'; DROP TABLE friend_request; --", toUid: BOT_UID, src: 1, message: "" } }));
    const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM friend_request");
    assert.equal(Number(rows[0].n), 1);
  });

  test("ADD marks every pending request with that person accepted and puts them in Danh bạ; undo / reject settle the right direction", async () => {
    await manager.handleEvent(friendEvent({ type: FriendEventType.REQUEST, data: { fromUid: LAN, toUid: BOT_UID, src: 1, message: "" } }));
    await manager.handleEvent(friendEvent({ type: FriendEventType.ADD, data: LAN }));
    assert.equal((await findFriendRequest(db, botId, LAN, FriendRequestDirection.Incoming))?.status, FriendRequestStatus.Accepted);
    const [contacts] = await db.query<RowDataPacket[]>("SELECT display_name, avatar_url FROM contact WHERE zalo_uid = ?", [LAN]);
    assert.equal(contacts[0]?.display_name, `Người ${LAN}`);

    // Bình mời bot rồi rút lại → lời mời đến = đã rút; bot mời Bình, Bình từ chối → lời mời đi = bị từ chối
    await manager.handleEvent(friendEvent({ type: FriendEventType.REQUEST, data: { fromUid: BINH, toUid: BOT_UID, src: 1, message: "" } }));
    await manager.handleEvent(friendEvent({ type: FriendEventType.UNDO_REQUEST, data: { fromUid: BINH, toUid: BOT_UID } }));
    assert.equal((await findFriendRequest(db, botId, BINH, FriendRequestDirection.Incoming))?.status, FriendRequestStatus.Cancelled);
    await manager.sendRequest({ uid: BINH });
    await manager.handleEvent(friendEvent({ type: FriendEventType.REJECT_REQUEST, data: { fromUid: BINH, toUid: BOT_UID } }));
    assert.equal((await findFriendRequest(db, botId, BINH, FriendRequestDirection.Outgoing))?.status, FriendRequestStatus.Rejected);
    // Một sự kiện từ chối muộn không được lật lại lời mời đã đồng ý
    await manager.handleEvent(friendEvent({ type: FriendEventType.REJECT_REQUEST, data: { fromUid: LAN, toUid: BOT_UID } }));
    assert.equal((await findFriendRequest(db, botId, LAN, FriendRequestDirection.Incoming))?.status, FriendRequestStatus.Accepted);
  });

  test("sending goes through the account send queue with the default message, and a second send to a pending person is refused", async () => {
    const result = await manager.sendRequest({ uid: LAN, displayName: "Lan" });
    assert.equal(result.status, FriendRequestStatus.Pending);
    assert.deepEqual(zalo.calls, [`send:${LAN}:${DEFAULT_FRIEND_REQUEST_MESSAGE}`]);
    assert.equal(sendQueueCalls, 1);
    await assert.rejects(manager.sendRequest({ uid: LAN }), { status: 409, code: "already_requested" });
    await assert.rejects(manager.sendRequest({ uid: BOT_UID }), { status: 422 });
    await assert.rejects(manager.sendRequest({ uid: "abc" }), { status: 422 });
    await assert.rejects(manager.sendRequest({ uid: BINH, message: "x".repeat(151) }), { status: 422 });
    assert.equal(zalo.calls.length, 1);
  });

  test("the 31st request of the Vietnamese day is refused with 429, yesterday's requests do not count", async () => {
    // 29 lời mời hôm nay (từ 0 giờ giờ Việt Nam = 17:00 UTC hôm trước) + 5 lời mời hôm qua
    for (let index = 0; index < DAILY_OUTGOING_FRIEND_REQUEST_CAP - 1; index += 1) {
      await db.query("INSERT INTO friend_request (bot_account_id, zalo_uid, direction, status, requested_at) VALUES (?, ?, ?, ?, ?)",
        [botId, String(5000 + index), FriendRequestDirection.Outgoing, FriendRequestStatus.Pending, new Date("2026-10-07T17:00:00Z")]);
    }
    for (let index = 0; index < 5; index += 1) {
      await db.query("INSERT INTO friend_request (bot_account_id, zalo_uid, direction, status, requested_at) VALUES (?, ?, ?, ?, ?)",
        [botId, String(6000 + index), FriendRequestDirection.Outgoing, FriendRequestStatus.Rejected, new Date("2026-10-07T16:59:59Z")]);
    }
    await manager.sendRequest({ uid: LAN });
    assert.deepEqual(await manager.dailyUsage(), { sent_today: DAILY_OUTGOING_FRIEND_REQUEST_CAP, daily_cap: DAILY_OUTGOING_FRIEND_REQUEST_CAP });
    await assert.rejects(manager.sendRequest({ uid: BINH }), { status: 429, code: "daily_cap" });
    assert.ok(!zalo.calls.some((name) => name.startsWith(`send:${BINH}`)), "đã chạm trần thì không được gọi Zalo");
  });

  test("Zalo saying «already friends» records the person as a friend; «blocked» is a clear 422; other errors are 502", async () => {
    zalo.failWith = 225;
    const result = await manager.sendRequest({ uid: LAN, displayName: "Lan" });
    assert.equal(result.status, FriendRequestStatus.Accepted);
    zalo.failWith = 215;
    await assert.rejects(manager.sendRequest({ uid: BINH }), { status: 422, code: "blocked" });
    zalo.failWith = 999;
    await assert.rejects(manager.sendRequest({ uid: BINH }), { status: 502 });
    assert.equal(await findFriendRequest(db, botId, BINH, FriendRequestDirection.Outgoing), null);
  });

  test("API: search, send, accept, reject, cancel — admin only, audited, and 409 when the bot is not running", async () => {
    const token = await login();
    zalo.users.set("84912345678", { uid: LAN, display_name: "Chị Lan", zalo_name: "Lan", avatar: "https://ava/lan.jpg" });

    const bad = await call("GET", `/api/accounts/${botId}/friends/search?phone=12345`, undefined, token);
    assert.equal(bad.status, 422);
    const found = await call("GET", `/api/accounts/${botId}/friends/search?phone=${encodeURIComponent("0912 345 678")}`, undefined, token);
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.deepEqual(found.body.data, { uid: LAN, display_name: "Chị Lan", zalo_name: "Lan", avatar_url: "https://ava/lan.jpg", relation: "none" });
    assert.equal((await call("GET", `/api/accounts/${botId}/friends/search?phone=0987654321`, undefined, token)).status, 404);

    const sent = await call("POST", `/api/accounts/${botId}/friends/requests`, { uid: LAN, message: "Chào chị", display_name: "Chị Lan", avatar_url: "javascript:alert(1)" }, token);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.data.sent_today, 1);
    const lanRow = await findFriendRequest(db, botId, LAN, FriendRequestDirection.Outgoing);
    assert.equal(lanRow?.avatar_url, "", "ảnh không phải http(s) bị bỏ");
    assert.equal((await call("GET", `/api/accounts/${botId}/friends/search?phone=0912345678`, undefined, token)).body.data.relation, "requested");

    // Bình mời bot → hiện ở «Lời mời đến», đồng ý được; lời mời không có thì 404
    await manager.handleEvent(friendEvent({ type: FriendEventType.REQUEST, data: { fromUid: BINH, toUid: BOT_UID, src: 1, message: "" } }));
    zalo.sent = { [LAN]: { userId: LAN, displayName: "Chị Lan", zaloName: "Lan", avatar: "", fReqInfo: { message: "Chào chị", src: 30, time: Math.floor(NOW.getTime() / 1000) } } };
    zalo.received = [{ userId: BINH, displayName: "Anh Bình", zaloName: "Bình", avatar: "", recommTime: NOW.getTime(), message: "" }];
    const overview = await call("GET", `/api/accounts/${botId}/friends?refresh=1`, undefined, token);
    assert.equal(overview.status, 200);
    assert.deepEqual(overview.body.data.incoming.map((row: { zalo_uid: string }) => row.zalo_uid), [BINH]);
    assert.deepEqual(overview.body.data.sent.map((row: { zalo_uid: string; status: number }) => [row.zalo_uid, row.status]), [[LAN, FriendRequestStatus.Pending]]);
    assert.equal(overview.body.data.running, true);
    assert.equal(overview.body.data.daily_cap, DAILY_OUTGOING_FRIEND_REQUEST_CAP);

    assert.equal((await call("POST", `/api/accounts/${botId}/friends/incoming/${BINH}/accept`, undefined, token)).status, 200);
    assert.ok(zalo.calls.includes(`accept:${BINH}`));
    assert.equal((await findFriendRequest(db, botId, BINH, FriendRequestDirection.Incoming))?.status, FriendRequestStatus.Accepted);
    assert.equal((await call("POST", `/api/accounts/${botId}/friends/incoming/${BINH}/reject`, undefined, token)).status, 404);

    assert.equal((await call("POST", `/api/accounts/${botId}/friends/requests/${LAN}/cancel`, undefined, token)).status, 200);
    assert.ok(zalo.calls.includes(`undo:${LAN}`));
    assert.equal((await findFriendRequest(db, botId, LAN, FriendRequestDirection.Outgoing))?.status, FriendRequestStatus.Cancelled);

    const [audit] = await db.query<RowDataPacket[]>("SELECT action FROM audit_log WHERE entity = 'bot_account' AND entity_id = ? ORDER BY id", [botId]);
    assert.deepEqual(audit.map((row) => row.action), ["friend_request", "friend_accept", "friend_cancel"]);

    // Bot tắt: danh sách vẫn đọc được từ bảng, lệnh sang Zalo thì 409; tài khoản không có thì 404
    running = false;
    const offline = await call("GET", `/api/accounts/${botId}/friends`, undefined, token);
    assert.equal(offline.body.data.running, false);
    assert.equal(offline.body.data.sent.length, 1);
    assert.equal((await call("POST", `/api/accounts/${botId}/friends/requests`, { uid: "2003" }, token)).status, 409);
    assert.equal((await call("GET", `/api/accounts/${botId}/friends/search?phone=0912345678`, undefined, token)).status, 409);
    assert.equal((await call("GET", "/api/accounts/999/friends", undefined, token)).status, 404);
  });

  test("a refresh marks a sent request that vanished from Zalo as accepted when they are now friends, otherwise rejected", async () => {
    await manager.sendRequest({ uid: LAN });
    await manager.sendRequest({ uid: BINH });
    zalo.sent = {};
    zalo.friends.add(LAN);
    await manager.refresh({ force: true });
    assert.equal((await findFriendRequest(db, botId, LAN, FriendRequestDirection.Outgoing))?.status, FriendRequestStatus.Accepted);
    assert.equal((await findFriendRequest(db, botId, BINH, FriendRequestDirection.Outgoing))?.status, FriendRequestStatus.Rejected);
    // Không ép: trong vòng một phút không hỏi lại Zalo
    const before = zalo.calls.length;
    assert.equal(await manager.refresh({ force: false }), false);
    assert.equal(zalo.calls.length, before);
  });

  test("a staff user cannot reach the friend endpoints", async () => {
    await db.query("INSERT INTO app_user (email, username, full_name, role) VALUES ('nv@ida.vn', 'nv', 'NV', ?)", [UserRole.Staff]);
    await setUserPassword(db, "nv", "matkhau123");
    const token = (await call("POST", "/api/auth/login", { username: "nv", password: "matkhau123" })).cookie;
    assert.ok(token);
    assert.equal((await call("GET", `/api/accounts/${botId}/friends`, undefined, token)).status, 403);
    assert.equal((await call("POST", `/api/accounts/${botId}/friends/requests`, { uid: LAN }, token)).status, 403);
    assert.equal(zalo.calls.length, 0);
  });
});
