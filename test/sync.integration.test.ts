// Kiểm luồng đồng bộ trên MySQL THẬT (không giả lập DB): lưu tin, chống trùng, tải tệp, thành
// viên, thu hồi, dọn quá hạn. Chỉ Zalo và mạng là giả.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test
// Không có TEST_DATABASE_URL thì cả tệp bỏ qua.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { AttachmentStatus, MessageKind } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import type { FileStorage } from "../src/storage/file-storage.js";
import { AttachmentDownloader, type Fetcher } from "../src/sync/attachment-downloader.js";
import { CompanyInputError, createCompany } from "../src/sync/company-repository.js";
import {
  ensureGroup,
  findGroupByZaloId,
  markBotInGroup,
  markBotLeftGroup,
  markBotLeftMissingGroups,
  updateGroupSettings,
} from "../src/sync/group-repository.js";
import { syncGroupMembers, type GroupInfoSource } from "../src/sync/member-sync.js";
import { ingestGroupMessage, recallGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";
import { purgeExpiredMessages } from "../src/sync/retention.js";
import { cacheAvatars, isZaloImageUrl } from "../src/sync/avatar-cache.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["attachment", "message", "group_member", "bot_group", "zalo_group", "contact_tag", "contact", "company", "session_event", "bot_account"];

class MemoryStorage implements FileStorage {
  readonly files = new Map<string, Buffer>();
  readonly deleted: string[] = [];
  async put(key: string, body: Buffer): Promise<string> {
    this.files.set(key, body);
    return key;
  }
  async delete(storedKey: string): Promise<void> {
    this.deleted.push(storedKey);
    this.files.delete(storedKey);
  }
}

function makeMessage(overrides: Partial<IncomingGroupMessage> = {}): IncomingGroupMessage {
  return {
    zaloGroupId: "g-ban-hang",
    msgId: "1001",
    cliMsgId: "c1001",
    msgType: "webchat",
    senderUid: "u-chi-a",
    senderName: "Chị A",
    sentAtMs: Date.parse("2026-10-01T02:00:00Z"),
    content: "Anh Bình làm báo cáo bán hàng, thứ 6 gửi nhé",
    quote: null,
    mentions: null,
    ...overrides,
  };
}

function fakeResponse(status: number, body = "", headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : body, { status, headers });
}

describe("đồng bộ tin nhóm trên MySQL", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let botId: number;

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
    const [result] = await db.query<any>("INSERT INTO bot_account (label, session_cipher) VALUES ('bot1', 'x')");
    botId = result.insertId;
  });

  async function enableGroup(zaloGroupId: string, captureFiles: boolean) {
    const { group } = await ensureGroup(db, zaloGroupId, { readMessages: false, captureFiles: false });
    await updateGroupSettings(db, group.id, { readMessages: true, captureFiles });
    return group;
  }

  test("nhóm mới mặc định KHÔNG đọc: tạo dòng nhóm, không lưu chữ nào của tin", async () => {
    const newGroups: string[] = [];
    const outcome = await ingestGroupMessage(
      { db, defaults: { readMessages: false, captureFiles: false }, onNewGroup: (g) => newGroups.push(g.zalo_group_id) },
      botId,
      makeMessage(),
    );
    assert.equal(outcome, "group_not_read");
    assert.deepEqual(newGroups, ["g-ban-hang"]);
    const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM message");
    assert.equal(rows[0].n, 0);
    // Tin thứ hai của cùng nhóm không báo "nhóm mới" lần nữa
    await ingestGroupMessage(
      { db, defaults: { readMessages: false, captureFiles: false }, onNewGroup: (g) => newGroups.push(g.zalo_group_id) },
      botId,
      makeMessage({ msgId: "1002" }),
    );
    assert.equal(newGroups.length, 1);
  });

  test("bật đọc: lưu đúng tiếng Việt, trích dẫn, nhắc tên; tin trùng bị bỏ", async () => {
    await enableGroup("g-ban-hang", false);
    const deps = { db, defaults: { readMessages: false, captureFiles: false } };
    const message = makeMessage({
      quote: { globalMsgId: 999, msg: "Ai làm báo cáo?" },
      mentions: [{ uid: "u-binh", pos: 0, len: 8 }],
    });
    assert.equal(await ingestGroupMessage(deps, botId, message), "stored");
    // Zalo gửi lại tin khi nối lại, hoặc bot thứ hai cùng nhóm: không ra hai dòng
    assert.equal(await ingestGroupMessage(deps, botId, message), "duplicate");

    const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM message");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, "Anh Bình làm báo cáo bán hàng, thứ 6 gửi nhé");
    assert.equal(rows[0].kind, MessageKind.Text);
    assert.equal(rows[0].sender_name, "Chị A");
    assert.equal(rows[0].quote_msg_id, "999");
    assert.equal(rows[0].quote_text, "Ai làm báo cáo?");
    assert.deepEqual(rows[0].mentions, [{ uid: "u-binh", pos: 0, len: 8 }]);
    assert.equal(new Date(rows[0].sent_at).toISOString(), "2026-10-01T02:00:00.000Z");
  });

  test("tệp ở nhóm KHÔNG bật lấy file: ghi tên + thời điểm, không tải", async () => {
    await enableGroup("g-ban-hang", false);
    const queued: number[] = [];
    await ingestGroupMessage(
      { db, defaults: { readMessages: false, captureFiles: false }, onAttachmentQueued: (id) => queued.push(id) },
      botId,
      makeMessage({ msgType: "share.file", content: { title: "Bao gia.xlsx", href: "https://f.zdn.vn/1", params: "{}" } }),
    );
    assert.deepEqual(queued, []);
    const [rows] = await db.query<RowDataPacket[]>("SELECT status, file_name FROM attachment");
    assert.equal(rows[0].status, AttachmentStatus.Skipped);
    assert.equal(rows[0].file_name, "Bao gia.xlsx");
  });

  test("tệp ở nhóm bật lấy file: tải ngay về kho, ghi khóa lưu + số byte", async () => {
    await enableGroup("g-ban-hang", true);
    const storage = new MemoryStorage();
    const fetcher: Fetcher = async () => fakeResponse(200, "noi-dung-tep", { "content-type": "application/pdf" });
    const downloader = new AttachmentDownloader(db, storage, { concurrency: 2, maxFileBytes: 1024 }, fetcher);
    await ingestGroupMessage(
      { db, defaults: { readMessages: false, captureFiles: false }, onAttachmentQueued: (id) => downloader.enqueue(id) },
      botId,
      makeMessage({ msgType: "share.file", content: { title: "Hop dong.pdf", href: "https://f.zdn.vn/2", params: "{}" } }),
    );
    await downloader.drain();
    const [rows] = await db.query<RowDataPacket[]>("SELECT id, status, storage_key, stored_bytes FROM attachment");
    assert.equal(rows[0].status, AttachmentStatus.Stored);
    assert.equal(rows[0].storage_key, `g-ban-hang/2026-10/${rows[0].id}-Hop dong.pdf`);
    assert.equal(rows[0].stored_bytes, "noi-dung-tep".length);
    assert.equal(storage.files.get(rows[0].storage_key)?.toString(), "noi-dung-tep");
  });

  test("link chết (404) và tệp vượt trần: đánh Failed ngay, không thử lại vô ích", async () => {
    await enableGroup("g-ban-hang", true);
    const storage = new MemoryStorage();
    const fetcher: Fetcher = async (url) =>
      url.endsWith("/chet") ? fakeResponse(404) : fakeResponse(200, "x".repeat(2000));
    const downloader = new AttachmentDownloader(db, storage, { concurrency: 1, maxFileBytes: 1000 }, fetcher);
    const deps = { db, defaults: { readMessages: false, captureFiles: false }, onAttachmentQueued: (id: number) => downloader.enqueue(id) };
    await ingestGroupMessage(deps, botId, makeMessage({ msgId: "a", msgType: "share.file", content: { title: "a.pdf", href: "https://f/chet" } }));
    await ingestGroupMessage(deps, botId, makeMessage({ msgId: "b", msgType: "share.file", content: { title: "b.pdf", href: "https://f/to" } }));
    await downloader.drain();
    const [rows] = await db.query<RowDataPacket[]>("SELECT status, attempts, last_error FROM attachment ORDER BY id");
    assert.equal(rows[0].status, AttachmentStatus.Failed);
    assert.match(rows[0].last_error, /404/);
    assert.equal(rows[1].status, AttachmentStatus.Failed);
    assert.match(rows[1].last_error, /vượt trần/);
    assert.equal(storage.files.size, 0);
  });

  test("khởi động lại: nhặt tệp Pending còn dở và tải nốt", async () => {
    const group = await enableGroup("g-ban-hang", true);
    await ingestGroupMessage(
      { db, defaults: { readMessages: false, captureFiles: false } }, // không ai enqueue — như tiến trình chết
      botId,
      makeMessage({ msgType: "chat.photo", content: { href: "https://p/1.jpg", params: "{}" } }),
    );
    const storage = new MemoryStorage();
    const downloader = new AttachmentDownloader(db, storage, { concurrency: 1, maxFileBytes: 1000 },
      async () => fakeResponse(200, "anh", { "content-type": "image/jpeg" }));
    assert.equal(await downloader.resumePending(), 1);
    await downloader.drain();
    const [rows] = await db.query<RowDataPacket[]>("SELECT status, storage_key FROM attachment WHERE group_id = ?", [group.id]);
    assert.equal(rows[0].status, AttachmentStatus.Stored);
    assert.match(rows[0].storage_key, /-tep\.jpg$/);
  });

  test("thành viên: lấy đủ cả phần currentMems thiếu, ai rời thì có left_at, quay lại thì gỡ", async () => {
    const group = await enableGroup("g-ban-hang", false);
    let members = ["u1_0", "u2_3", "u3_1"];
    const source: GroupInfoSource = {
      getGroupInfo: async () => ({
        gridInfoMap: {
          "g-ban-hang": {
            name: "Bán hàng miền Nam",
            totalMember: members.length,
            memVerList: members,
            adminIds: ["u1"],
            currentMems: [{ id: "u1", dName: "Quản lý", zaloName: "QL" }],
          },
        },
      }),
      getGroupMembersInfo: async (ids) => ({
        profiles: Object.fromEntries(ids.map((id) => [`${id}_0`, { displayName: `Tên ${id}`, zaloName: id }])),
      }),
    };
    const first = await syncGroupMembers(db, source, group.id, "g-ban-hang");
    assert.deepEqual(first, { found: true, members: 3, left: 0 });
    const [rows] = await db.query<RowDataPacket[]>(
      "SELECT zalo_uid, display_name, is_admin, left_at FROM group_member ORDER BY zalo_uid");
    assert.deepEqual(rows.map((row) => [row.zalo_uid, row.display_name, row.is_admin]), [
      ["u1", "Quản lý", 1], ["u2", "Tên u2", 0], ["u3", "Tên u3", 0],
    ]);
    const saved = await findGroupByZaloId(db, "g-ban-hang");
    assert.equal(saved?.name, "Bán hàng miền Nam");

    members = ["u1_0", "u2_3"];
    assert.equal((await syncGroupMembers(db, source, group.id, "g-ban-hang")).left, 1);
    const [afterLeave] = await db.query<RowDataPacket[]>("SELECT left_at FROM group_member WHERE zalo_uid = 'u3'");
    assert.notEqual(afterLeave[0].left_at, null);

    members = ["u1_0", "u2_3", "u3_2"];
    await syncGroupMembers(db, source, group.id, "g-ban-hang");
    const [afterReturn] = await db.query<RowDataPacket[]>("SELECT left_at FROM group_member WHERE zalo_uid = 'u3'");
    assert.equal(afterReturn[0].left_at, null);
  });

  test("thu hồi tin: xóa chữ, giữ dòng + recalled_at", async () => {
    await enableGroup("g-ban-hang", false);
    await ingestGroupMessage({ db, defaults: { readMessages: false, captureFiles: false } }, botId, makeMessage());
    assert.equal(await recallGroupMessage(db, "g-ban-hang", "1001"), true);
    const [rows] = await db.query<RowDataPacket[]>("SELECT text, raw_content, recalled_at FROM message");
    assert.equal(rows[0].text, null);
    assert.notEqual(rows[0].recalled_at, null);
    assert.equal(await recallGroupMessage(db, "g-ban-hang", "1001"), false);
  });

  test("hết hạn lưu: xóa tin + tệp thật, tin còn hạn giữ nguyên", async () => {
    const group = await enableGroup("g-ban-hang", true);
    await updateGroupSettings(db, group.id, { retentionDays: 30 });
    const storage = new MemoryStorage();
    const downloader = new AttachmentDownloader(db, storage, { concurrency: 1, maxFileBytes: 1000 },
      async () => fakeResponse(200, "cu"));
    const deps = { db, defaults: { readMessages: false, captureFiles: false }, onAttachmentQueued: (id: number) => downloader.enqueue(id) };
    const old = Date.now() - 40 * 86_400_000;
    await ingestGroupMessage(deps, botId, makeMessage({ msgId: "cu", sentAtMs: old, msgType: "share.file",
      content: { title: "cu.pdf", href: "https://f/cu" } }));
    await ingestGroupMessage(deps, botId, makeMessage({ msgId: "moi", sentAtMs: Date.now() }));
    await downloader.drain();
    const storedKey = [...storage.files.keys()][0];

    const result = await purgeExpiredMessages(db, storage);
    assert.deepEqual(result, { messages: 1, files: 1 });
    assert.deepEqual(storage.deleted, [storedKey]);
    const [rows] = await db.query<RowDataPacket[]>("SELECT zalo_msg_id FROM message");
    assert.deepEqual(rows.map((row) => row.zalo_msg_id), ["moi"]);
    const [files] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM attachment");
    assert.equal(files[0].n, 0);
  });

  async function activeBots(zaloGroupId: string): Promise<number[]> {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT bg.bot_account_id FROM bot_group bg JOIN zalo_group g ON g.id = bg.group_id
       WHERE g.zalo_group_id = ? AND bg.left_at IS NULL ORDER BY bg.bot_account_id`, [zaloGroupId]);
    return rows.map((row) => row.bot_account_id as number);
  }

  test("tin đầu tiên của nhóm mới: ghi luôn bot đang ở nhóm", async () => {
    await ingestGroupMessage({ db, defaults: { readMessages: false, captureFiles: false } }, botId, makeMessage());
    assert.deepEqual(await activeBots("g-ban-hang"), [botId]);
  });

  test("hai bot cùng một nhóm: một dòng nhóm, tin lưu một lần; bot 1 rời thì bot 2 vẫn còn", async () => {
    const [second] = await db.query<any>("INSERT INTO bot_account (label, session_cipher) VALUES ('bot2', 'x')");
    const secondId = second.insertId as number;
    const first = await ensureGroup(db, "g-chung", { readMessages: true, captureFiles: false });
    const again = await ensureGroup(db, "g-chung", { readMessages: false, captureFiles: true });
    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(again.group.id, first.group.id);
    assert.equal(again.group.read_messages, 1);
    await markBotInGroup(db, botId, first.group.id);
    await markBotInGroup(db, secondId, first.group.id);

    const deps = { db, defaults: { readMessages: false, captureFiles: false } };
    assert.equal(await ingestGroupMessage(deps, botId, makeMessage({ zaloGroupId: "g-chung" })), "stored");
    assert.equal(await ingestGroupMessage(deps, secondId, makeMessage({ zaloGroupId: "g-chung" })), "duplicate");

    await markBotLeftGroup(db, botId, "g-chung");
    assert.deepEqual(await activeBots("g-chung"), [secondId]);
    // Quay lại nhóm thì gỡ mốc rời
    await markBotInGroup(db, botId, first.group.id);
    assert.deepEqual(await activeBots("g-chung"), [botId, secondId]);
  });

  test("khởi động lại: nhóm không còn trong danh sách Zalo thì bot đó rời; danh sách rỗng thì không đụng", async () => {
    const a = (await ensureGroup(db, "g-a", { readMessages: false, captureFiles: false })).group;
    const b = (await ensureGroup(db, "g-b", { readMessages: false, captureFiles: false })).group;
    await markBotInGroup(db, botId, a.id);
    await markBotInGroup(db, botId, b.id);
    assert.equal(await markBotLeftMissingGroups(db, botId, []), 0);
    assert.deepEqual(await activeBots("g-b"), [botId]);
    assert.equal(await markBotLeftMissingGroups(db, botId, [a.id]), 1);
    assert.deepEqual(await activeBots("g-a"), [botId]);
    assert.deepEqual(await activeBots("g-b"), []);
  });

  test("dọn quá hạn theo TỪNG nhóm: mỗi nhóm một thời hạn riêng", async () => {
    const short = await enableGroup("g-ngan", false);
    const long = await enableGroup("g-dai", false);
    await updateGroupSettings(db, short.id, { retentionDays: 7 });
    await updateGroupSettings(db, long.id, { retentionDays: 30 });
    const deps = { db, defaults: { readMessages: false, captureFiles: false } };
    const tenDaysAgo = Date.now() - 10 * 86_400_000;
    await ingestGroupMessage(deps, botId, makeMessage({ zaloGroupId: "g-ngan", msgId: "n1", sentAtMs: tenDaysAgo }));
    await ingestGroupMessage(deps, botId, makeMessage({ zaloGroupId: "g-dai", msgId: "d1", sentAtMs: tenDaysAgo }));
    const result = await purgeExpiredMessages(db, new MemoryStorage());
    assert.deepEqual(result, { messages: 1, files: 0 });
    const [rows] = await db.query<RowDataPacket[]>("SELECT zalo_msg_id FROM message");
    assert.deepEqual(rows.map((row) => row.zalo_msg_id), ["d1"]);
  });

  test("công ty: mã viết hoa, chặn trùng mã, gán nhóm vào công ty rồi gỡ ra", async () => {
    const companyId = await createCompany(db, "cty-hcm", "Công ty Hồ Chí Minh");
    await assert.rejects(createCompany(db, "CTY-HCM", "Trùng"), CompanyInputError);
    await assert.rejects(createCompany(db, "có dấu", "Sai mã"), CompanyInputError);
    const [company] = await db.query<RowDataPacket[]>("SELECT code, name FROM company WHERE id = ?", [companyId]);
    assert.deepEqual({ ...company[0] }, { code: "CTY-HCM", name: "Công ty Hồ Chí Minh" });

    const group = await enableGroup("g-ban-hang", false);
    assert.equal(group.company_id, null);
    await updateGroupSettings(db, group.id, { companyId });
    assert.equal((await findGroupByZaloId(db, "g-ban-hang"))?.company_id, companyId);
    await updateGroupSettings(db, group.id, { companyId: null });
    assert.equal((await findGroupByZaloId(db, "g-ban-hang"))?.company_id, null);
  });
  test("ảnh đại diện: chỉ tải từ máy chủ Zalo, lưu vào kho; ảnh hỏng không thử lại cho tới khi đổi link", async () => {
    await db.query(`INSERT INTO contact (zalo_uid, display_name, avatar_url) VALUES
      ('u-ok', 'Có ảnh', 'https://s120-ava-talk.zadn.vn/a/b.jpg'),
      ('u-hong', 'Ảnh hỏng', 'https://s120-ava-talk.zadn.vn/x/y.jpg'),
      ('u-la', 'Link lạ', 'https://ke-xau.example.com/a.jpg')`);
    const storage = new MemoryStorage();
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      return url.includes("/x/") ? fakeResponse(404) : fakeResponse(200, "anh", { "content-type": "image/jpeg" });
    };
    assert.equal(await cacheAvatars(db, storage, fetcher), 1);
    assert.deepEqual(calls, ["https://s120-ava-talk.zadn.vn/a/b.jpg", "https://s120-ava-talk.zadn.vn/x/y.jpg"]); // link lạ: không gọi
    const [rows] = await db.query<RowDataPacket[]>("SELECT zalo_uid, avatar_key FROM contact ORDER BY zalo_uid");
    assert.deepEqual(rows.map((row) => [row.zalo_uid, row.avatar_key]), [["u-hong", null], ["u-la", null], ["u-ok", "avatars/c/u-ok.jpg"]]);
    // Chạy lại: không ai cần tải nữa (kể cả ảnh hỏng — đợi Zalo đổi link)
    calls.length = 0;
    assert.equal(await cacheAvatars(db, storage, fetcher), 0);
    assert.deepEqual(calls, []);
    // Đổi link ảnh → tải lại
    await db.query("UPDATE contact SET avatar_url = 'https://s120-ava-talk.zadn.vn/a/moi.jpg' WHERE zalo_uid = 'u-ok'");
    assert.equal(await cacheAvatars(db, storage, fetcher), 1);
    assert.equal(isZaloImageUrl("http://s120-ava-talk.zadn.vn/a.jpg"), false); // không https
    assert.equal(isZaloImageUrl("https://zadn.vn.ke-xau.com/a.jpg"), false);
  });
});
