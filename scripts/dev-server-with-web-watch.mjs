// `npm run dev`: chạy máy chủ bot (tsx watch) + build lại giao diện `web/` mỗi khi sửa (vite build --watch),
// để link máy chủ in ra (http://127.0.0.1:8090/app/) luôn là giao diện mới nhất — không phải build tay.
// Muốn sửa giao diện có nạp nóng (HMR) thì vẫn dùng `cd web && npm run dev` (cổng 5175).
// Một tiến trình chết thì tắt nốt tiến trình kia; Ctrl+C tắt cả hai.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [];
let stopping = false;

function run(label, command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: ["inherit", "pipe", "pipe"], env: process.env });
  const prefix = (stream, target) => stream.on("data", (chunk) => {
    for (const line of String(chunk).split("\n")) if (line.trim()) target.write(`${label} ${line}\n`);
  });
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`${label} đã dừng (mã ${code}) — tắt nốt phần còn lại`);
      stop(code ?? 1);
    }
  });
  children.push(child);
}

function stop(code = 0) {
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
run("[web]", npx, ["vite", "build", "--watch", "--logLevel", "warn"], path.join(root, "web"));
run("[bot]", npx, ["tsx", "watch", "--env-file-if-exists=.env", "src/main.ts"], root);
console.log("[dev] máy chủ + giao diện tự build lại khi sửa — mở http://127.0.0.1:8090/app/ (sửa xong tải lại trang)");
