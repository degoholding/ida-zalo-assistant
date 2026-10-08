import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "../logger.js";
import { R2WithLocalFallback, type FileStorage } from "./file-storage.js";

// Đưa bản sao lưu CSDL (service `backup` ghi vào thư mục /backups mỗi ngày) lên R2 dưới «backups/», và xóa bản trên R2
// cũ hơn `keepDays` ngày. Kho chưa bật R2 thì thôi — bản sao lưu chỉ nằm trên đĩa máy chủ (giữ 7 ngày).

const log = createLogger("backup");
const FILE_PATTERN = /^bot_tro_ly_\d{8}\.sql\.gz$/;

export interface BackupUploadResult {
  uploaded: number;
  pruned: number;
  /** Lý do không làm gì (chưa bật R2, không có thư mục) — rỗng là có chạy. */
  skipped: string;
}

export async function uploadBackups(storage: FileStorage, backupDir: string, keepDays: number, now: Date = new Date()): Promise<BackupUploadResult> {
  if (!(storage instanceof R2WithLocalFallback)) return { uploaded: 0, pruned: 0, skipped: "kho tệp chưa bật R2" };
  const names = (await fs.readdir(backupDir).catch(() => null))?.filter((name) => FILE_PATTERN.test(name));
  if (!names) return { uploaded: 0, pruned: 0, skipped: `không có thư mục ${backupDir}` };
  const remote = await storage.list("backups/");
  const remoteNames = new Set(remote.map((item) => item.key.split("/").pop()));
  let uploaded = 0;
  for (const name of names.sort()) {
    if (remoteNames.has(name)) continue;
    await storage.put(`backups/${name}`, await fs.readFile(path.join(backupDir, name)), "application/gzip");
    uploaded += 1;
    log.info(`đã đưa bản sao lưu ${name} lên R2`);
  }
  const cutoff = now.getTime() - keepDays * 86_400_000;
  let pruned = 0;
  for (const item of remote) {
    if (item.lastModified.getTime() >= cutoff) continue;
    await storage.delete(item.key);
    pruned += 1;
  }
  if (pruned) log.info(`đã xóa ${pruned} bản sao lưu cũ hơn ${keepDays} ngày trên R2`);
  return { uploaded, pruned, skipped: "" };
}
