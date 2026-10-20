import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ASSISTANT_FAMILIES } from "../data-access/tool-definition.js";

// Luật cấm truy cập dữ liệu trực tiếp (O5): mã trợ lý KHÔNG đọc / ghi dữ liệu nghiệp vụ bằng `db.query` hay import repository / dịch vụ miền —
// mọi truy cập đi qua công cụ MCP. Tệp còn vi phạm phải có dấu ở đầu tệp (5 dòng đầu):
//   `// mcp-guard: infra — <lý do>`      CHỈ hợp lệ trong src/assistant/infra/ (hạ tầng của chính trợ lý, ngoài MCP)
//   `// mcp-guard: legacy(<họ>) — <lý do>` đường cũ, gỡ ở phase 13 cùng họ công cụ
// Dấu thừa (tệp không vi phạm) = đỏ; tệp vi phạm không dấu = đỏ. `src/assistant/mcp-bridge/` CŨNG bị quét; chỉ vài tệp cầu nối có lý do chính đáng
// (nối với danh mục / mã lỗi của lõi) nằm trong danh sách miễn `BRIDGE_ALLOWLIST` bên dưới — mỗi tệp một lý do, và danh sách phải còn đúng (tệp có thật + còn vi phạm).
// Bắt: `.query(` / `.execute(` / `getConnection`, bí danh (`const { query } = db`, `= db.query;`, `.query.bind`, `db["query"]`), import tĩnh + `import()` động,
// module chứa SQL theo tên (`*-sql-*`, `ticket-visibility`, `brief-ai-highlights`).

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCAN_DIRS = ["src/assistant"];
/** Tệp cầu nối được miễn quét (đường dẫn → lý do). Thêm tệp mới vào đây phải có lý do; tệp không còn vi phạm thì gỡ khỏi danh sách (test đỏ). */
const BRIDGE_ALLOWLIST: Readonly<Record<string, string>> = {
  "src/assistant/mcp-bridge/assistant-mcp-turn.ts": "dựng phiên MCP: cần danh mục công cụ (ALL_TOOLS) của lõi",
  "src/assistant/mcp-bridge/draft-confirm-via-mcp.ts": "so khớp câu «không thấy nháp» với hằng của họ drafts ở lõi",
};
const SCAN_FILES = [
  "src/tickets/ticket-tools.ts", "src/tickets/ticket-commands.ts", "src/tickets/ticket-commands-legacy.ts", "src/tickets/ticket-tools-legacy.ts", "src/tasks/task-tools.ts", "src/tasks/task-commands.ts",
  "src/metrics/metric-query-tool.ts", "src/send-commands/send-command-tool.ts", "src/send-commands/send-reminder-tool.ts",
  "src/send-commands/send-pin-tool.ts", "src/send-commands/send-meeting-announcement-tool.ts", "src/send-commands/send-command-chat.ts",
  "src/send-commands/send-command-context.ts", "src/briefs/brief-tool.ts", "src/briefs/brief-commands.ts",
  "src/reply-suggestions/reply-suggestion-tool.ts", "src/reply-suggestions/reply-suggestion-service.ts", "src/reply-suggestions/reply-source-loader.ts",
];

const DB_NAME = String.raw`\b(?:db|pool|conn|connection)\b`;
export const DIRECT_CALL = new RegExp([
  String.raw`\.query\s*[(<]`, String.raw`\.execute\s*\(`, "getConnection",
  // bí danh: `const { query } = db`, `const q = db.query;`, `db.query.bind(db)`, `db["query"]`
  String.raw`\{[^{}]*\b(?:query|execute)\b[^{}]*\}\s*=\s*[\w.]*${DB_NAME}`,
  String.raw`=\s*[\w.]*${DB_NAME}[\w.]*\.(?:query|execute)\s*[;,)]`,
  String.raw`\.(?:query|execute)\.bind\b`,
  String.raw`${DB_NAME}\w*\s*\[\s*["'](?:query|execute)["']\s*\]`,
].join("|"));
const STORE_SUFFIX = /-(repository|store|queries|collectors)$/;
const DOMAIN_SERVICES = new Set(["task-service", "ticket-service", "alert-service", "metric-query-service", "send-command-draft-service", "reply-suggestion-service", "send-command-actions"]);
const FORBIDDEN_MODULES = ["src/db/pool", "src/web/api/scope", "src/web/api/list-query", "src/sync/contact-search"];
/** Module chứa SQL mà tên không có hậu tố kho: theo tên chứa `-sql-` + hai tệp biết trước. Chỉ nhập lớp lỗi (`…Error`) / kiểu thì được (thuần, không đụng DB). */
const SQL_BASENAMES = new Set(["ticket-visibility", "brief-ai-highlights"]);
const isSqlModule = (base: string) => base.includes("-sql-") || SQL_BASENAMES.has(base);
// Module thuần (hằng / hàm không đụng DB): lỗi, hiệu ứng lượt, giờ VN, kiểu công cụ, luật nhóm + lời nhắc họ lõi
const PURE_DATA_ACCESS = new Set(["data-access-errors", "turn-effects", "vn-time", "tool-definition", "group-scope-guard", "core-family-instructions"]);
const MARKER = /\/\/\s*mcp-guard:\s*(infra|legacy\(([a-z]+)\))/;

/** Bỏ chú thích (dòng `//`, khối, đuôi ` //`) để mẫu cấm không bắt nhầm lời giải thích. Chuỗi chứa `://` (URL) không bị cắt. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");

interface ValueImport {
  specifier: string;
  /** Tên nhập có tên (đã bỏ `type`); null = import động / mặc định / `* as` — không biết tên. */
  names: string[] | null;
}

export function forbiddenImport(file: string, { specifier, names }: ValueImport): boolean {
  if (!specifier.startsWith(".")) return false;
  const target = path.relative(ROOT, path.resolve(ROOT, path.dirname(file), specifier)).replace(/\.js$/, "");
  const base = path.basename(target);
  if (FORBIDDEN_MODULES.includes(target) || STORE_SUFFIX.test(base) || DOMAIN_SERVICES.has(base)) return true;
  if (isSqlModule(base)) return !(names && names.length > 0 && names.every((name) => /Error$/.test(name)));
  return target.startsWith("src/data-access/") && !PURE_DATA_ACCESS.has(base);
}

/** Import / export-from GIÁ TRỊ (không phải `import type`, không phải toàn bộ `{ type X }`). */
export function valueImports(code: string): ValueImport[] {
  const out: ValueImport[] = [];
  for (const match of code.matchAll(/\b(?:import|export)\s+(type\s+)?([^;"']*?)\s*from\s*["']([^"']+)["']/g)) {
    if (match[1]) continue;
    const braces = match[2].match(/^\{([\s\S]*)\}$/);
    if (!braces) {
      out.push({ specifier: match[3], names: null });
      continue;
    }
    const parts = braces[1].split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.every((part) => part.startsWith("type "))) continue;
    out.push({ specifier: match[3], names: parts.filter((part) => !part.startsWith("type ")).map((part) => part.split(/\s+as\s+/)[0]) });
  }
  // import() động và import "x" (side-effect) cũng là phụ thuộc giá trị
  for (const match of code.matchAll(/\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) out.push({ specifier: match[1], names: null });
  for (const match of code.matchAll(/(?:^|[;\s])import\s+["']([^"']+)["']/gm)) out.push({ specifier: match[1], names: null });
  return out;
}

/** Các vi phạm của MỘT tệp (đường dẫn tương đối gốc kho + nội dung); mảng rỗng = sạch. */
export function guardProblems(file: string, source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  code.split("\n").forEach((line, index) => { if (DIRECT_CALL.test(line)) found.push(`dòng ${index + 1}: truy cập DB trực tiếp`); });
  for (const imported of valueImports(code)) if (forbiddenImport(file, imported)) found.push(`import trực tiếp ${imported.specifier}`);
  const marker = source.split("\n").slice(0, 5).join("\n").match(MARKER);
  const problems: string[] = [];
  if (marker?.[1] === "infra" && !file.startsWith("src/assistant/infra/")) problems.push("dấu infra chỉ hợp lệ trong src/assistant/infra/");
  if (marker?.[2] && !(ASSISTANT_FAMILIES as readonly string[]).includes(marker[2])) problems.push(`họ «${marker[2]}» không có trong ASSISTANT_FAMILIES`);
  if (found.length && !marker) problems.push(`vi phạm không có dấu mcp-guard: ${found.join("; ")}`);
  if (!found.length && marker) problems.push("dấu mcp-guard thừa (tệp không còn vi phạm) — gỡ dấu");
  return problems;
}

function listScannedFiles(): string[] {
  const files = new Set(SCAN_FILES);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (rel.endsWith(".ts") && !rel.endsWith(".test.ts") && !(rel in BRIDGE_ALLOWLIST)) files.add(rel);
    }
  };
  SCAN_DIRS.forEach(walk);
  // Mọi tệp đường cũ (`*-legacy.ts`) hoặc đã mang dấu mcp-guard ở bất kỳ đâu trong src/ cũng bị quét — thêm tệp legacy mới không cần nhớ sửa danh sách
  const walkAll = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walkAll(rel);
      else if (rel.endsWith(".ts") && !rel.endsWith(".test.ts")
        && (rel.endsWith("-legacy.ts") || MARKER.test(fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n").slice(0, 5).join("\n")))) files.add(rel);
    }
  };
  walkAll("src");
  return [...files].sort();
}

test("trợ lý không truy cập dữ liệu trực tiếp: mọi tệp vi phạm có dấu mcp-guard hợp lệ, không dấu thừa", () => {
  const files = listScannedFiles();
  assert.ok(files.length > 40, `quét quá ít tệp (${files.length})`);
  const problems = files.flatMap((file) => guardProblems(file, fs.readFileSync(path.join(ROOT, file), "utf8")).map((problem) => `${file}: ${problem}`));
  assert.deepEqual(problems, []);
});

test("ca âm: db.query / import repository / import dịch vụ miền ở tệp không dấu → đỏ", () => {
  assert.match(guardProblems("src/assistant/x.ts", "await db.query('SELECT 1');")[0], /không có dấu/);
  assert.match(guardProblems("src/assistant/x.ts", "const n = await db.query<Row[]>(sql);")[0], /không có dấu/);
  assert.match(guardProblems("src/assistant/x.ts", "import { load } from \"../tasks/task-repository.js\";")[0], /task-repository/);
  assert.match(guardProblems("src/assistant/x.ts", "import { run } from \"../tickets/ticket-service.js\";")[0], /ticket-service/);
  assert.match(guardProblems("src/assistant/x.ts", "import { visible } from \"../data-access/visibility-guards.js\";")[0], /visibility-guards/);
  assert.match(guardProblems("src/assistant/x.ts", "import { pool } from \"../db/pool.js\";")[0], /db\/pool/);
});

test("ca dương: chú thích, import type, module thuần và tệp có dấu legacy không đỏ", () => {
  assert.deepEqual(guardProblems("src/assistant/x.ts", "// gọi db.query( ở đây thì sai\nimport type { Db } from \"../db/pool.js\";\nimport { type A } from \"../tasks/task-service.js\";\nimport { DataAccessError } from \"../data-access/data-access-errors.js\";"), []);
  assert.deepEqual(guardProblems("src/assistant/x.ts", "// mcp-guard: legacy(tasks) — đường cũ\nawait db.query('SELECT 1');"), []);
  assert.deepEqual(guardProblems("src/assistant/infra/x.ts", "// mcp-guard: infra — hạ tầng\nawait db.query('SELECT 1');"), []);
});

test("ca âm: dấu infra ngoài infra/, họ lạ, dấu thừa → đỏ", () => {
  assert.match(guardProblems("src/assistant/x.ts", "// mcp-guard: infra — sai chỗ\nawait db.query('SELECT 1');")[0], /chỉ hợp lệ trong src\/assistant\/infra/);
  assert.match(guardProblems("src/assistant/x.ts", "// mcp-guard: legacy(abc) — lạ\nawait db.query('SELECT 1');")[0], /ASSISTANT_FAMILIES/);
  assert.match(guardProblems("src/assistant/x.ts", "// mcp-guard: legacy(tasks) — thừa\nexport const a = 1;")[0], /thừa/);
});

test("danh sách miễn của cầu nối còn đúng: tệp có thật và VẪN còn vi phạm (không miễn thừa)", () => {
  for (const [file, reason] of Object.entries(BRIDGE_ALLOWLIST)) {
    assert.ok(reason.length > 10, `${file}: thiếu lý do`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file}: không còn tệp`);
    const code = stripComments(fs.readFileSync(path.join(ROOT, file), "utf8"));
    const violates = DIRECT_CALL.test(code) || valueImports(code).some((imported) => forbiddenImport(file, imported));
    assert.ok(violates, `${file}: không còn vi phạm — gỡ khỏi BRIDGE_ALLOWLIST`);
  }
  // mọi tệp khác trong mcp-bridge bị quét (không miễn cả thư mục)
  const scanned = listScannedFiles().filter((file) => file.startsWith("src/assistant/mcp-bridge/"));
  assert.ok(scanned.length >= 8, `mcp-bridge quét quá ít tệp (${scanned.length})`);
  assert.ok(scanned.every((file) => !(file in BRIDGE_ALLOWLIST)));
});

test("ca âm (M4): import() động, bí danh .query, module -sql-, ticket-visibility, brief-ai-highlights → đỏ", () => {
  assert.match(guardProblems("src/assistant/x.ts", "const m = await import(\"../tasks/task-repository.js\");")[0], /task-repository/);
  assert.match(guardProblems("src/assistant/x.ts", "const { query } = db;\nawait query('SELECT 1');")[0], /truy cập DB trực tiếp/);
  assert.match(guardProblems("src/assistant/x.ts", "const run = deps.db.query;")[0], /truy cập DB trực tiếp/);
  assert.match(guardProblems("src/assistant/x.ts", "const run = pool.query.bind(pool);")[0], /truy cập DB trực tiếp/);
  assert.match(guardProblems("src/assistant/x.ts", "await db[\"query\"]('SELECT 1');")[0], /truy cập DB trực tiếp/);
  assert.match(guardProblems("src/assistant/x.ts", "import { sqlAttachmentTextStore } from \"../storage/attachment-text-sql-cache.js\";")[0], /attachment-text-sql-cache/);
  assert.match(guardProblems("src/assistant/x.ts", "import { visibilityClause } from \"../tickets/ticket-visibility.js\";")[0], /ticket-visibility/);
  assert.match(guardProblems("src/assistant/x.ts", "import { HighlightCache } from \"../briefs/brief-ai-highlights.js\";")[0], /brief-ai-highlights/);
  assert.match(guardProblems("src/assistant/x.ts", "import { sqlReplySourceReader } from \"../reply-suggestions/reply-suggestion-sql-reader.js\";")[0], /reply-suggestion-sql-reader/);
});

test("ca dương (M4): lớp lỗi từ module -sql-, tham số `query` của công cụ, mảng [\"query\"] không đỏ", () => {
  assert.deepEqual(guardProblems("src/assistant/x.ts", "import { AttachmentTextDeniedError } from \"../storage/attachment-text-sql-cache.js\";"), []);
  assert.deepEqual(guardProblems("src/assistant/x.ts", "const { query } = args;\nconst q = args.query;\nconst spec = { required: [\"query\"] };"), []);
});
