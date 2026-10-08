import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

/**
 * Chạy lần lượt các tệp migrations/NNN_*.sql chưa chạy. Mỗi tệp chạy trọn một lần, ghi tên vào
 * schema_migration. Không có bước lùi: muốn sửa lược đồ thì thêm tệp mới.
 */
export async function runMigrations(databaseUrl: string): Promise<string[]> {
  // Kết nối riêng có multipleStatements — chỉ dùng cho migration, không dùng cho pool chính
  const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
  try {
    // Từ 08/10/2026 có hai tiến trình (app + worker) cùng khởi động — khóa tên để không ai chạy trùng một tệp
    const [locked] = await connection.query("SELECT GET_LOCK('bot_tro_ly_migrate', 120) AS ok");
    if (Number((locked as { ok: number }[])[0]?.ok) !== 1) throw new Error("chờ khóa migration quá 120 giây");
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migration (
         name VARCHAR(200) NOT NULL PRIMARY KEY,
         applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    const [rows] = await connection.query("SELECT name FROM schema_migration");
    const applied = new Set((rows as { name: string }[]).map((row) => row.name));
    const pending = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name) => /^\d{3}_.+\.sql$/.test(name) && !applied.has(name))
      .sort();
    for (const name of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
      await connection.query(sql);
      await connection.query("INSERT INTO schema_migration (name) VALUES (?)", [name]);
    }
    return pending;
  } finally {
    await connection.end();
  }
}
