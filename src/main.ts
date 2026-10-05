// Dịch vụ đồng bộ: chạy mọi tài khoản bot đã đăng nhập, lưu tin nhóm + thành viên + file,
// kèm giao diện web quản trị (đăng nhập QR, cấu hình nhóm, tải file).

import { loadConfig } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { createLogger } from "./logger.js";
import { SettingsStore } from "./settings/settings-store.js";
import { createFileStorage } from "./storage/file-storage.js";
import { purgeExpiredMessages } from "./sync/retention.js";
import { SyncService } from "./sync-service.js";
import { startWebServer } from "./web/server.js";

const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const log = createLogger("main");

const config = loadConfig();
const applied = await runMigrations(config.databaseUrl);
if (applied.length) log.info(`đã chạy migration: ${applied.join(", ")}`);

const db = createPool(config.databaseUrl);
// Cài đặt đặt trên web (bảng app_setting) phủ lên .env — phải nạp TRƯỚC khi dựng trợ lý / runner
const settings = new SettingsStore(db, config);
await settings.load();
const storage = createFileStorage(config);
const service = new SyncService(db, config, storage, settings);
await service.startAll();
const web = await startWebServer(service);

const retentionTimer = setInterval(() => {
  purgeExpiredMessages(db, storage).catch((error) => log.error("dọn tin quá hạn lỗi", error));
}, RETENTION_INTERVAL_MS);

async function shutdown(signal: string): Promise<void> {
  log.info(`nhận ${signal}, đang tắt`);
  clearInterval(retentionTimer);
  web.close();
  await service.stopAll();
  await db.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
