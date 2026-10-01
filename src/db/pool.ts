import mysql from "mysql2/promise";

export type Db = mysql.Pool;

export function createPool(databaseUrl: string): Db {
  return mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    charset: "utf8mb4_unicode_ci",
    // Lưu và đọc giờ theo UTC — hiển thị đổi múi giờ ở tầng trả lời
    timezone: "Z",
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
}
