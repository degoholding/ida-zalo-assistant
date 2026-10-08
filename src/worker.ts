// Tiến trình nền (08/10/2026, phase 3): việc không cần phiên Zalo — dọn tin quá hạn, tải ảnh đại diện, dọn hàng đợi;
// bước sau thêm bộ lập lịch (bản tin sáng, nhắc tin chờ, phân loại tin theo lô). Tách khỏi tiến trình chính để việc
// nặng / chạy lâu không làm chậm việc nghe tin và trả lời. Docker compose: service `worker`, cùng image với `app`.

import { startBackgroundTasks } from "./background.js";
import { loadConfig } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { createLogger } from "./logger.js";
import { SettingsStore } from "./settings/settings-store.js";
import { createFileStorage } from "./storage/file-storage.js";

const log = createLogger("worker");

const config = loadConfig();
// Cả hai tiến trình đều gọi — khóa tên trong runMigrations giữ cho mỗi tệp chỉ chạy một lần
await runMigrations(config.databaseUrl);
const db = createPool(config.databaseUrl);
const settings = new SettingsStore(db, config);
await settings.load();
const storage = createFileStorage(config);
const background = await startBackgroundTasks(db, storage, config);
// Cài đặt sửa trên web (tiến trình app ghi app_setting) — worker đọc lại định kỳ để lịch làm việc, hạn giữ… có hiệu lực
const SETTINGS_RELOAD_MS = 60_000;
const settingsTimer = setInterval(() => {
  settings.load().catch((error) => log.warn("đọc lại cài đặt lỗi", error));
}, SETTINGS_RELOAD_MS);
log.info("tiến trình nền đã chạy");

async function shutdown(signal: string): Promise<void> {
  log.info(`nhận ${signal}, đang tắt`);
  clearInterval(settingsTimer);
  background.stop();
  await db.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
