import fs from "node:fs";
import type http from "node:http";
import path from "node:path";

// Phục vụ bản build của giao diện `web/` (React, chép khung ERP v2) dưới `/app`.
// Tệp có thật → trả tệp; đường lạ trong /app → index.html để router phía trình duyệt lo (SPA).

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export const SPA_BASE = "/app";

/** Trả true nếu đã phục vụ (kể cả 404 khi chưa build). */
export function serveSpa(distDir: string, urlPath: string, response: http.ServerResponse): boolean {
  if (urlPath !== SPA_BASE && !urlPath.startsWith(`${SPA_BASE}/`)) return false;
  const root = path.resolve(distDir);
  const indexFile = path.join(root, "index.html");
  if (!fs.existsSync(indexFile)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Chưa có bản build giao diện mới (chạy npm run build trong thư mục web/).");
    return true;
  }
  const relative = decodeURIComponent(urlPath.slice(SPA_BASE.length)).replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  // Chặn thoát khỏi thư mục build (/app/../../.env)
  const insideRoot = candidate === root || candidate.startsWith(root + path.sep);
  const isFile = insideRoot && relative !== "" && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  const file = isFile ? candidate : indexFile;
  const extension = path.extname(file);
  // Tệp trong assets/ có băm trong tên → cache lâu; index.html luôn hỏi lại để thấy bản mới
  const cache = isFile && relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  response.writeHead(200, { "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream", "Cache-Control": cache });
  fs.createReadStream(file).pipe(response);
  return true;
}
