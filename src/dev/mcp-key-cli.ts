import type { RowDataPacket } from "mysql2";
import { McpAccessLevel } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createMcpKey, listMcpKeys, revokeMcpKey } from "../auth/mcp-api-key-store.js";

// Lệnh `mcp-key` của src/cli.ts — tạo / liệt kê / thu hồi khóa MCP trước khi có màn web.
//   npm run cli -- mcp-key create <tên đăng nhập|email> <tên khóa> [read|write] [--days N] [--confidential]
//   npm run cli -- mcp-key list [<tên đăng nhập|email>]
//   npm run cli -- mcp-key revoke <id>

const USAGE = [
  "Cú pháp:",
  '  npm run cli -- mcp-key create <tên đăng nhập|email> "<tên khóa>" [read|write] [--days N] [--confidential]',
  "  npm run cli -- mcp-key list [<tên đăng nhập|email>]",
  "  npm run cli -- mcp-key revoke <id>",
].join("\n");

export interface ParsedCreateArgs {
  login: string;
  name: string;
  accessLevel: McpAccessLevel;
  days: number | null;
  includeConfidential: boolean;
}

/** Tách tham số lệnh create; ném Error tiếng Việt khi sai cú pháp. Hàm thuần để kiểm thử. */
export function parseCreateArgs(args: string[]): ParsedCreateArgs {
  const positional: string[] = [];
  let days: number | null = null;
  let includeConfidential = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--confidential") includeConfidential = true;
    else if (arg === "--days") {
      const raw = args[++index];
      days = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isInteger(days) || days < 1) throw new Error("--days phải là số ngày nguyên dương");
    } else if (arg.startsWith("--")) throw new Error(`Không hiểu tùy chọn ${arg}\n${USAGE}`);
    else positional.push(arg);
  }
  const [login, name, level, ...extra] = positional;
  if (!login || !name || extra.length) throw new Error(USAGE);
  if (level !== undefined && level !== "read" && level !== "write") throw new Error("Mức quyền chỉ nhận read | write");
  return { login, name, accessLevel: level === "write" ? McpAccessLevel.ReadWrite : McpAccessLevel.Read, days, includeConfidential };
}

async function findUserId(db: Db, login: string): Promise<number> {
  const key = login.trim().toLowerCase();
  const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM app_user WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1", [key, key]);
  if (!rows[0]) throw new Error(`Không có người dùng «${login}»`);
  return Number(rows[0].id);
}

export async function runMcpKeyCommand(db: Db, args: string[]): Promise<void> {
  const [action, ...rest] = args;
  if (action === "create") {
    const parsed = parseCreateArgs(rest);
    const created = await createMcpKey(db, { userId: await findUserId(db, parsed.login), name: parsed.name, accessLevel: parsed.accessLevel,
      days: parsed.days, includeConfidential: parsed.includeConfidential });
    console.log(`Đã tạo khóa #${created.id} (tiền tố ${created.prefix}). LƯU NGAY, không xem lại được:\n\n${created.token}\n`);
    console.log("Dùng: Authorization: Bearer <khóa> khi gọi máy chủ MCP.");
  } else if (action === "list") {
    const keys = await listMcpKeys(db, rest[0] ? await findUserId(db, rest[0]) : undefined);
    console.table(keys.map((key) => ({
      id: key.id, nguoi_dung: key.ownerName, ten: key.name, tien_to: key.prefix, muc: key.accessLevel === McpAccessLevel.ReadWrite ? "doc+ghi" : "doc",
      mat: key.includeConfidential ? "co" : "khong", het_han: key.expiresAt?.toISOString() ?? "", dung_cuoi: key.lastUsedAt?.toISOString() ?? "",
      thu_hoi: key.revokedAt?.toISOString() ?? "",
    })));
  } else if (action === "revoke") {
    const id = Number(rest[0]);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(USAGE);
    console.log(await revokeMcpKey(db, id, "Dòng lệnh") ? `Đã thu hồi khóa #${id}.` : `Khóa #${id} không có hoặc đã thu hồi từ trước.`);
  } else throw new Error(USAGE);
}
