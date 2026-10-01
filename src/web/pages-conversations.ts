import { ContactKind, ContactKindSource, ContactRole } from "../constants.js";
import { escapeHtml, formatTime, renderPage } from "./html.js";
import type { CompanyOption } from "./pages.js";

// Màn Danh bạ. (Màn Hội thoại nằm ở pages-chat.ts.)

export interface ContactView {
  id: number;
  zalo_uid: string;
  display_name: string;
  zalo_name: string;
  kind: number;
  kind_source: number;
  role: number;
  company_id: number | null;
  note: string | null;
  last_dm_at: Date | null;
  dm_count: number;
  group_count: number;
  direct_thread_id: number | null;
  tags?: string[];
}

export interface ContactFilters {
  query: string;
  kind: number;
  role: number;
  onlyDirect: boolean;
  page: number;
}

const KIND_LABELS: [number, string][] = [
  [ContactKind.Unclassified, "Chưa phân loại"],
  [ContactKind.Customer, "Khách hàng"],
  [ContactKind.Staff, "Nhân sự"],
];
const ROLE_LABELS: [number, string][] = [
  [ContactRole.None, "Không — chỉ lưu"],
  [ContactRole.DepartmentHead, "Trưởng phòng"],
  [ContactRole.Manager, "Quản lý"],
];

function kindSelect(contact: { kind: number; kind_source: number }, formId: string): string {
  const auto = contact.kind_source === ContactKindSource.Auto;
  const current = KIND_LABELS.find(([value]) => value === contact.kind)?.[1] ?? "";
  // Tự động: chọn sẵn dòng "Theo nhóm"; chọn một loại cụ thể = chỉnh tay, tự động không ghi đè nữa
  const manualOptions = KIND_LABELS.map(([value, label]) =>
    `<option value="${value}" ${!auto && value === contact.kind ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  return `<select name="kind" form="${formId}" aria-label="Loại">
    <option value="auto" ${auto ? "selected" : ""}>Theo nhóm${auto ? `: ${escapeHtml(current)}` : ""}</option>${manualOptions}</select>
    <div class="sub">${auto ? "tự động" : "chỉnh tay"}</div>`;
}

function options(choices: [number, string][], selected: number): string {
  return choices.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

export function renderContactsPage(
  contacts: ContactView[],
  companies: CompanyOption[],
  filters: ContactFilters,
  hasMore: boolean,
  assistantEnabled: boolean,
): string {
  const rows = contacts.map((contact) => {
    const formId = `contact-form-${contact.id}`;
    const companyOptions = companies
      .filter((company) => company.is_active || company.id === contact.company_id)
      .map((company) => `<option value="${company.id}" ${company.id === contact.company_id ? "selected" : ""}>${escapeHtml(company.name)}</option>`)
      .join("");
    const name = contact.display_name || contact.zalo_name || contact.zalo_uid;
    return `
    <tr>
      <td><strong>${escapeHtml(name)}</strong>
        ${contact.zalo_name && contact.zalo_name !== name ? `<div class="sub">Tên Zalo: ${escapeHtml(contact.zalo_name)}</div>` : ""}
        <div class="sub">${escapeHtml(contact.zalo_uid)}</div>
        ${contact.tags?.length ? `<div class="profile-chips" style="justify-content:flex-start;margin-top:4px">${contact.tags.map((tag) => `<span class="badge tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}</td>
      <td>${contact.dm_count
        ? `${contact.direct_thread_id ? `<a href="/conversations/${contact.direct_thread_id}">${contact.dm_count} tin</a>` : `${contact.dm_count} tin`}<div class="sub">${escapeHtml(formatTime(contact.last_dm_at))}</div>`
        : `<span class="sub">Chưa nhắn</span>`}</td>
      <td>${contact.group_count}</td>
      <td>${kindSelect(contact, formId)}</td>
      <td><select name="role" form="${formId}" aria-label="Vai trò">${options(ROLE_LABELS, contact.role)}</select></td>
      <td><select name="company" form="${formId}" style="width:140px" aria-label="Công ty"><option value="">—</option>${companyOptions}</select></td>
      <td><input type="text" name="note" value="${escapeHtml(contact.note ?? "")}" form="${formId}" placeholder="SĐT, ghi chú…" style="width:150px"></td>
      <td><form id="${formId}" method="post" action="/contacts/${contact.id}"><button class="btn sm">Lưu</button></form></td>
    </tr>`;
  }).join("");
  const pageLink = (page: number) =>
    `/contacts?q=${encodeURIComponent(filters.query)}&kind=${filters.kind}&role=${filters.role}&direct=${filters.onlyDirect ? 1 : 0}&page=${page}`;
  const filtered = Boolean(filters.query) || filters.kind >= 0 || filters.role >= 0 || filters.onlyDirect;
  return renderPage("Danh bạ", "/contacts", `
    ${assistantEnabled ? "" : `<div class="notice">Trợ lý AI đang TẮT (chưa có GEMINI_API_KEY) — gán vai trò vẫn lưu được, nhưng bot chưa trả lời ai.</div>`}
    <form method="get" action="/contacts" class="toolbar">
      <input type="text" name="q" value="${escapeHtml(filters.query)}" placeholder="Tìm tên" style="width:200px">
      <select name="kind"><option value="-1">Mọi loại</option>${options(KIND_LABELS, filters.kind)}</select>
      <select name="role"><option value="-1">Mọi vai trò</option>${options(ROLE_LABELS, filters.role)}</select>
      <label class="check"><input type="checkbox" name="direct" value="1" ${filters.onlyDirect ? "checked" : ""}> Chỉ người đã nhắn riêng</label>
      <button class="btn outline">Lọc</button>
      ${filtered ? `<a class="btn outline" href="/contacts">Bỏ lọc</a>` : ""}
    </form>
    <div class="card table-card"><div class="table-scroll"><table>
      <thead><tr><th>Người</th><th>Nhắn riêng bot</th><th>Số nhóm</th><th>Loại</th><th>Vai trò với bot</th><th>Công ty</th><th>Ghi chú</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="empty">${filtered ? "Không có ai khớp bộ lọc." : "Danh bạ trống — người nhắn riêng cho bot và thành viên các nhóm sẽ tự vào đây."}</td></tr>`}</tbody>
    </table></div></div>
    <div class="pager">
      ${filters.page > 1 ? `<a class="btn outline sm" href="${pageLink(filters.page - 1)}">Trang trước</a>` : ""}
      ${hasMore ? `<a class="btn outline sm" href="${pageLink(filters.page + 1)}">Trang sau</a>` : ""}
    </div>`,
    { description: "Mọi người bot từng thấy: người nhắn riêng cho bot và thành viên các nhóm. Loại tự động theo nhóm (ở nhóm nội bộ → Nhân sự; chỉ ở nhóm khách hàng, hoặc chỉ nhắn riêng cho bot → Khách hàng); chọn tay một loại thì tự động không ghi đè nữa. Vai trò Quản lý / Trưởng phòng = bot trả lời tin riêng của người đó; để «Không» = chỉ lưu, không trả lời." });
}
