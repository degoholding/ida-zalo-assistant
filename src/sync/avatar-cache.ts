import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import type { FileStorage } from "../storage/file-storage.js";
import type { Fetcher } from "./attachment-downloader.js";

// Tải ảnh đại diện Zalo về kho. Chạy nền theo lô: chọn những người / nhóm có avatar_url mới hơn bản đã
// tải (avatar_source), tải về, ghi avatar_key. Ảnh hỏng thì ghi nhận source để khỏi thử lại liên tục —
// lần sau Zalo đổi link ảnh thì tự thử lại.

const BATCH_SIZE = 30;
// Mỗi lượt chạy tối đa ngần này lô — lần đầu (vài trăm thành viên) xong trong một lượt, khỏi đợi nhiều chu kỳ
const MAX_BATCHES_PER_RUN = 20;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const log = createLogger("avatar");

const ALLOWED_HOST = /(^|\.)(zadn\.vn|zdn\.vn|zalo\.me|zaloapp\.com)$/i;

/** Chỉ tải ảnh từ máy chủ Zalo — link nằm trong dữ liệu Zalo trả về, nhưng đừng tin mù. */
export function isZaloImageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ALLOWED_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

async function download(fetcher: Fetcher, url: string): Promise<{ body: Buffer; contentType: string } | null> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) return null;
  const body = Buffer.from(await response.arrayBuffer());
  return body.length && body.length <= MAX_AVATAR_BYTES ? { body, contentType } : null;
}

export async function cacheAvatars(db: Db, storage: FileStorage, fetcher: Fetcher = fetch): Promise<number> {
  let stored = 0;
  const targets: { table: "contact" | "zalo_group"; idColumn: string; prefix: string }[] = [
    { table: "contact", idColumn: "zalo_uid", prefix: "avatars/c/" },
    { table: "zalo_group", idColumn: "id", prefix: "avatars/g/" },
  ];
  for (const target of targets) for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, ${target.idColumn} AS ident, avatar_url, avatar_key FROM ${target.table}
       WHERE avatar_url <> '' AND avatar_url <> avatar_source LIMIT ?`,
      [BATCH_SIZE],
    );
    if (!rows.length) break;
    for (const row of rows) {
      const url = String(row.avatar_url);
      let key: string | null = row.avatar_key ?? null;
      try {
        const image = isZaloImageUrl(url) ? await download(fetcher, url) : null;
        if (image) {
          const extension = image.contentType.includes("png") ? "png" : image.contentType.includes("webp") ? "webp" : "jpg";
          key = await storage.put(`${target.prefix}${row.ident}.${extension}`, image.body, image.contentType);
          stored += 1;
        }
      } catch (error) {
        log.warn(`tải ảnh ${target.table} ${row.ident} lỗi: ${describeError(error)}`);
      }
      // Ghi source dù tải được hay không — hỏng thì đợi Zalo đổi link mới thử lại, khỏi dội lên Zalo
      await db.query(`UPDATE ${target.table} SET avatar_source = ?, avatar_key = ? WHERE id = ?`, [url, key, row.id]);
    }
  }
  if (stored) log.info(`đã lưu ${stored} ảnh đại diện`);
  return stored;
}
