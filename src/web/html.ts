// Dựng HTML phía máy chủ theo khuôn giao diện ERP DEGO (frontend-v2): menu trái nền trắng, thanh
// trên 56px, nền trang xám nhạt, thẻ bo góc có viền + bóng mờ, bảng hàng tiêu đề xanh nhạt + vằn.
// Thông số màu chép từ procurement-tool/frontend-v2/src/index.css; màu chủ đạo đổi được qua BRAND_PRIMARY.
//
// Mọi giá trị đến từ Zalo (tên nhóm, tên người, tên tệp) là dữ liệu người ngoài gõ — LUÔN đi qua
// escapeHtml, kể cả trong thuộc tính.

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

export function formatTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
}

// Tên hiển thị của sản phẩm — dùng chung cho mọi khách, không gắn tên khách nào
export const APP_NAME = "Bot trợ lý";

export type BadgeTone = "success" | "warning" | "danger" | "muted" | "info";

export function badge(text: string, tone: BadgeTone): string {
  return `<span class="badge ${tone}">${escapeHtml(text)}</span>`;
}

// Biểu tượng nét mảnh kiểu lucide (giấy phép ISC), vẽ thẳng bằng SVG để khỏi tải thư viện
const ICONS = {
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  contacts: '<path d="M16 2v2M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M8 2v2"/><circle cx="12" cy="11" r="3"/><rect x="3" y="4" width="18" height="18" rx="2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 13H8M16 17H8"/>',
  building: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
} as const;

function icon(name: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const NAV: { href: string; label: string; icon: keyof typeof ICONS }[] = [
  { href: "/", label: "Tài khoản bot", icon: "bot" },
  { href: "/conversations", label: "Hội thoại", icon: "chat" },
  { href: "/contacts", label: "Danh bạ", icon: "contacts" },
  { href: "/groups", label: "Nhóm", icon: "users" },
  { href: "/files", label: "Tệp", icon: "file" },
  { href: "/companies", label: "Công ty", icon: "building" },
];

function buildStyle(primary: string): string {
  return `
  :root {
    --primary: ${primary};
    --primary-foreground: #ffffff;
    --foreground: #1b2559;
    --muted-foreground: #64748b;
    --canvas: #f6f8fb;
    --card: #ffffff;
    --border: #e2e8f0;
    --row-head: #dbe6f5;
    --row-stripe: #f0f4f9;
    --row-hover: #e0f2fe;
    --sidebar-active: color-mix(in oklab, var(--primary) 10%, #ffffff);
    --success: #16a34a; --warning: #d97706; --danger: #b91c1c; --info: #0284c7;
    --radius: 0.5rem;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 14px; color: var(--foreground); background: var(--canvas); }
  a { color: var(--primary); }
  .layout { display: flex; min-height: 100vh; }
  .sidebar { width: 240px; flex-shrink: 0; background: #fff; border-right: 1px solid var(--border);
    position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; }
  .sidebar-brand { height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 16px;
    border-bottom: 1px solid var(--border); font-weight: 700; font-size: 15px; }
  .sidebar-brand .dot { width: 28px; height: 28px; border-radius: 8px; background: var(--primary);
    color: #fff; display: grid; place-items: center; }
  .sidebar-brand .dot svg { width: 18px; height: 18px; }
  .sidebar-nav { padding: 12px 8px; }
  .nav-label { padding: 0 12px 6px; font-size: 11px; font-weight: 600; letter-spacing: .06em;
    text-transform: uppercase; color: var(--muted-foreground); }
  .nav-item { height: 36px; display: flex; align-items: center; gap: 12px; padding: 0 12px; margin-bottom: 4px;
    border-radius: var(--radius); font-weight: 500; color: rgba(27, 37, 89, .8); text-decoration: none; }
  .nav-item svg { width: 20px; height: 20px; color: rgba(27, 37, 89, .5); }
  .nav-item:hover { background: #eef4fb; color: #14507a; }
  .nav-item.active { background: var(--sidebar-active); color: var(--primary); }
  .nav-item.active svg { color: var(--primary); }
  .content { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .topbar { position: sticky; top: 0; z-index: 10; height: 56px; background: #fff; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; padding: 0 24px; gap: 8px; }
  .topbar .crumb { color: var(--muted-foreground); } .topbar .current { font-weight: 500; }
  .topbar .spacer { flex: 1; }
  main { padding: 24px; max-width: 1280px; width: 100%; }
  .page-head { margin-bottom: 16px; } .page-head h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
  .page-head p { margin: 0; color: var(--muted-foreground); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, .06); padding: 20px; margin-bottom: 16px; }
  .card h2 { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
  .table-card { padding: 0; overflow: hidden; }
  .table-scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th { background: var(--row-head); text-align: left; font-weight: 600; font-size: 13px; padding: 10px 12px; white-space: nowrap; }
  td { padding: 9px 12px; border-top: 1px solid var(--border); vertical-align: middle; }
  tbody tr:nth-child(even) { background: var(--row-stripe); }
  tbody tr:hover { background: var(--row-hover); }
  th.center, td.center { text-align: center; }
  td.empty { text-align: center; color: var(--muted-foreground); padding: 28px 12px; }
  .sub { color: var(--muted-foreground); font-size: 12px; margin-top: 2px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 16px;
    border-radius: var(--radius); border: 1px solid transparent; font: inherit; font-weight: 500; cursor: pointer;
    text-decoration: none; white-space: nowrap; background: var(--primary); color: var(--primary-foreground); }
  .btn:hover { filter: brightness(.95); }
  .btn.outline { background: #fff; color: var(--foreground); border-color: var(--border); }
  .btn.outline:hover { background: #eef4fb; filter: none; }
  .btn.sm { height: 32px; padding: 0 12px; font-size: 13px; }
  .btn svg { width: 16px; height: 16px; }
  input[type=text], input[type=password], input[type=number], select { height: 36px; padding: 0 10px; font: inherit;
    color: var(--foreground); background: #fff; border: 1px solid var(--border); border-radius: var(--radius); }
  input:focus, select:focus { outline: 2px solid color-mix(in oklab, var(--primary) 45%, transparent); outline-offset: 1px; border-color: var(--primary); }
  input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--primary); vertical-align: middle; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
  .row-form { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  /* Hàng cấu hình trong bảng: giữ trên một dòng, màn hẹp thì bảng tự cuộn ngang */
  .row-form.nowrap { flex-wrap: nowrap; }
  .check { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  form.inline { display: inline; }
  .actions { display: flex; gap: 6px; justify-content: flex-end; }
  .badge { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 6px;
    font-size: 12px; font-weight: 500; white-space: nowrap; }
  .badge.success { background: #dcfce7; color: #166534; } .badge.warning { background: #fef3c7; color: #92400e; }
  .badge.danger { background: #fee2e2; color: var(--danger); } .badge.muted { background: #f1f5f9; color: #475569; }
  .badge.info { background: #e0f2fe; color: #075985; }
  .notice { background: #fffbeb; border: 1px solid #fcd34d; color: #78350f; padding: 10px 14px; border-radius: var(--radius); margin-bottom: 16px; }
  .error-text { color: var(--danger); }
  .pager { display: flex; gap: 8px; margin-top: 12px; }
  .auth { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .auth .card { width: 100%; max-width: 380px; padding: 28px; }
  .auth h1 { font-size: 20px; margin: 0 0 4px; } .auth input { width: 100%; margin: 16px 0 12px; }
  .auth .btn { width: 100%; }
  td.preview { color: var(--muted-foreground); max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .timeline { display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: 760px; padding: 8px 12px; border-radius: 10px; background: var(--row-stripe); border: 1px solid var(--border); }
  .msg.from-bot { align-self: flex-end; background: var(--sidebar-active); }
  .msg-head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 2px; }
  .msg-quote { border-left: 3px solid var(--border); padding-left: 8px; color: var(--muted-foreground); font-size: 13px; margin: 4px 0; }
  .msg-body { white-space: normal; word-break: break-word; }
  .msg-file { margin-top: 4px; }
  /* ---- Màn Hội thoại kiểu Zalo / Telegram ---- */
  main.full-bleed { padding: 0; max-width: none; }
  .chat-app { display: grid; grid-template-columns: 320px minmax(0, 1fr) 320px; height: calc(100vh - 56px); background: #fff; }
  .chat-list { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; }
  .chat-search { padding: 12px 12px 8px; }
  .chat-search input { width: 100%; background: var(--canvas); border-color: transparent; border-radius: 18px; padding: 0 14px; }
  .chat-tabs { display: flex; gap: 4px; padding: 0 12px 8px; border-bottom: 1px solid var(--border); }
  .chat-tabs a { padding: 6px 12px; border-radius: 14px; font-size: 13px; font-weight: 500; color: var(--muted-foreground); text-decoration: none; }
  .chat-tabs a.active { background: var(--sidebar-active); color: var(--primary); }
  .thread-scroll { overflow-y: auto; flex: 1; }
  .thread { display: flex; gap: 10px; align-items: center; padding: 10px 12px; text-decoration: none; color: inherit; }
  .thread:hover { background: #f1f5f9; }
  .thread.active { background: var(--sidebar-active); }
  .thread-body { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 2px; }
  .thread-top { display: flex; justify-content: space-between; gap: 8px; }
  .thread-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .group-mark { color: var(--muted-foreground); margin-right: 3px; font-weight: 500; }
  .thread-time { font-size: 12px; color: var(--muted-foreground); flex-shrink: 0; }
  .thread-preview { font-size: 13px; color: var(--muted-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .avatar { border-radius: 50%; color: #fff; display: inline-grid; place-items: center; font-weight: 600; flex-shrink: 0; letter-spacing: .02em; }
  .avatar.group { border-radius: 30%; }
  .avatar-gap { width: 32px; flex-shrink: 0; }
  .chat-main { display: flex; flex-direction: column; min-height: 0; background: #e8eef6; }
  .chat-header { height: 64px; flex-shrink: 0; display: flex; gap: 12px; align-items: center; padding: 0 20px; background: #fff; border-bottom: 1px solid var(--border); }
  .chat-title { font-weight: 600; font-size: 15px; }
  .chat-subtitle { font-size: 12px; color: var(--muted-foreground); }
  .chat-scroll { flex: 1; overflow-y: auto; padding: 16px 24px; display: flex; flex-direction: column; gap: 3px; }
  .chat-footer { flex-shrink: 0; padding: 10px 20px; background: #fff; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted-foreground); text-align: center; }
  .chat-empty { color: var(--muted-foreground); text-align: center; margin: 32px 16px; }
  .chat-placeholder { align-items: center; justify-content: center; text-align: center; color: var(--muted-foreground); }
  .placeholder-icon { width: 56px; height: 56px; color: #94a3b8; }
  .day-sep { display: flex; justify-content: center; margin: 12px 0 8px; }
  .day-sep span { background: rgba(15, 23, 42, .28); color: #fff; font-size: 12px; padding: 3px 10px; border-radius: 10px; }
  .load-older { text-align: center; margin-bottom: 8px; }
  .load-older a { font-size: 13px; background: #fff; padding: 4px 12px; border-radius: 12px; text-decoration: none; }
  .row { display: flex; align-items: flex-end; gap: 8px; }
  .row.out { justify-content: flex-end; }
  .bubble { position: relative; max-width: min(560px, 72%); padding: 7px 10px 18px; border-radius: 12px; background: #fff;
    box-shadow: 0 1px 1px rgba(15, 23, 42, .08); word-break: break-word; }
  .bubble.out { background: #d6efff; }
  .bubble-name { font-size: 12px; font-weight: 600; color: var(--primary); margin-bottom: 2px; }
  .bubble-text { white-space: pre-wrap; line-height: 1.45; }
  .muted-text { color: var(--muted-foreground); }
  .bubble-quote { border-left: 3px solid var(--primary); background: rgba(0, 0, 0, .04); padding: 4px 8px; border-radius: 4px;
    font-size: 13px; color: var(--muted-foreground); margin-bottom: 4px; white-space: pre-wrap; }
  .bubble-time { position: absolute; right: 10px; bottom: 4px; font-size: 11px; color: #94a3b8; }
  .recalled { font-style: italic; color: var(--muted-foreground); }
  .file-card { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 8px; background: rgba(0, 0, 0, .04);
    text-decoration: none; color: inherit; min-width: 220px; margin-bottom: 4px; }
  a.file-card:hover { background: rgba(0, 0, 0, .08); }
  .file-icon { width: 38px; height: 44px; border-radius: 6px; color: #fff; font-size: 10px; font-weight: 700; display: grid; place-items: center; flex-shrink: 0; }
  .file-meta { display: flex; flex-direction: column; min-width: 0; }
  .file-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-size { font-size: 12px; color: var(--muted-foreground); }
  .chat-info { border-left: 1px solid var(--border); overflow-y: auto; min-height: 0; padding-bottom: 24px; }
  .profile-head { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 20px 16px 12px; gap: 6px; }
  .profile-name { font-size: 16px; font-weight: 600; }
  .profile-chips { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; }
  .badge.tag { background: #f3e8ff; color: #6b21a8; }
  .notice.small { margin: 0 16px 12px; font-size: 13px; }
  .profile-form { display: flex; flex-direction: column; gap: 10px; padding: 4px 16px 16px; border-bottom: 1px solid var(--border); }
  .profile-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--muted-foreground); }
  .profile-form select, .profile-form input[type=text], .profile-form textarea { width: 100%; font-weight: 400; }
  .profile-form textarea { font: inherit; color: var(--foreground); padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); resize: vertical; }
  .profile-form .hint { font-weight: 400; font-size: 11px; }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; padding: 14px 16px; margin: 0; font-size: 13px; border-bottom: 1px solid var(--border); }
  .facts dt { color: var(--muted-foreground); } .facts dd { margin: 0; text-align: right; }
  .mono { font-family: ui-monospace, monospace; font-size: 12px; }
  .panel-section { padding: 12px 8px; }
  .panel-title { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted-foreground); padding: 0 8px 6px; }
  .mini-row { display: flex; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 8px; text-decoration: none; color: inherit; font-size: 13px; }
  .mini-row span:nth-child(2) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  a.mini-row:hover { background: #f1f5f9; }
  @media (max-width: 1200px) { .chat-app { grid-template-columns: 280px minmax(0, 1fr); } .chat-info { display: none; } }
  .qr-box { text-align: center; max-width: 420px; }
  .qr-box img { width: 280px; height: 280px; display: none; margin: 8px auto; border-radius: 8px; }
  .qr-message.ok { color: var(--success); } .qr-message.bad { color: var(--danger); }
`;
}

// Màu chủ đạo đặt lúc khởi động (BRAND_PRIMARY) — mặc định xanh DEGO
let brandPrimary = "#00aeef";

export function setBrandPrimary(color: string): void {
  brandPrimary = color;
}

export interface PageOptions {
  description?: string;
  /** Trang không có menu (đăng nhập). */
  bare?: boolean;
  /** Nội dung chiếm trọn khung (màn chat): bỏ lề, bỏ tiêu đề trang. */
  fullBleed?: boolean;
}

export function renderPage(title: string, activePath: string, body: string, options: PageOptions = {}): string {
  const head = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${APP_NAME}</title><style>${buildStyle(brandPrimary)}</style></head>`;
  if (options.bare) return `${head}<body><div class="auth">${body}</div></body></html>`;

  const nav = NAV.map((item) =>
    `<a class="nav-item ${item.href === activePath ? "active" : ""}" href="${item.href}">${icon(item.icon)}<span>${item.label}</span></a>`,
  ).join("");
  return `${head}<body><div class="layout">
  <aside class="sidebar">
    <div class="sidebar-brand"><span class="dot">${icon("bot")}</span>${APP_NAME}</div>
    <nav class="sidebar-nav"><div class="nav-label">Quản trị</div>${nav}</nav>
  </aside>
  <div class="content">
    <header class="topbar">
      <span class="crumb">Quản trị</span><span class="crumb">/</span><span class="current">${escapeHtml(title)}</span>
      <span class="spacer"></span>
      <form class="inline" method="post" action="/logout"><button class="btn outline sm">${icon("logout")}Đăng xuất</button></form>
    </header>
    ${options.fullBleed ? `<main class="full-bleed">${body}</main>` : `<main>
      <div class="page-head"><h1>${escapeHtml(title)}</h1>${options.description ? `<p>${options.description}</p>` : ""}</div>
      ${body}
    </main>`}
  </div>
</div></body></html>`;
}
