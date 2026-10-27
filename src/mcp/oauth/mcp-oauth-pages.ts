import { McpAccessLevel } from "../../constants.js";
import type { ConsentView } from "./mcp-oauth.js";

// Hai trang HTML phía máy chủ của luồng OAuth cổng /mcp: màn đồng ý và trang lỗi. Không có script (CSP script-src 'self'),
// chỉ form POST về chính /oauth/consent. Mọi chữ lấy từ dữ liệu đều qua escapeHtml.

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] as string);
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} — Bot trợ lý</title>
<style>
  body { margin: 0; background: #f6f8fb; color: #1f2937; font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 480px; margin: 48px auto; padding: 28px 32px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; }
  h1 { margin: 0 0 12px; font-size: 20px; color: #0f172a; }
  p { margin: 8px 0; }
  .app { font-weight: 600; color: #0f172a; }
  .warn { margin: 12px 0; padding: 10px 12px; border-radius: 8px; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
  .note { margin: 12px 0; padding: 10px 12px; border-radius: 8px; background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
  fieldset { margin: 16px 0; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; }
  legend { padding: 0 4px; color: #475569; font-size: 13px; }
  label { display: block; margin: 6px 0; }
  .actions { display: flex; gap: 10px; margin-top: 20px; }
  button { flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; font: inherit; cursor: pointer; }
  button.primary { background: #00aeef; border-color: #00aeef; color: #fff; font-weight: 600; }
  a { color: #0284c7; }
  .muted { color: #64748b; font-size: 13px; }
</style>
</head>
<body><main>
${body}
</main></body>
</html>`;
}

export interface ConsentPageInput {
  view: ConsentView;
  requestToken: string;
  /** login = chưa đăng nhập web bot; role = tài khoản không phải Quản trị / Quản lý */
  notice?: "login" | "role";
  userName?: string;
}

export function renderConsentPage(input: ConsentPageInput): string {
  const { view } = input;
  const app = escapeHtml(view.clientName);
  const notice = input.notice === "login"
    ? `<div class="note">Anh/chị chưa đăng nhập trang quản trị bot. <a href="/app/login" target="_blank" rel="noopener">Mở trang đăng nhập</a>
       (tab mới), đăng nhập xong quay lại đây bấm <strong>Cho phép</strong> lần nữa.</div>`
    : input.notice === "role"
      ? `<div class="warn">Tài khoản <strong>${escapeHtml(input.userName ?? "")}</strong> không được nối ứng dụng AI với bot — chỉ
         Quản trị / Quản lý được dùng cổng MCP.</div>`
      : "";
  const redirectWarning = view.redirectTrusted ? "" : `<div class="warn">Sau khi cho phép, trình duyệt sẽ chuyển về
    <strong>${escapeHtml(view.redirectLabel)}</strong> — đây KHÔNG phải ứng dụng AI quen (Claude, ChatGPT). Chỉ cho phép khi chính
    anh/chị vừa bấm kết nối từ ứng dụng đó.</div>`;
  const writeOption = view.requestedLevel === McpAccessLevel.ReadWrite
    ? `<label><input type="radio" name="level" value="${McpAccessLevel.ReadWrite}"> Đọc và đề xuất thay đổi (mỗi thay đổi vẫn phải xác nhận)</label>`
    : "";
  const body = `
<h1>Cho phép ứng dụng AI truy cập bot?</h1>
<p><span class="app">${app}</span> muốn đọc dữ liệu của bot (tin nhắn, tệp, việc, ticket, số liệu) <strong>theo đúng quyền của tài khoản
anh/chị</strong> trên trang quản trị.</p>
<p class="muted">Quay về: ${escapeHtml(view.redirectLabel)}</p>
${notice}
${redirectWarning}
<form method="post" action="/oauth/consent">
  <input type="hidden" name="req" value="${escapeHtml(input.requestToken)}">
  <fieldset>
    <legend>Mức quyền</legend>
    <label><input type="radio" name="level" value="${McpAccessLevel.Read}" checked> Chỉ đọc</label>
    ${writeOption}
  </fieldset>
  <label><input type="checkbox" name="confidential" value="1"> Gồm cả nhóm Mật (chỉ có tác dụng khi tài khoản được xem nhóm Mật)</label>
  <div class="actions">
    <button type="submit" name="decision" value="deny">Từ chối</button>
    <button type="submit" name="decision" value="allow" class="primary">Cho phép</button>
  </div>
</form>
<p class="muted">Kết nối có hạn 90 ngày. Thu hồi bất cứ lúc nào ở màn <strong>Khóa MCP</strong> trên trang quản trị.</p>`;
  return shell("Cho phép ứng dụng AI", body);
}

export function renderOAuthErrorPage(message: string): string {
  return shell("Không kết nối được", `
<h1>Không kết nối được ứng dụng AI với bot</h1>
<p>${escapeHtml(message)}</p>
<p>Quay lại ứng dụng AI và thử kết nối lại.</p>`);
}
