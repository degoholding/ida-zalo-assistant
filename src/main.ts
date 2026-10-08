// Dịch vụ đồng bộ: chạy mọi tài khoản bot đã đăng nhập, lưu tin nhóm + thành viên + file, trả lời câu hỏi qua hàng
// đợi việc, kèm giao diện web quản trị (đăng nhập QR, cấu hình nhóm, tải file). Việc nền (dọn quá hạn, ảnh đại diện…)
// chạy ở tiến trình worker riêng (src/worker.ts), hoặc ngay đây khi WORKER_EMBEDDED=true.

import { AiKeyStore } from "./assistant/ai-key-store.js";
import { loadConfig } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { createLogger } from "./logger.js";
import { SettingsStore } from "./settings/settings-store.js";
import { createFileStorage } from "./storage/file-storage.js";
import { startBackgroundTasks } from "./background.js";
import { SyncService } from "./sync-service.js";
import { recordAudit } from "./web/api/audit-log.js";
import { startWebServer } from "./web/server.js";

const log = createLogger("main");

const config = loadConfig();
const applied = await runMigrations(config.databaseUrl);
if (applied.length) log.info(`đã chạy migration: ${applied.join(", ")}`);

const db = createPool(config.databaseUrl);
// Cài đặt đặt trên web (bảng app_setting) phủ lên .env — phải nạp TRƯỚC khi dựng trợ lý / runner
const settings = new SettingsStore(db, config);
await settings.load();
// Bảng Khóa AI: lần đầu (bảng chưa từng có dòng) chép khóa từ cài đặt cũ theo đúng thứ tự đang dùng — phải sau settings.load()
const aiKeys = new AiKeyStore(db, config.sessionEncryptionKey);
const migratedKeys = await aiKeys.migrateLegacyKeys(config.assistant);
if (migratedKeys.length) {
  log.info(`đã chép ${migratedKeys.length} khóa AI từ cài đặt cũ sang bảng Khóa AI`);
  await recordAudit(db, { entity: "setting", entityId: 1, action: "create", message: `Khóa AI: chép ${migratedKeys.length} khóa từ cài đặt cũ (giữ thứ tự đang dùng)` });
}
await aiKeys.load();
const storage = createFileStorage(config);
const service = new SyncService(db, config, storage, settings, aiKeys);
await service.startAll();
const web = await startWebServer(service);

const background = config.workerEmbedded ? await startBackgroundTasks(db, storage, config) : null;
log.info(config.workerEmbedded ? "việc nền chạy ngay trong tiến trình này (WORKER_EMBEDDED)" : "việc nền do tiến trình worker chạy");

async function shutdown(signal: string): Promise<void> {
  log.info(`nhận ${signal}, đang tắt`);
  background?.stop();
  web.close();
  await service.stopAll();
  await db.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
