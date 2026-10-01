import { AttachmentStatus, BotAccountStatus, GroupKind } from "../constants.js";
import { APP_NAME, badge, escapeHtml, formatBytes, formatTime, renderPage, type BadgeTone } from "./html.js";

export function renderLoginPage(error: string): string {
  return renderPage("Đăng nhập", "/login", `
    <div class="card">
      <h1>${APP_NAME}</h1>
      <p class="sub">Đăng nhập khu quản trị</p>
      ${error ? `<p class="error-text">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/login">
        <input type="password" name="password" placeholder="Mật khẩu quản trị" autofocus required>
        <button class="btn">Đăng nhập</button>
      </form>
    </div>`, { bare: true });
}

export interface AccountView {
  id: number;
  label: string;
  zalo_uid: string | null;
  display_name: string;
  status: number;
  is_active: number;
  last_heartbeat_at: Date | null;
  running: boolean;
}

function accountStatusBadge(account: AccountView): string {
  if (!account.is_active) return badge("Đã tắt", "muted");
  if (account.status === BotAccountStatus.NeedsLogin) return badge("Hết phiên — cần quét QR lại", "danger");
  if (!account.running) return badge("Không chạy", "warning");
  if (account.status === BotAccountStatus.Connected) return badge("Đang nghe", "success");
  return badge("Đang nối lại", "warning");
}

export function renderAccountsPage(accounts: AccountView[]): string {
  const rows = accounts.map((account) => `
    <tr>
      <td><strong>${escapeHtml(account.label)}</strong></td>
      <td>${escapeHtml(account.display_name)}<div class="sub">${escapeHtml(account.zalo_uid ?? "")}</div></td>
      <td>${accountStatusBadge(account)}</td>
      <td>${escapeHtml(formatTime(account.last_heartbeat_at))}</td>
      <td><div class="actions">
        <form class="inline" method="post" action="/accounts/login">
          <input type="hidden" name="label" value="${escapeHtml(account.label)}">
          <button class="btn sm">Quét QR lại</button>
        </form>
        <form class="inline" method="post" action="/accounts/${account.id}/active">
          <input type="hidden" name="active" value="${account.is_active ? "0" : "1"}">
          <button class="btn outline sm">${account.is_active ? "Tắt" : "Bật"}</button>
        </form>
      </div></td>
    </tr>`).join("");
  return renderPage("Tài khoản bot", "/", `
    <div class="notice">Không mở Zalo Web bằng tài khoản bot — mỗi tài khoản chỉ một phiên web, mở là bot bị đá ra.
      Dùng tài khoản riêng cho bot, không dùng tài khoản chính của nhân sự.</div>
    <div class="card table-card"><div class="table-scroll"><table>
      <thead><tr><th>Nhãn</th><th>Tài khoản Zalo</th><th>Trạng thái</th><th>Nhịp tim gần nhất</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="empty">Chưa có tài khoản nào — thêm bên dưới.</td></tr>`}</tbody>
    </table></div></div>
    <div class="card">
      <h2>Thêm tài khoản bot</h2>
      <form method="post" action="/accounts/login" class="row-form">
        <input type="text" name="label" placeholder="Nhãn, vd bot-1" required maxlength="100" pattern="[A-Za-z0-9_-]+"
          title="Chỉ chữ không dấu, số, gạch ngang, gạch dưới">
        <button class="btn">Lấy mã QR</button>
      </form>
    </div>`, { description: "Tài khoản Zalo mà bot dùng để đọc các nhóm công việc." });
}

export function renderQrPage(attemptId: string, label: string): string {
  return renderPage("Quét mã QR", "/", `
    <div class="card qr-box" id="qr-box" data-attempt="${escapeHtml(attemptId)}">
      <h2>Tài khoản «${escapeHtml(label)}»</h2>
      <img id="qr-image" alt="Mã QR đăng nhập Zalo">
      <p id="qr-message" class="qr-message">Đang lấy mã QR từ Zalo…</p>
    </div>
    <a class="btn outline" href="/">Về danh sách tài khoản</a>
    <script src="/static/qr.js"></script>`,
    { description: "Mở app Zalo của tài khoản bot → biểu tượng QR → quét mã bên dưới." });
}

// Trang QR hỏi trạng thái 2 giây một lần; xong thì về danh sách tài khoản
export const QR_SCRIPT = `
(function () {
  var box = document.getElementById("qr-box");
  var image = document.getElementById("qr-image");
  var message = document.getElementById("qr-message");
  var id = box.getAttribute("data-attempt");
  function poll() {
    fetch("/api/qr/" + encodeURIComponent(id), { credentials: "same-origin" })
      .then(function (response) { return response.json(); })
      .then(function (state) {
        message.textContent = state.message || "";
        message.className = "qr-message" + (state.phase === "failed" ? " bad" : state.phase === "success" ? " ok" : "");
        if (state.qrImage) { image.src = state.qrImage; image.style.display = "block"; }
        else { image.style.display = "none"; }
        if (state.phase === "success") { setTimeout(function () { location.href = "/"; }, 2000); return; }
        if (state.phase === "failed") return;
        setTimeout(poll, 2000);
      })
      .catch(function () { setTimeout(poll, 4000); });
  }
  poll();
})();
`;

export interface GroupView {
  id: number;
  group_kind: number;
  zalo_group_id: string;
  company_id: number | null;
  name: string;
  label: string;
  member_count: number;
  read_messages: number;
  capture_files: number;
  retention_days: number;
  bot_count: number;
  message_count: number;
  last_message_at: Date | null;
}

export interface CompanyOption {
  id: number;
  code: string;
  name: string;
  is_active: number;
}

// Bộ lọc công ty: 0 = mọi công ty, -1 = chưa gán (company_id NULL), >0 = một công ty
export const COMPANY_FILTER_ALL = 0;
export const COMPANY_FILTER_UNASSIGNED = -1;

function companySelect(companies: CompanyOption[], selectedId: number | null, formId: string): string {
  // Công ty đã ngừng dùng vẫn hiện nếu nhóm đang gắn với nó, để lưu lại không bị gỡ mất
  const options = companies
    .filter((company) => company.is_active || company.id === selectedId)
    .map((company) => `<option value="${company.id}" ${company.id === selectedId ? "selected" : ""}>${escapeHtml(company.name)}</option>`)
    .join("");
  return `<select name="company" form="${formId}" style="width:160px" aria-label="Công ty"><option value="">— Chưa gán —</option>${options}</select>`;
}

export function renderGroupsPage(groups: GroupView[], query: string, companies: CompanyOption[], companyFilter: number, notice = ""): string {
  // Mỗi ô cấu hình một cột; các ô thuộc biểu mẫu của hàng qua thuộc tính form="..." (biểu mẫu
  // không lồng được qua nhiều <td>). Nhãn nằm ở tiêu đề cột nên thân bảng chỉ còn ô nhập — vừa 1280px.
  const rows = groups.map((group) => {
    const formId = `group-form-${group.id}`;
    return `
    <tr>
      <td><strong>${escapeHtml(group.name || "(chưa rõ tên)")}</strong>
        <div class="sub">${escapeHtml(group.zalo_group_id)} · ${group.member_count} thành viên</div>
        ${group.bot_count ? "" : badge("Không còn bot nào trong nhóm", "danger")}</td>
      <td>${group.message_count}<div class="sub">${escapeHtml(formatTime(group.last_message_at))}</div></td>
      <td><select name="group_kind" form="${formId}" aria-label="Loại nhóm">
        <option value="${GroupKind.Customer}" ${group.group_kind === GroupKind.Customer ? "selected" : ""}>Khách hàng</option>
        <option value="${GroupKind.Internal}" ${group.group_kind === GroupKind.Internal ? "selected" : ""}>Nội bộ</option>
      </select></td>
      <td>${companySelect(companies, group.company_id, formId)}</td>
      <td class="center"><input type="checkbox" name="read" value="1" form="${formId}" ${group.read_messages ? "checked" : ""} aria-label="Đọc tin"></td>
      <td class="center"><input type="checkbox" name="files" value="1" form="${formId}" ${group.capture_files ? "checked" : ""} aria-label="Lấy file"></td>
      <td><input type="text" name="label" value="${escapeHtml(group.label)}" placeholder="Tên gọi ngắn" maxlength="100" form="${formId}" style="width:120px"></td>
      <td><input type="number" name="retention" value="${group.retention_days}" min="1" max="3650" form="${formId}" style="width:76px" aria-label="Số ngày lưu"></td>
      <td><div class="actions">
        <form id="${formId}" method="post" action="/groups/${group.id}"><button class="btn sm">Lưu</button></form>
        <form method="post" action="/groups/${group.id}/backfill"><button class="btn outline sm" title="Lấy các tin gần nhất từ Zalo về kho">Lấy tin cũ</button></form>
      </div></td>
    </tr>`;
  }).join("");
  const filterOptions = [
    [COMPANY_FILTER_ALL, "Mọi công ty"],
    [COMPANY_FILTER_UNASSIGNED, "Chưa gán công ty"],
    ...companies.map((company): [number, string] => [company.id, company.name]),
  ].map(([value, label]) => `<option value="${value}" ${value === companyFilter ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const filtered = Boolean(query) || companyFilter !== COMPANY_FILTER_ALL;
  const empty = filtered
    ? "Không có nhóm nào khớp bộ lọc."
    : "Chưa có nhóm nào — thêm tài khoản bot vào nhóm Zalo, nhóm sẽ hiện ở đây.";
  return renderPage("Nhóm", "/groups", `
    ${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ""}
    <form method="get" action="/groups" class="toolbar">
      <select name="company">${filterOptions}</select>
      <input type="text" name="q" value="${escapeHtml(query)}" placeholder="Tìm tên nhóm" style="width:240px">
      <button class="btn outline">Lọc</button>
      ${filtered ? `<a class="btn outline" href="/groups">Bỏ lọc</a>` : ""}
    </form>
    <div class="card table-card"><div class="table-scroll"><table>
      <thead><tr><th>Nhóm</th><th>Tin đã lưu</th><th>Loại nhóm</th><th>Công ty</th><th class="center">Đọc tin</th><th class="center">Lấy file</th>
        <th>Tên gọi</th><th>Ngày lưu</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="9" class="empty">${empty}</td></tr>`}</tbody>
    </table></div></div>`,
    { description: "Nhóm mới mặc định KHÔNG đọc, chưa gán công ty, loại «Khách hàng». Loại nhóm quyết định thành viên là khách hàng hay nhân sự trong Danh bạ (ở bất kỳ nhóm nội bộ nào → nhân sự). «Lấy file» chỉ áp cho tệp gửi sau lúc bật. Quá «ngày lưu» là xóa cả tin lẫn tệp." });
}

export function renderCompaniesPage(companies: (CompanyOption & { group_count: number })[], error: string): string {
  const rows = companies.map((company) => `
    <tr>
      <td><strong>${escapeHtml(company.code)}</strong></td>
      <td>
        <form method="post" action="/companies/${company.id}" class="row-form nowrap">
          <input type="text" name="name" value="${escapeHtml(company.name)}" required maxlength="255" style="width:320px">
          <label class="check"><input type="checkbox" name="active" value="1" ${company.is_active ? "checked" : ""}> Đang dùng</label>
          <button class="btn sm">Lưu</button>
        </form>
      </td>
      <td>${company.group_count}</td>
    </tr>`).join("");
  return renderPage("Công ty", "/companies", `
    ${error ? `<div class="notice">${escapeHtml(error)}</div>` : ""}
    <div class="card table-card"><div class="table-scroll"><table>
      <thead><tr><th>Mã</th><th>Tên công ty</th><th>Số nhóm</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="empty">Chưa có công ty nào — thêm bên dưới.</td></tr>`}</tbody>
    </table></div></div>
    <div class="card">
      <h2>Thêm công ty</h2>
      <form method="post" action="/companies" class="row-form">
        <input type="text" name="code" placeholder="Mã, vd CTY-HCM" required maxlength="30" pattern="[A-Za-z0-9_-]+"
          title="Chữ không dấu, số, gạch ngang, gạch dưới" style="width:160px">
        <input type="text" name="name" placeholder="Tên công ty" required maxlength="255" style="width:320px">
        <button class="btn">Thêm</button>
      </form>
    </div>`,
    { description: "Công ty / pháp nhân trong cùng bộ cài. Nhóm Zalo gắn vào công ty; sau này quản lý công ty nào chỉ thấy nhóm của công ty đó. Mã không đổi được sau khi tạo." });
}

export interface FileView {
  id: number;
  file_name: string;
  file_ext: string;
  status: number;
  stored_bytes: number | null;
  declared_size: number | null;
  last_error: string;
  created_at: Date;
  sender_name: string;
  group_name: string;
  zalo_msg_type: string;
}

const STATUS_BADGES: Record<number, [string, BadgeTone]> = {
  [AttachmentStatus.Pending]: ["Đang tải", "info"],
  [AttachmentStatus.Stored]: ["Đã lưu", "success"],
  [AttachmentStatus.Failed]: ["Lỗi", "danger"],
  [AttachmentStatus.Skipped]: ["Không lấy", "muted"],
};

export interface FileFilters {
  groupId: number;
  status: number;
  query: string;
  page: number;
}

export function renderFilesPage(
  files: FileView[],
  groups: { id: number; name: string }[],
  filters: FileFilters,
  hasMore: boolean,
): string {
  const rows = files.map((file) => {
    const name = file.file_name || `(${file.zalo_msg_type})${file.file_ext ? "." + file.file_ext : ""}`;
    const [statusText, tone] = STATUS_BADGES[file.status] ?? ["", "muted"];
    const action = file.status === AttachmentStatus.Stored
      ? `<a class="btn sm" href="/files/${file.id}/download">Tải về</a>`
      : file.status === AttachmentStatus.Pending
        ? ""
        : `<form class="inline" method="post" action="/files/${file.id}/retry"><button class="btn outline sm">Tải vào kho</button></form>`;
    return `
    <tr>
      <td>${escapeHtml(formatTime(file.created_at))}</td>
      <td>${escapeHtml(file.group_name)}</td>
      <td>${escapeHtml(file.sender_name)}</td>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(formatBytes(file.stored_bytes ?? file.declared_size))}</td>
      <td>${badge(statusText, tone)}${file.last_error ? `<div class="sub">${escapeHtml(file.last_error)}</div>` : ""}</td>
      <td><div class="actions">${action}</div></td>
    </tr>`;
  }).join("");
  const groupOptions = groups.map((group) =>
    `<option value="${group.id}" ${group.id === filters.groupId ? "selected" : ""}>${escapeHtml(group.name || group.id)}</option>`).join("");
  // Mảng chứ không phải object: khóa "-1" không phải chỉ số mảng nên object tự xếp nó xuống cuối
  const statusChoices: [string, string][] = [["-1", "Mọi trạng thái"],
    ...Object.entries(STATUS_BADGES).map(([value, [label]]): [string, string] => [value, label])];
  const statusOptions = statusChoices
    .map(([value, label]) => `<option value="${value}" ${Number(value) === filters.status ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const pageLink = (page: number) =>
    `/files?group=${filters.groupId}&status=${filters.status}&q=${encodeURIComponent(filters.query)}&page=${page}`;
  const filtered = Boolean(filters.query || filters.groupId || filters.status >= 0);
  return renderPage("Tệp", "/files", `
    <form method="get" action="/files" class="toolbar">
      <select name="group"><option value="0">Mọi nhóm</option>${groupOptions}</select>
      <select name="status">${statusOptions}</select>
      <input type="text" name="q" value="${escapeHtml(filters.query)}" placeholder="Tên tệp" style="width:220px">
      <button class="btn outline">Lọc</button>
      ${filtered ? `<a class="btn outline" href="/files">Bỏ lọc</a>` : ""}
    </form>
    <div class="card table-card"><div class="table-scroll"><table>
      <thead><tr><th>Lúc gửi</th><th>Nhóm</th><th>Người gửi</th><th>Tệp</th><th>Cỡ</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="empty">${filtered ? "Không có tệp khớp bộ lọc." : "Chưa có tệp nào."}</td></tr>`}</tbody>
    </table></div></div>
    <div class="pager">
      ${filters.page > 1 ? `<a class="btn outline sm" href="${pageLink(filters.page - 1)}">Trang trước</a>` : ""}
      ${hasMore ? `<a class="btn outline sm" href="${pageLink(filters.page + 1)}">Trang sau</a>` : ""}
    </div>`,
    { description: "Tệp, ảnh, video gửi trong các nhóm đang đọc. «Tải vào kho» thử lấy lại tệp lỗi hoặc tệp của nhóm chưa bật lấy file." });
}
