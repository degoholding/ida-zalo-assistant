// Dòng lệnh quản trị — thay cho màn hình quản lý ở bản đồng bộ cơ bản.
//
//   npm run cli -- gen-key                      tạo SESSION_ENCRYPTION_KEY
//   npm run cli -- login <nhãn>                 quét QR đăng nhập một tài khoản bot
//   npm run cli -- accounts                     danh sách tài khoản bot + trạng thái
//   npm run cli -- groups                       danh sách nhóm + cấu hình
//   npm run cli -- company                      danh sách công ty
//   npm run cli -- company add <MÃ> "Tên"       thêm công ty
//   npm run cli -- group <mã nhóm> read=on files=on label="Bán hàng A" retention=730 company=<MÃ>
//   npm run cli -- stats                        số đo 24 giờ qua

import fs from "node:fs";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import { LoginQRCallbackEventType, Zalo } from "zca-js";
import { loadConfig } from "./config.js";
import { AttachmentStatus, BotAccountStatus, SessionEvent } from "./constants.js";
import { encryptJson, generateKey } from "./crypto/session-cipher.js";
import { runMigrations } from "./db/migrate.js";
import { createPool, type Db } from "./db/pool.js";
import { createCompany, findCompanyByCode, listCompanies } from "./sync/company-repository.js";
import { findGroupByZaloId, updateGroupSettings, type GroupSettingsPatch } from "./sync/group-repository.js";
import { saveLoggedInAccount } from "./zalo/bot-account-repository.js";

const [command, ...args] = process.argv.slice(2);

function parseOnOff(value: string, name: string): boolean {
  if (["on", "1", "true", "bat"].includes(value)) return true;
  if (["off", "0", "false", "tat"].includes(value)) return false;
  throw new Error(`${name} chỉ nhận on | off`);
}

async function loginAccount(db: Db, label: string, dataDir: string, encryptionKey: string): Promise<void> {
  const qrPath = path.resolve(dataDir, `qr-${label}.png`);
  fs.mkdirSync(path.dirname(qrPath), { recursive: true });
  let loginInfo: unknown = null;
  const api = await new Zalo({ selfListen: false, checkUpdate: false, logging: false }).loginQR(
    { qrPath },
    async (event) => {
      if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
        await event.actions.saveToFile(qrPath);
        console.log(`Mở ${qrPath} rồi quét bằng app Zalo của tài khoản bot (mã QR sống khoảng 1 phút).`);
      } else if (event.type === LoginQRCallbackEventType.QRCodeExpired) {
        console.log("Mã QR hết hạn — đang sinh mã mới.");
        event.actions.retry();
      } else if (event.type === LoginQRCallbackEventType.QRCodeScanned) {
        console.log(`Đã quét bởi «${event.data.display_name}» — bấm Đăng nhập trên điện thoại.`);
      } else if (event.type === LoginQRCallbackEventType.QRCodeDeclined) {
        console.log("Điện thoại đã từ chối đăng nhập.");
        // zca-js bỏ lửng promise ở nhánh này — không hủy là lệnh treo mãi
        event.actions.abort();
      } else if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
        loginInfo = event.data;
      }
    },
  );
  fs.rmSync(qrPath, { force: true });
  if (!loginInfo) throw new Error("Đăng nhập xong nhưng không nhận được phiên");
  const ownUid = api.getOwnId();
  const profile = await api.fetchAccountInfo().catch(() => null);
  const displayName = (profile as { profile?: { displayName?: string } } | null)?.profile?.displayName ?? "";
  const accountId = await saveLoggedInAccount(db, label, ownUid, displayName, encryptJson(loginInfo, encryptionKey));
  api.listener.stop();
  console.log(`Đã lưu tài khoản bot #${accountId} «${label}» (uid ${ownUid}). Khởi động lại dịch vụ để bắt đầu nghe.`);
  console.log("Lưu ý: đừng mở Zalo Web bằng tài khoản này — mỗi tài khoản chỉ một phiên web, mở là bot bị đá.");
}

async function listAccounts(db: Db): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, label, zalo_uid, display_name, status, is_active, last_connected_at, last_heartbeat_at FROM bot_account ORDER BY id",
  );
  console.table(rows.map((row) => ({ ...row, status: BotAccountStatus[row.status as number] })));
}

async function listGroups(db: Db): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT g.zalo_group_id, g.name, g.label, IF(g.group_kind = 2, 'noi bo', 'khach hang') AS loai, c.code AS cong_ty, g.member_count, g.read_messages AS doc_tin,
            g.capture_files AS lay_file, g.retention_days AS giu_ngay,
            (SELECT COUNT(*) FROM bot_group bg WHERE bg.group_id = g.id AND bg.left_at IS NULL) AS so_bot,
            (SELECT COUNT(*) FROM message m WHERE m.group_id = g.id) AS so_tin
     FROM zalo_group g LEFT JOIN company c ON c.id = g.company_id
     WHERE g.thread_type = 1
     ORDER BY g.read_messages DESC, g.name`,
  );
  console.table(rows);
}

async function manageCompanies(db: Db, args: string[]): Promise<void> {
  if (args[0] === "add") {
    const [code, ...nameParts] = args.slice(1);
    if (!code || !nameParts.length) throw new Error('Cú pháp: npm run cli -- company add <MÃ> "Tên công ty"');
    const id = await createCompany(db, code, nameParts.join(" "));
    console.log(`Đã thêm công ty #${id} ${code.toUpperCase()}.`);
    return;
  }
  console.table(await listCompanies(db));
}

async function configureGroup(db: Db, zaloGroupId: string, settings: string[]): Promise<void> {
  const group = await findGroupByZaloId(db, zaloGroupId);
  if (!group) throw new Error(`Không có nhóm ${zaloGroupId} — xem mã nhóm bằng: npm run cli -- groups`);
  const patch: GroupSettingsPatch = {};
  for (const setting of settings) {
    const [key, ...rest] = setting.split("=");
    const value = rest.join("=");
    if (key === "read") patch.readMessages = parseOnOff(value, "read");
    else if (key === "files") patch.captureFiles = parseOnOff(value, "files");
    else if (key === "label") patch.label = value;
    else if (key === "kind") {
      if (value === "khach" || value === "customer") patch.groupKind = 1;
      else if (value === "noibo" || value === "internal") patch.groupKind = 2;
      else throw new Error("kind chỉ nhận khach | noibo");
    }
    else if (key === "company") {
      if (value === "" || value === "none") patch.companyId = null;
      else {
        const company = await findCompanyByCode(db, value);
        if (!company) throw new Error(`Không có công ty mã ${value.toUpperCase()} — xem: npm run cli -- company`);
        patch.companyId = company.id;
      }
    }
    else if (key === "retention") {
      const days = Number(value);
      if (!Number.isInteger(days) || days < 1) throw new Error("retention phải là số ngày nguyên dương");
      patch.retentionDays = days;
    } else throw new Error(`Không hiểu "${setting}" — dùng read= files= label= retention= company=`);
  }
  await updateGroupSettings(db, group.id, patch);
  console.log(`Đã cập nhật nhóm «${group.name || zaloGroupId}». Có hiệu lực ngay với tin tới sau.`);
}

async function showStats(db: Db): Promise<void> {
  const [messages] = await db.query<RowDataPacket[]>(
    `SELECT g.name, COUNT(*) AS tin_24h FROM message m JOIN zalo_group g ON g.id = m.group_id
     WHERE m.created_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY GROUP BY g.id ORDER BY tin_24h DESC`,
  );
  console.log("Tin 24 giờ qua theo nhóm:");
  console.table(messages);
  const [files] = await db.query<RowDataPacket[]>("SELECT status, COUNT(*) AS so FROM attachment GROUP BY status");
  console.log("Tệp theo trạng thái:");
  console.table(files.map((row) => ({ trang_thai: AttachmentStatus[row.status as number], so: row.so })));
  const [events] = await db.query<RowDataPacket[]>(
    `SELECT a.label, e.event, e.code, e.detail, e.created_at FROM session_event e
     JOIN bot_account a ON a.id = e.bot_account_id
     WHERE e.created_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY ORDER BY e.id DESC LIMIT 30`,
  );
  console.log("Sự kiện phiên 24 giờ qua:");
  console.table(events.map((row) => ({ ...row, event: SessionEvent[row.event as number] })));
}

async function main(): Promise<void> {
  if (command === "gen-key") {
    console.log(generateKey());
    return;
  }
  const config = loadConfig();
  await runMigrations(config.databaseUrl);
  const db = createPool(config.databaseUrl);
  try {
    if (command === "login") {
      const label = args[0];
      if (!label) throw new Error("Thiếu nhãn tài khoản: npm run cli -- login <nhãn>");
      await loginAccount(db, label, config.dataDir, config.sessionEncryptionKey);
    } else if (command === "accounts") await listAccounts(db);
    else if (command === "groups") await listGroups(db);
    else if (command === "company") await manageCompanies(db, args);
    else if (command === "group") {
      if (!args[0] || args.length < 2) throw new Error('Cú pháp: npm run cli -- group <mã nhóm> read=on files=on');
      await configureGroup(db, args[0], args.slice(1));
    } else if (command === "stats") await showStats(db);
    else {
      console.log("Lệnh: gen-key | login <nhãn> | accounts | groups | company [add <MÃ> <tên>] | group <mã> read=on|off files=on|off label=.. retention=.. company=<MÃ>|none | stats");
      process.exitCode = 1;
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
