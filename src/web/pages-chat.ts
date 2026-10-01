import { AttachmentStatus, ContactKind, ContactKindSource, ContactRole, ConversationType, GroupKind, MessageKind } from "../constants.js";
import { escapeHtml, formatBytes, renderPage } from "./html.js";
import type { CompanyOption } from "./pages.js";

// Màn Hội thoại kiểu Zalo / Telegram Web: danh sách cuộc trò chuyện | khung chat | hồ sơ người / nhóm.
// Chỉ xem — bot trả lời trên Zalo, quản trị không gõ thay ở đây.

const VN_OFFSET_MS = 7 * 3_600_000;

export interface ThreadListItem {
  id: number;
  thread_type: number;
  name: string;
  label: string;
  message_count: number;
  last_message_at: Date | null;
  last_text: string | null;
  last_sender: string | null;
}

export interface ChatMessage {
  id: number;
  sender_uid: string;
  sender_name: string;
  sent_at: Date;
  text: string | null;
  kind: number;
  zalo_msg_type: string;
  quote_text: string | null;
  recalled_at: Date | null;
  attachment_id: number | null;
  file_name: string | null;
  file_ext: string | null;
  attachment_status: number | null;
  stored_bytes: number | null;
  declared_size: number | null;
}

export interface ContactProfile {
  id: number;
  zalo_uid: string;
  display_name: string;
  zalo_name: string;
  kind: number;
  kind_source: number;
  role: number;
  company_id: number | null;
  note: string | null;
  first_seen_at: Date;
  last_dm_at: Date | null;
  dm_count: number;
  tags: string[];
  groups: { id: number; name: string; group_kind: number }[];
}

export interface GroupProfile {
  id: number;
  name: string;
  label: string;
  zalo_group_id: string;
  group_kind: number;
  member_count: number;
  company_name: string | null;
  read_messages: number;
  capture_files: number;
  members: { zalo_uid: string; name: string; kind: number; is_admin: number; direct_thread_id: number | null }[];
}

export interface ChatPageData {
  threads: ThreadListItem[];
  typeFilter: number;
  query: string;
  selected: { id: number; thread_type: number; name: string; label: string } | null;
  messages: ChatMessage[];
  olderCursor: number | null;
  botUids: Set<string>;
  contact: ContactProfile | null;
  group: GroupProfile | null;
  companies: CompanyOption[];
  notice: string;
}

// ---------- tiện ích hiển thị ----------

function vnParts(date: Date) {
  const local = new Date(date.getTime() + VN_OFFSET_MS);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate(), h: local.getUTCHours(), min: local.getUTCMinutes() };
}

const pad = (n: number) => String(n).padStart(2, "0");

function timeOf(date: Date): string {
  const p = vnParts(date);
  return `${pad(p.h)}:${pad(p.min)}`;
}

function dayKey(date: Date): string {
  const p = vnParts(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

function dayLabel(date: Date, now = new Date()): string {
  const key = dayKey(date);
  if (key === dayKey(now)) return "Hôm nay";
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return "Hôm qua";
  const p = vnParts(date);
  return p.y === vnParts(now).y ? `${pad(p.d)}/${pad(p.m)}` : `${pad(p.d)}/${pad(p.m)}/${p.y}`;
}

/** Giờ ngắn cho danh sách: hôm nay → 14:05, năm nay → 30/09, năm khác → 30/09/25. */
function shortTime(date: Date | null): string {
  if (!date) return "";
  const now = new Date();
  if (dayKey(date) === dayKey(now)) return timeOf(date);
  const p = vnParts(date);
  return p.y === vnParts(now).y ? `${pad(p.d)}/${pad(p.m)}` : `${pad(p.d)}/${pad(p.m)}/${String(p.y).slice(2)}`;
}

function fullTime(date: Date | null): string {
  if (!date) return "—";
  const p = vnParts(date);
  return `${pad(p.h)}:${pad(p.min)} ${pad(p.d)}/${pad(p.m)}/${p.y}`;
}

/** Chữ viết tắt tên người: hai từ CUỐI (họ Việt đứng trước) — giống luật bên ERP. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const picked = words.length === 1 ? [words[0]] : words.slice(-2);
  return picked.map((word) => word[0]!.toUpperCase()).join("");
}

const AVATAR_COLORS = ["#00aeef", "#2a78d6", "#1baf7a", "#eb6834", "#8b5cf6", "#d97706", "#db2777", "#0d9488"];

function avatar(seed: string, name: string, size = 40, group = false): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return `<span class="avatar ${group ? "group" : ""}" style="width:${size}px;height:${size}px;background:${color};font-size:${Math.round(size * 0.38)}px">${escapeHtml(initials(name))}</span>`;
}

const KIND_LABEL: Record<number, string> = {
  [ContactKind.Unclassified]: "Chưa phân loại",
  [ContactKind.Customer]: "Khách hàng",
  [ContactKind.Staff]: "Nhân sự",
};
const KIND_CLASS: Record<number, string> = {
  [ContactKind.Unclassified]: "muted",
  [ContactKind.Customer]: "info",
  [ContactKind.Staff]: "success",
};
const ROLE_LABEL: Record<number, string> = {
  [ContactRole.None]: "Không — chỉ lưu",
  [ContactRole.DepartmentHead]: "Trưởng phòng",
  [ContactRole.Manager]: "Quản lý",
};

function chip(text: string, tone: string): string {
  return `<span class="badge ${tone}">${escapeHtml(text)}</span>`;
}

function selectOptions(choices: Record<number, string>, selected: number): string {
  return Object.entries(choices)
    .map(([value, label]) => `<option value="${value}" ${Number(value) === selected ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
}

function fileIcon(ext: string): string {
  const e = ext.toLowerCase();
  const label = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "rar", "txt", "csv"].includes(e) ? e.toUpperCase().slice(0, 4) : "TỆP";
  const color = e === "pdf" ? "#dc2626" : e.startsWith("xls") || e === "csv" ? "#16a34a" : e.startsWith("doc") ? "#2563eb" : e.startsWith("ppt") ? "#ea580c" : "#64748b";
  return `<span class="file-icon" style="background:${color}">${escapeHtml(label)}</span>`;
}

// ---------- cột trái: danh sách ----------

function threadListUrl(typeFilter: number, query: string, id?: number): string {
  const params = new URLSearchParams();
  if (typeFilter >= 0) params.set("type", String(typeFilter));
  if (query) params.set("q", query);
  const qs = params.toString();
  return `${id ? `/conversations/${id}` : "/conversations"}${qs ? `?${qs}` : ""}`;
}

function renderThreadList(data: ChatPageData): string {
  const tabs: [number, string][] = [[-1, "Tất cả"], [ConversationType.Direct, "Riêng"], [ConversationType.Group, "Nhóm"]];
  const items = data.threads.map((thread) => {
    const name = thread.label || thread.name || "(chưa rõ tên)";
    const isGroup = thread.thread_type === ConversationType.Group;
    const preview = thread.last_text
      ? `${isGroup && thread.last_sender ? `${thread.last_sender}: ` : ""}${thread.last_text}`
      : thread.message_count ? "(tệp / ảnh)" : "Chưa có tin";
    return `
      <a class="thread ${data.selected?.id === thread.id ? "active" : ""}" href="${threadListUrl(data.typeFilter, data.query, thread.id)}">
        ${avatar(`t${thread.id}`, name, 44, isGroup)}
        <span class="thread-body">
          <span class="thread-top"><span class="thread-name">${isGroup ? `<span class="group-mark">#</span>` : ""}${escapeHtml(name)}</span>
            <span class="thread-time">${escapeHtml(shortTime(thread.last_message_at))}</span></span>
          <span class="thread-preview">${escapeHtml(preview.replace(/\s+/g, " ").slice(0, 90))}</span>
        </span>
      </a>`;
  }).join("");
  return `
    <aside class="chat-list">
      <form method="get" action="/conversations" class="chat-search">
        ${data.typeFilter >= 0 ? `<input type="hidden" name="type" value="${data.typeFilter}">` : ""}
        <input type="text" name="q" value="${escapeHtml(data.query)}" placeholder="Tìm người hoặc nhóm">
      </form>
      <nav class="chat-tabs">${tabs.map(([value, label]) =>
        `<a class="${value === data.typeFilter ? "active" : ""}" href="${threadListUrl(value, data.query)}">${label}</a>`).join("")}</nav>
      <div class="thread-scroll">${items || `<p class="chat-empty">${data.query ? "Không có cuộc nào khớp." : "Chưa có cuộc trò chuyện nào."}</p>`}</div>
    </aside>`;
}

// ---------- cột giữa: khung chat ----------

function renderBubble(message: ChatMessage, fromBot: boolean, showName: boolean, isGroup: boolean, lastOfRun: boolean): string {
  let content: string;
  if (message.recalled_at) {
    content = `<span class="recalled">Tin nhắn đã được thu hồi</span>`;
  } else {
    const quote = message.quote_text ? `<div class="bubble-quote">${escapeHtml(message.quote_text.slice(0, 160))}</div>` : "";
    let file = "";
    if (message.attachment_id) {
      const ext = message.file_ext || (message.file_name?.split(".").pop() ?? "");
      const name = message.file_name || (message.kind === MessageKind.Image ? "Hình ảnh" : message.kind === MessageKind.Video ? "Video"
        : message.kind === MessageKind.Voice ? "Ghi âm" : "Tệp");
      const stored = message.attachment_status === AttachmentStatus.Stored;
      const size = formatBytes(message.stored_bytes ?? message.declared_size);
      const status = stored ? size : message.attachment_status === AttachmentStatus.Pending ? "đang tải về kho…" : "chưa có trong kho";
      const inner = `${fileIcon(ext)}<span class="file-meta"><span class="file-name">${escapeHtml(name)}</span><span class="file-size">${escapeHtml(status)}</span></span>`;
      file = stored ? `<a class="file-card" href="/files/${message.attachment_id}/download">${inner}</a>` : `<div class="file-card">${inner}</div>`;
    }
    // Tin tệp: chữ chính là tên tệp — đã nằm trong thẻ tệp, khỏi lặp lại
    const text = message.text && !(message.attachment_id && message.text === message.file_name)
      ? `<div class="bubble-text">${escapeHtml(message.text)}</div>` : "";
    const sticker = message.kind === MessageKind.Sticker && !text ? `<div class="bubble-text muted-text">[Sticker]</div>` : "";
    content = `${quote}${file}${text}${sticker}`;
  }
  const name = showName && isGroup && !fromBot ? `<div class="bubble-name">${escapeHtml(message.sender_name || message.sender_uid)}</div>` : "";
  const side = fromBot ? "out" : "in";
  const leftAvatar = !fromBot && isGroup
    ? (lastOfRun ? avatar(message.sender_uid, message.sender_name || "?", 32) : `<span class="avatar-gap"></span>`)
    : "";
  return `
    <div class="row ${side}">
      ${leftAvatar}
      <div class="bubble ${side}">${name}${content}<span class="bubble-time">${timeOf(message.sent_at)}</span></div>
    </div>`;
}

function renderChat(data: ChatPageData): string {
  if (!data.selected) {
    return `<section class="chat-main chat-placeholder"><div><svg class="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
      <p>Chọn một cuộc trò chuyện bên trái để xem tin nhắn.</p></div></section>`;
  }
  const isGroup = data.selected.thread_type === ConversationType.Group;
  const title = data.selected.label || data.selected.name || "(chưa rõ tên)";
  const subtitle = isGroup
    ? `Nhóm · ${data.group?.member_count ?? 0} thành viên`
    : data.contact ? `${KIND_LABEL[data.contact.kind]} · nhắn riêng với bot` : "Nhắn riêng với bot";
  const parts: string[] = [];
  let lastDay = "";
  let previous: ChatMessage | null = null;
  data.messages.forEach((message, index) => {
    const day = dayKey(message.sent_at);
    if (day !== lastDay) {
      parts.push(`<div class="day-sep"><span>${escapeHtml(dayLabel(message.sent_at))}</span></div>`);
      lastDay = day;
      previous = null;
    }
    const fromBot = data.botUids.has(message.sender_uid);
    // Gộp tin liền nhau cùng người trong 5 phút: chỉ tin đầu hiện tên, tin cuối hiện ảnh đại diện
    const sameRunAsPrevious = previous !== null && previous.sender_uid === message.sender_uid
      && message.sent_at.getTime() - previous.sent_at.getTime() < 5 * 60_000;
    const next = data.messages[index + 1];
    const lastOfRun = !next || next.sender_uid !== message.sender_uid || dayKey(next.sent_at) !== day
      || next.sent_at.getTime() - message.sent_at.getTime() >= 5 * 60_000;
    parts.push(renderBubble(message, fromBot, !sameRunAsPrevious, isGroup, lastOfRun));
    previous = message;
  });
  const older = data.olderCursor
    ? `<div class="load-older"><a href="/conversations/${data.selected.id}?before=${data.olderCursor}">Xem tin cũ hơn</a></div>` : "";
  return `
    <section class="chat-main">
      <header class="chat-header">
        ${avatar(`t${data.selected.id}`, title, 40, isGroup)}
        <div><div class="chat-title">${escapeHtml(title)}</div><div class="chat-subtitle">${escapeHtml(subtitle)}</div></div>
      </header>
      <div class="chat-scroll" id="chat-scroll">
        ${older}
        ${parts.join("") || `<p class="chat-empty">Chưa có tin nào${isGroup ? " — bot chỉ lưu tin từ lúc bật «Đọc tin» trở đi" : ""}.</p>`}
      </div>
      <footer class="chat-footer">Chỉ xem — ${isGroup ? "bot không gửi tin vào nhóm" : "bot tự trả lời người có vai trò ngay trên Zalo"}.</footer>
    </section>`;
}

// ---------- cột phải: hồ sơ ----------

function renderContactPanel(contact: ContactProfile, data: ChatPageData): string {
  const name = contact.display_name || contact.zalo_name || contact.zalo_uid;
  const companyOptions = data.companies
    .filter((company) => company.is_active || company.id === contact.company_id)
    .map((company) => `<option value="${company.id}" ${company.id === contact.company_id ? "selected" : ""}>${escapeHtml(company.name)}</option>`)
    .join("");
  const auto = contact.kind_source === ContactKindSource.Auto;
  const groups = contact.groups.map((group) =>
    `<a class="mini-row" href="/conversations/${group.id}">${avatar(`t${group.id}`, group.name, 26, true)}<span>${escapeHtml(group.name)}</span>
      ${chip(group.group_kind === GroupKind.Internal ? "Nội bộ" : "Khách", group.group_kind === GroupKind.Internal ? "success" : "info")}</a>`).join("");
  return `
    <aside class="chat-info">
      <div class="profile-head">
        ${avatar(contact.zalo_uid, name, 72)}
        <div class="profile-name">${escapeHtml(name)}</div>
        ${contact.zalo_name && contact.zalo_name !== name ? `<div class="sub">Tên Zalo: ${escapeHtml(contact.zalo_name)}</div>` : ""}
        <div class="profile-chips">${chip(KIND_LABEL[contact.kind] ?? "", KIND_CLASS[contact.kind] ?? "muted")}
          ${contact.role ? chip(`Hỏi được bot · ${ROLE_LABEL[contact.role]}`, "warning") : ""}
          ${contact.tags.map((tag) => chip(tag, "tag")).join("")}</div>
      </div>
      ${data.notice ? `<div class="notice small">${escapeHtml(data.notice)}</div>` : ""}
      <form method="post" action="/contacts/${contact.id}/profile" class="profile-form">
        <input type="hidden" name="back" value="/conversations/${data.selected!.id}">
        <label>Loại
          <select name="kind">
            <option value="auto" ${auto ? "selected" : ""}>Theo nhóm${auto ? `: ${escapeHtml(KIND_LABEL[contact.kind] ?? "")}` : ""}</option>
            ${Object.entries(KIND_LABEL).map(([value, label]) =>
              `<option value="${value}" ${!auto && Number(value) === contact.kind ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
          </select></label>
        <label>Vai trò với bot <select name="role">${selectOptions(ROLE_LABEL, contact.role)}</select></label>
        <label>Công ty <select name="company"><option value="">—</option>${companyOptions}</select></label>
        <label>Thẻ <input type="text" name="tags" value="${escapeHtml(contact.tags.join(", "))}" placeholder="vip, đại lý, miền Nam…" maxlength="600">
          <span class="hint">Cách nhau bằng dấu phẩy</span></label>
        <label>Ghi chú <textarea name="note" rows="5" maxlength="5000" placeholder="Số điện thoại, nhu cầu, lưu ý khi chăm sóc…">${escapeHtml(contact.note ?? "")}</textarea></label>
        <button class="btn">Lưu hồ sơ</button>
      </form>
      <dl class="facts">
        <dt>Nhắn riêng bot</dt><dd>${contact.dm_count} tin</dd>
        <dt>Lần nhắn gần nhất</dt><dd>${escapeHtml(fullTime(contact.last_dm_at))}</dd>
        <dt>Bot thấy lần đầu</dt><dd>${escapeHtml(fullTime(contact.first_seen_at))}</dd>
        <dt>Mã Zalo</dt><dd class="mono">${escapeHtml(contact.zalo_uid)}</dd>
      </dl>
      ${groups ? `<div class="panel-section"><div class="panel-title">Nhóm chung với bot</div>${groups}</div>` : ""}
    </aside>`;
}

function renderGroupPanel(group: GroupProfile): string {
  const members = group.members.map((member) => {
    const inner = `${avatar(member.zalo_uid, member.name, 28)}<span>${escapeHtml(member.name || member.zalo_uid)}${member.is_admin ? ` <span class="sub">· trưởng/phó nhóm</span>` : ""}</span>
      ${chip(KIND_LABEL[member.kind] ?? "", KIND_CLASS[member.kind] ?? "muted")}`;
    return member.direct_thread_id
      ? `<a class="mini-row" href="/conversations/${member.direct_thread_id}">${inner}</a>`
      : `<div class="mini-row">${inner}</div>`;
  }).join("");
  return `
    <aside class="chat-info">
      <div class="profile-head">
        ${avatar(`t${group.id}`, group.label || group.name, 72, true)}
        <div class="profile-name">${escapeHtml(group.name)}</div>
        <div class="profile-chips">${chip(group.group_kind === GroupKind.Internal ? "Nhóm nội bộ" : "Nhóm khách hàng", group.group_kind === GroupKind.Internal ? "success" : "info")}
          ${group.company_name ? chip(group.company_name, "muted") : ""}
          ${group.read_messages ? chip("Đang đọc", "success") : chip("Không đọc", "danger")}
          ${group.capture_files ? chip("Lấy file", "muted") : ""}</div>
      </div>
      <a class="btn outline sm" href="/groups" style="margin:0 16px 12px">Cấu hình nhóm</a>
      <dl class="facts">
        <dt>Thành viên</dt><dd>${group.member_count}</dd>
        <dt>Mã nhóm</dt><dd class="mono">${escapeHtml(group.zalo_group_id)}</dd>
      </dl>
      <div class="panel-section"><div class="panel-title">Thành viên (${group.members.length}${group.members.length < group.member_count ? ` / ${group.member_count}` : ""})</div>${members}</div>
    </aside>`;
}

export function renderChatPage(data: ChatPageData): string {
  const panel = data.contact ? renderContactPanel(data.contact, data) : data.group ? renderGroupPanel(data.group) : `<aside class="chat-info"></aside>`;
  return renderPage(data.selected ? (data.selected.label || data.selected.name || "Hội thoại") : "Hội thoại", "/conversations", `
    <div class="chat-app">
      ${renderThreadList(data)}
      ${renderChat(data)}
      ${panel}
    </div>
    <script src="/static/chat.js"></script>`, { fullBleed: true });
}

// Cuộn khung chat xuống tin mới nhất khi mở; giữ chỗ khi bấm "Xem tin cũ hơn"
export const CHAT_SCRIPT = `
(function () {
  var box = document.getElementById("chat-scroll");
  if (box && location.search.indexOf("before=") < 0) box.scrollTop = box.scrollHeight;
  var active = document.querySelector(".thread.active");
  if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
})();
`;
