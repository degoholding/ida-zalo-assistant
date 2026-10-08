import fs from "node:fs/promises";
import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import type { R2WithLocalFallback } from "./file-storage.js";

// Chép tệp còn nằm ở đĩa lên R2 (lệnh `npm run cli -- storage-to-r2`, 08/10/2026). Mỗi khóa: đọc đĩa → ghi R2 → đổi
// khóa trong CSDL → xóa tệp đĩa. Chạy lại bao nhiêu lần cũng được: khóa đã mang tiền tố R2 thì bỏ qua. Bot vẫn chạy
// trong lúc chép (R2WithLocalFallback đọc khóa cũ ở đĩa).

/** Cột chứa khóa tệp trong kho. */
const KEY_COLUMNS = [
  { table: "attachment", id: "id", column: "storage_key" },
  { table: "contact", id: "id", column: "avatar_key" },
  { table: "zalo_group", id: "id", column: "avatar_key" },
] as const;

const BATCH = 200;

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8",
};

const contentTypeOf = (key: string) => CONTENT_TYPES[(/\.([a-z0-9]{1,10})$/i.exec(key)?.[1] ?? "").toLowerCase()] ?? "application/octet-stream";

export interface MoveResult {
  moved: number;
  missing: number;
  failed: number;
}

export async function moveLocalFilesToR2(db: Db, storage: R2WithLocalFallback, report: (line: string) => void = () => undefined): Promise<MoveResult> {
  const result: MoveResult = { moved: 0, missing: 0, failed: 0 };
  for (const target of KEY_COLUMNS) {
    // Khóa đã thử mà hỏng thì nhớ để vòng sau không lấy lại mãi
    const skipped = new Set<number>();
    for (;;) {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT ${target.id} AS id, ${target.column} AS storage_key FROM ${target.table}
         WHERE ${target.column} IS NOT NULL AND ${target.column} <> '' AND ${target.column} NOT LIKE ? ${skipped.size ? `AND ${target.id} NOT IN (?)` : ""}
         ORDER BY ${target.id} LIMIT ?`,
        skipped.size ? [`${storage.r2Prefix}%`, [...skipped], BATCH] : [`${storage.r2Prefix}%`, BATCH],
      );
      if (!rows.length) break;
      for (const row of rows) {
        const id = Number(row.id);
        const key = String(row.storage_key);
        const localPath = storage.local.pathOf(key);
        let body: Buffer;
        try {
          body = await fs.readFile(localPath);
        } catch {
          // Tệp đã mất trên đĩa — không có gì để chép; để nguyên dòng, ghi nhận
          result.missing += 1;
          skipped.add(id);
          continue;
        }
        try {
          const newKey = await storage.r2.put(key, body, contentTypeOf(key));
          await db.query(`UPDATE ${target.table} SET ${target.column} = ? WHERE ${target.id} = ? AND ${target.column} = ?`, [newKey, id, key]);
          await fs.rm(localPath, { force: true });
          result.moved += 1;
        } catch (error) {
          result.failed += 1;
          skipped.add(id);
          report(`lỗi ${target.table}#${id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      report(`${target.table}: đã chép ${result.moved} tệp`);
    }
  }
  return result;
}
