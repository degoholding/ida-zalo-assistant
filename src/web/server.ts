import http from "node:http";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { AttachmentStatus, ContactKind, ContactRole, ConversationType, GroupKind } from "../constants.js";
import { createLogger, describeError } from "../logger.js";
import { CompanyInputError, createCompany, listCompanies, updateCompany } from "../sync/company-repository.js";
import { getContactTags, parseTags, setContactTags, updateContact } from "../sync/contact-repository.js";
import { updateGroupSettings } from "../sync/group-repository.js";
import type { SyncService } from "../sync-service.js";
import { AdminAuth, SESSION_COOKIE } from "./auth.js";
import { escapeHtml, renderPage, setBrandPrimary } from "./html.js";
import {
  QR_SCRIPT,
  COMPANY_FILTER_ALL,
  COMPANY_FILTER_UNASSIGNED,
  renderAccountsPage,
  renderCompaniesPage,
  renderFilesPage,
  renderGroupsPage,
  renderLoginPage,
  renderQrPage,
  type AccountView,
  type CompanyOption,
  type FileView,
  type GroupView,
} from "./pages.js";
import { CHAT_SCRIPT, renderChatPage, type ChatMessage, type ChatPageData, type ContactProfile, type GroupProfile, type ThreadListItem } from "./pages-chat.js";
import { renderContactsPage, type ContactView } from "./pages-conversations.js";
import { QrLoginManager } from "./qr-login.js";

const MAX_BODY_BYTES = 64 * 1024;
const FILES_PAGE_SIZE = 100;
const CONTACTS_PAGE_SIZE = 100;
const TIMELINE_PAGE_SIZE = 100;
const LABEL_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const log = createLogger("web");

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name) cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

async function readForm(request: http.IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Dữ liệu gửi lên quá lớn");
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function setSecurityHeaders(response: http.ServerResponse): void {
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Content-Type-Options", "nosniff");
  // same-origin (không phải no-referrer): no-referrer khiến trình duyệt gửi "Origin: null" cho form cùng trang
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self'; frame-ancestors 'none'");
}

function sendHtml(response: http.ServerResponse, html: string, status = 200): void {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(html);
}

function redirect(response: http.ServerResponse, location: string, headers: Record<string, string> = {}): void {
  response.writeHead(303, { Location: location, ...headers });
  response.end();
}

// Không có Origin, hoặc "null" (chế độ riêng tư) thì để cookie SameSite=Strict lo; có Origin thật thì phải khớp
function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || origin === "null") return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function intParam(value: string | null, fallback: number): number {
  // Number(null) và Number("") đều ra 0 — mà 0 là một trạng thái thật (Đang tải), không phải "không lọc"
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function startWebServer(service: SyncService): Promise<http.Server> {
  const { db, config, storage, downloader } = service;
  setBrandPrimary(config.web.brandPrimary);
  const auth = new AdminAuth(config.web.adminPassword);
  const qrLogins = new QrLoginManager(service);
  const cookieFlags = `HttpOnly; SameSite=Strict; Path=/${config.web.cookieSecure ? "; Secure" : ""}`;

  async function handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    setSecurityHeaders(response);
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    const path = url.pathname;
    const forwardedIp = config.web.trustCloudflareIp ? request.headers["cf-connecting-ip"] : undefined;
    const clientKey = String(forwardedIp ?? request.socket.remoteAddress ?? "");
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];

    if (path === "/static/chat.js") {
      response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      response.end(CHAT_SCRIPT);
      return;
    }
    if (path === "/static/qr.js") {
      response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      response.end(QR_SCRIPT);
      return;
    }
    if (path === "/login" && method === "GET") return sendHtml(response, renderLoginPage(""));
    if (path === "/login" && method === "POST") {
      if (auth.isLocked(clientKey)) {
        return sendHtml(response, renderLoginPage("Sai mật khẩu quá nhiều lần — thử lại sau 15 phút."), 429);
      }
      const form = await readForm(request);
      const session = auth.login(clientKey, form.get("password") ?? "");
      if (!session) {
        log.warn(`đăng nhập quản trị sai từ ${clientKey}`);
        return sendHtml(response, renderLoginPage("Sai mật khẩu."), 401);
      }
      return redirect(response, "/", { "Set-Cookie": `${SESSION_COOKIE}=${session}; ${cookieFlags}; Max-Age=43200` });
    }

    if (!auth.isValid(token)) {
      if (path.startsWith("/api/")) throw new HttpError(401, "Phiên đăng nhập đã hết");
      return redirect(response, "/login");
    }
    // Chặn gửi biểu mẫu từ trang khác (cookie SameSite=Strict đã chặn, đây là lớp thứ hai)
    if (method === "POST") {
      if (!isSameOrigin(request.headers.origin, request.headers.host)) throw new HttpError(403, "Sai nguồn gửi");
    }

    if (path === "/logout" && method === "POST") {
      auth.logout(token);
      return redirect(response, "/login", { "Set-Cookie": `${SESSION_COOKIE}=; ${cookieFlags}; Max-Age=0` });
    }

    // ---- Tài khoản bot ----
    if (path === "/" && method === "GET") {
      const [rows] = await db.query<RowDataPacket[]>(
        "SELECT id, label, zalo_uid, display_name, status, is_active, last_heartbeat_at FROM bot_account ORDER BY id");
      const accounts = rows.map((row) => ({ ...row, running: service.isRunning(row.id) })) as AccountView[];
      return sendHtml(response, renderAccountsPage(accounts));
    }
    if (path === "/accounts/login" && method === "POST") {
      const label = (await readForm(request)).get("label")?.trim() ?? "";
      if (!LABEL_PATTERN.test(label)) throw new HttpError(400, "Nhãn chỉ gồm chữ không dấu, số, gạch ngang, gạch dưới");
      const attempt = qrLogins.start(label);
      return redirect(response, `/accounts/login/${attempt.id}`);
    }
    const qrPage = /^\/accounts\/login\/([a-f0-9]+)$/.exec(path);
    if (qrPage && method === "GET") {
      const attempt = qrLogins.get(qrPage[1]);
      if (!attempt) return redirect(response, "/");
      return sendHtml(response, renderQrPage(attempt.id, attempt.label));
    }
    const qrApi = /^\/api\/qr\/([a-f0-9]+)$/.exec(path);
    if (qrApi && method === "GET") {
      const attempt = qrLogins.get(qrApi[1]);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify(attempt
        ? { phase: attempt.phase, message: attempt.message, qrImage: attempt.qrImage }
        : { phase: "failed", message: "Lượt đăng nhập này đã hết hạn — quay lại và bấm lấy mã QR mới.", qrImage: "" }));
      return;
    }
    const accountActive = /^\/accounts\/(\d+)\/active$/.exec(path);
    if (accountActive && method === "POST") {
      const accountId = Number(accountActive[1]);
      const active = (await readForm(request)).get("active") === "1";
      await db.query("UPDATE bot_account SET is_active = ? WHERE id = ?", [active ? 1 : 0, accountId]);
      if (active) await service.restartAccount(accountId);
      else await service.stopAccount(accountId);
      return redirect(response, "/");
    }

    // ---- Nhóm ----
    if (path === "/groups" && method === "GET") {
      const query = (url.searchParams.get("q") ?? "").trim();
      const companyFilter = intParam(url.searchParams.get("company"), COMPANY_FILTER_ALL);
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT g.id, g.group_kind, g.zalo_group_id, g.company_id, g.name, g.label, g.member_count, g.read_messages,
                g.capture_files, g.retention_days,
                (SELECT COUNT(*) FROM bot_group bg WHERE bg.group_id = g.id AND bg.left_at IS NULL) AS bot_count,
                (SELECT COUNT(*) FROM message m WHERE m.group_id = g.id) AS message_count,
                (SELECT MAX(m.sent_at) FROM message m WHERE m.group_id = g.id) AS last_message_at
         FROM zalo_group g
         WHERE g.thread_type = ${ConversationType.Group}
           AND (? = '' OR g.name LIKE ? OR g.label LIKE ?)
           AND (? = ${COMPANY_FILTER_ALL}
                OR (? = ${COMPANY_FILTER_UNASSIGNED} AND g.company_id IS NULL)
                OR g.company_id = ?)
         ORDER BY g.read_messages DESC, g.name`,
        [query, `%${query}%`, `%${query}%`, companyFilter, companyFilter, companyFilter]);
      const companies = await listCompanies(db);
      const notice = (url.searchParams.get("notice") ?? "").slice(0, 300);
      return sendHtml(response, renderGroupsPage(rows as GroupView[], query, companies, companyFilter, notice));
    }
    const groupBackfill = /^\/groups\/(\d+)\/backfill$/.exec(path);
    if (groupBackfill && method === "POST") {
      let notice: string;
      try {
        const result = await service.backfillGroup(Number(groupBackfill[1]));
        notice = result.fetched === 0
          ? "Zalo không trả tin cũ nào cho nhóm này: Zalo đã đóng đường lấy lịch sử nhóm từ khoảng 06/2026 " +
            "(thư viện zca-js chưa có cách thay). Bot chỉ lưu được tin từ lúc bật «Đọc tin» trở đi."
          : `Cách lấy: ${result.method}. Zalo trả ${result.fetched} tin của nhóm${result.oldest ? ` (cũ nhất lúc ${result.oldest.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })})` : ""}, đang có trong kho ${result.stored} tin trong số đó.`;
      } catch (error) {
        notice = `Lấy tin cũ không được: ${describeError(error)}`;
      }
      return redirect(response, `/groups?notice=${encodeURIComponent(notice)}`);
    }
    const groupUpdate = /^\/groups\/(\d+)$/.exec(path);
    if (groupUpdate && method === "POST") {
      const form = await readForm(request);
      const retention = intParam(form.get("retention"), 730);
      if (retention < 1 || retention > 3650) throw new HttpError(400, "Thời hạn lưu phải từ 1 đến 3650 ngày");
      const rawCompany = form.get("company") ?? "";
      let companyId: number | null = null;
      if (rawCompany !== "") {
        companyId = Number(rawCompany);
        const companies = await listCompanies(db);
        if (!companies.some((company) => company.id === companyId)) throw new HttpError(400, "Công ty không tồn tại");
      }
      const groupKind = intParam(form.get("group_kind"), GroupKind.Customer);
      if (!Object.values(GroupKind).includes(groupKind)) throw new HttpError(400, "Loại nhóm không hợp lệ");
      const [before] = await db.query<RowDataPacket[]>("SELECT read_messages FROM zalo_group WHERE id = ?", [Number(groupUpdate[1])]);
      const turningOnRead = form.get("read") === "1" && before[0] && !before[0].read_messages;
      await updateGroupSettings(db, Number(groupUpdate[1]), {
        groupKind,
        readMessages: form.get("read") === "1",
        captureFiles: form.get("files") === "1",
        label: (form.get("label") ?? "").trim(),
        retentionDays: retention,
        companyId,
      });
      // Vừa bật đọc: lấy luôn tin gần nhất, khỏi chờ có tin mới mới thấy nhóm có nội dung
      if (turningOnRead) {
        try {
          const result = await service.backfillGroup(Number(groupUpdate[1]));
          const text = result.fetched
            ? `Đã bật đọc và lấy ${result.stored} tin gần nhất.`
            : "Đã bật đọc. Zalo không cho lấy tin cũ của nhóm (đường lịch sử nhóm đã đóng) — bot lưu từ bây giờ trở đi.";
          return redirect(response, `/groups?notice=${encodeURIComponent(text)}`);
        } catch (error) {
          return redirect(response, `/groups?notice=${encodeURIComponent(`Đã bật đọc; lấy tin cũ không được: ${describeError(error)}`)}`);
        }
      }
      return redirect(response, "/groups");
    }

    // ---- Hội thoại (kiểu Zalo / Telegram: danh sách | khung chat | hồ sơ) ----
    const conversationMatch = /^\/conversations(?:\/(\d+))?$/.exec(path);
    if (conversationMatch && method === "GET") {
      const typeFilter = intParam(url.searchParams.get("type"), -1);
      const query = (url.searchParams.get("q") ?? "").trim();
      const [threads] = await db.query<RowDataPacket[]>(
        `SELECT g.id, g.thread_type, g.name, g.label, x.message_count, x.last_message_at,
                (SELECT m.text FROM message m WHERE m.group_id = g.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_text,
                (SELECT m.sender_name FROM message m WHERE m.group_id = g.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_sender
         FROM zalo_group g
         LEFT JOIN (SELECT group_id, COUNT(*) AS message_count, MAX(sent_at) AS last_message_at FROM message GROUP BY group_id) x
           ON x.group_id = g.id
         WHERE (? < 0 OR g.thread_type = ?) AND (? = '' OR g.name LIKE ? OR g.label LIKE ?)
           AND (g.thread_type = ${ConversationType.Direct} OR g.read_messages = 1)
         ORDER BY x.last_message_at IS NULL, x.last_message_at DESC LIMIT 300`,
        [typeFilter, typeFilter, query, `%${query}%`, `%${query}%`]);
      const companies = await listCompanies(db);
      const data: ChatPageData = {
        threads: threads.map((row) => ({ ...row, message_count: Number(row.message_count ?? 0) })) as ThreadListItem[],
        typeFilter, query, selected: null, messages: [], olderCursor: null, botUids: new Set(), contact: null, group: null,
        companies, notice: (url.searchParams.get("notice") ?? "").slice(0, 200),
      };
      if (conversationMatch[1]) {
        const [selectedRows] = await db.query<RowDataPacket[]>(
          "SELECT id, thread_type, name, label, zalo_group_id FROM zalo_group WHERE id = ?", [Number(conversationMatch[1])]);
        const selected = selectedRows[0];
        if (!selected) throw new HttpError(404, "Không có cuộc trò chuyện này");
        data.selected = { id: selected.id, thread_type: selected.thread_type, name: selected.name, label: selected.label };
        // Xếp theo GIỜ GỬI (không theo id): tin bù về sau vẫn nằm đúng chỗ trong dòng thời gian
        const beforeMs = intParam(url.searchParams.get("before"), 0);
        const [rows] = await db.query<RowDataPacket[]>(
          `SELECT m.id, m.sender_uid, m.sender_name, m.sent_at, m.text, m.kind, m.zalo_msg_type, m.quote_text, m.recalled_at,
                  a.id AS attachment_id, a.file_name, a.file_ext, a.status AS attachment_status, a.stored_bytes, a.declared_size
           FROM message m LEFT JOIN attachment a ON a.message_id = m.id
           WHERE m.group_id = ? AND (? = 0 OR m.sent_at < ?)
           ORDER BY m.sent_at DESC, m.id DESC LIMIT ?`,
          [selected.id, beforeMs, new Date(beforeMs), TIMELINE_PAGE_SIZE]);
        rows.reverse();
        data.messages = rows as ChatMessage[];
        data.olderCursor = rows.length === TIMELINE_PAGE_SIZE ? new Date(rows[0].sent_at).getTime() : null;
        const [bots] = await db.query<RowDataPacket[]>("SELECT zalo_uid FROM bot_account WHERE zalo_uid IS NOT NULL");
        data.botUids = new Set(bots.map((bot) => String(bot.zalo_uid)));
        if (selected.thread_type === ConversationType.Direct) {
          const [contacts] = await db.query<RowDataPacket[]>(
            `SELECT id, zalo_uid, display_name, zalo_name, kind, kind_source, role, company_id, note, first_seen_at, last_dm_at, dm_count
             FROM contact WHERE zalo_uid = ?`, [selected.zalo_group_id]);
          if (contacts[0]) {
            const [groups] = await db.query<RowDataPacket[]>(
              `SELECT g.id, COALESCE(NULLIF(g.label, ''), g.name) AS name, g.group_kind FROM group_member gm
               JOIN zalo_group g ON g.id = gm.group_id WHERE gm.zalo_uid = ? AND gm.left_at IS NULL AND g.thread_type = ${ConversationType.Group}
               ORDER BY g.name`, [selected.zalo_group_id]);
            const tags = await getContactTags(db, [contacts[0].id as number]);
            data.contact = { ...(contacts[0] as ContactProfile), tags: tags.get(contacts[0].id as number) ?? [],
              groups: groups as ContactProfile["groups"] };
          }
        } else {
          const [groups] = await db.query<RowDataPacket[]>(
            `SELECT g.id, g.name, g.label, g.zalo_group_id, g.group_kind, g.member_count, g.read_messages, g.capture_files, c.name AS company_name
             FROM zalo_group g LEFT JOIN company c ON c.id = g.company_id WHERE g.id = ?`, [selected.id]);
          const [members] = await db.query<RowDataPacket[]>(
            `SELECT gm.zalo_uid, COALESCE(NULLIF(gm.display_name, ''), NULLIF(c.display_name, ''), c.zalo_name, gm.zalo_uid) AS name,
                    COALESCE(c.kind, 0) AS kind, gm.is_admin,
                    (SELECT d.id FROM zalo_group d WHERE d.thread_type = ${ConversationType.Direct} AND d.zalo_group_id = gm.zalo_uid LIMIT 1) AS direct_thread_id
             FROM group_member gm LEFT JOIN contact c ON c.zalo_uid = gm.zalo_uid
             WHERE gm.group_id = ? AND gm.left_at IS NULL
             ORDER BY gm.is_admin DESC, name LIMIT 200`, [selected.id]);
          data.group = { ...(groups[0] as GroupProfile), members: members as GroupProfile["members"] };
        }
      }
      return sendHtml(response, renderChatPage(data));
    }
    const profileUpdate = /^\/contacts\/(\d+)\/profile$/.exec(path);
    if (profileUpdate && method === "POST") {
      const form = await readForm(request);
      const contactId = Number(profileUpdate[1]);
      const rawKind = form.get("kind") ?? "auto";
      const kind = rawKind === "auto" ? "auto" as const : intParam(rawKind, ContactKind.Unclassified);
      const role = intParam(form.get("role"), ContactRole.None);
      if (kind !== "auto" && !Object.values(ContactKind).includes(kind)) throw new HttpError(400, "Loại không hợp lệ");
      if (!Object.values(ContactRole).includes(role)) throw new HttpError(400, "Vai trò không hợp lệ");
      const rawCompany = form.get("company") ?? "";
      let companyId: number | null = null;
      if (rawCompany !== "") {
        companyId = Number(rawCompany);
        const companies = await listCompanies(db);
        if (!companies.some((company) => company.id === companyId)) throw new HttpError(400, "Công ty không tồn tại");
      }
      await updateContact(db, contactId, { kind, role, companyId, note: form.get("note") ?? "" });
      await setContactTags(db, contactId, parseTags(form.get("tags") ?? ""));
      // Chỉ quay về đường dẫn nội bộ — không nhận URL ngoài từ biểu mẫu
      const back = form.get("back") ?? "";
      const target = /^\/conversations\/\d+$/.test(back) ? back : "/contacts";
      return redirect(response, `${target}?notice=${encodeURIComponent("Đã lưu hồ sơ.")}`);
    }

    // ---- Danh bạ ----
    if (path === "/contacts" && method === "GET") {
      const filters = {
        query: (url.searchParams.get("q") ?? "").trim(),
        kind: intParam(url.searchParams.get("kind"), -1),
        role: intParam(url.searchParams.get("role"), -1),
        onlyDirect: url.searchParams.get("direct") === "1",
        page: Math.max(1, intParam(url.searchParams.get("page"), 1)),
      };
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT c.id, c.zalo_uid, c.display_name, c.zalo_name, c.kind, c.kind_source, c.role, c.company_id, c.note, c.last_dm_at, c.dm_count,
                (SELECT COUNT(*) FROM group_member gm WHERE gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL) AS group_count,
                (SELECT g.id FROM zalo_group g WHERE g.thread_type = ${ConversationType.Direct} AND g.zalo_group_id = c.zalo_uid
                 ORDER BY g.id LIMIT 1) AS direct_thread_id
         FROM contact c
         WHERE (? = '' OR c.display_name LIKE ? OR c.zalo_name LIKE ?)
           AND (? < 0 OR c.kind = ?) AND (? < 0 OR c.role = ?) AND (? = 0 OR c.dm_count > 0)
         ORDER BY c.role DESC, c.last_dm_at IS NULL, c.last_dm_at DESC, c.display_name
         LIMIT ? OFFSET ?`,
        [filters.query, `%${filters.query}%`, `%${filters.query}%`, filters.kind, filters.kind, filters.role, filters.role,
         filters.onlyDirect ? 1 : 0, CONTACTS_PAGE_SIZE + 1, (filters.page - 1) * CONTACTS_PAGE_SIZE]);
      const companies = await listCompanies(db);
      const page = rows.slice(0, CONTACTS_PAGE_SIZE) as ContactView[];
      const tags = await getContactTags(db, page.map((contact) => contact.id));
      for (const contact of page) contact.tags = tags.get(contact.id) ?? [];
      return sendHtml(response, renderContactsPage(page, companies, filters,
        rows.length > CONTACTS_PAGE_SIZE, service.assistant !== null));
    }
    const contactUpdate = /^\/contacts\/(\d+)$/.exec(path);
    if (contactUpdate && method === "POST") {
      const form = await readForm(request);
      const rawKind = form.get("kind") ?? "auto";
      const kind = rawKind === "auto" ? "auto" as const : intParam(rawKind, ContactKind.Unclassified);
      const role = intParam(form.get("role"), ContactRole.None);
      if (kind !== "auto" && !Object.values(ContactKind).includes(kind)) throw new HttpError(400, "Loại không hợp lệ");
      if (!Object.values(ContactRole).includes(role)) throw new HttpError(400, "Vai trò không hợp lệ");
      const rawCompany = form.get("company") ?? "";
      let companyId: number | null = null;
      if (rawCompany !== "") {
        companyId = Number(rawCompany);
        const companies = await listCompanies(db);
        if (!companies.some((company) => company.id === companyId)) throw new HttpError(400, "Công ty không tồn tại");
      }
      await updateContact(db, Number(contactUpdate[1]), { kind, role, companyId, note: form.get("note") ?? "" });
      return redirect(response, request.headers.referer?.includes("/contacts") ? new URL(request.headers.referer).pathname + new URL(request.headers.referer).search : "/contacts");
    }

    // ---- Công ty ----
    const showCompanies = async (error = "", status = 200) => {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT c.id, c.code, c.name, c.is_active,
                (SELECT COUNT(*) FROM zalo_group g WHERE g.company_id = c.id) AS group_count
         FROM company c ORDER BY c.name`);
      sendHtml(response, renderCompaniesPage(rows as (CompanyOption & { group_count: number })[], error), status);
    };
    if (path === "/companies" && method === "GET") return showCompanies();
    if (path === "/companies" && method === "POST") {
      const form = await readForm(request);
      try {
        await createCompany(db, form.get("code") ?? "", form.get("name") ?? "");
      } catch (error) {
        if (error instanceof CompanyInputError) return showCompanies(error.message, 400);
        throw error;
      }
      return redirect(response, "/companies");
    }
    const companyUpdate = /^\/companies\/(\d+)$/.exec(path);
    if (companyUpdate && method === "POST") {
      const form = await readForm(request);
      try {
        await updateCompany(db, Number(companyUpdate[1]), form.get("name") ?? "", form.get("active") === "1");
      } catch (error) {
        if (error instanceof CompanyInputError) return showCompanies(error.message, 400);
        throw error;
      }
      return redirect(response, "/companies");
    }

    // ---- Tệp ----
    if (path === "/files" && method === "GET") {
      const filters = {
        groupId: intParam(url.searchParams.get("group"), 0),
        status: intParam(url.searchParams.get("status"), -1),
        query: (url.searchParams.get("q") ?? "").trim(),
        page: Math.max(1, intParam(url.searchParams.get("page"), 1)),
      };
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT a.id, a.file_name, a.file_ext, a.status, a.stored_bytes, a.declared_size, a.last_error, m.sent_at AS created_at,
                m.sender_name, m.zalo_msg_type, COALESCE(NULLIF(g.label, ''), g.name) AS group_name
         FROM attachment a JOIN message m ON m.id = a.message_id JOIN zalo_group g ON g.id = a.group_id
         WHERE (? = 0 OR a.group_id = ?) AND (? < 0 OR a.status = ?) AND (? = '' OR a.file_name LIKE ?)
         ORDER BY a.id DESC LIMIT ? OFFSET ?`,
        [filters.groupId, filters.groupId, filters.status, filters.status, filters.query, `%${filters.query}%`,
         FILES_PAGE_SIZE + 1, (filters.page - 1) * FILES_PAGE_SIZE]);
      const [groups] = await db.query<RowDataPacket[]>(
        "SELECT id, COALESCE(NULLIF(label, ''), name) AS name FROM zalo_group ORDER BY name");
      return sendHtml(response, renderFilesPage(rows.slice(0, FILES_PAGE_SIZE) as FileView[],
        groups as { id: number; name: string }[], filters, rows.length > FILES_PAGE_SIZE));
    }
    const fileDownload = /^\/files\/(\d+)\/download$/.exec(path);
    if (fileDownload && method === "GET") {
      const [rows] = await db.query<RowDataPacket[]>(
        "SELECT storage_key, file_name, file_ext FROM attachment WHERE id = ? AND status = ?",
        [Number(fileDownload[1]), AttachmentStatus.Stored]);
      const file = rows[0];
      if (!file?.storage_key) throw new HttpError(404, "Tệp chưa có trong kho");
      const stream = await storage.read(file.storage_key);
      const downloadName = String(file.storage_key).split("/").pop() ?? "tep";
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        // Tên tệp tiếng Việt: filename* theo RFC 5987, kèm bản ASCII cho trình duyệt cũ
        "Content-Disposition": `attachment; filename="${downloadName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      });
      stream.pipe(response);
      return;
    }
    const fileRetry = /^\/files\/(\d+)\/retry$/.exec(path);
    if (fileRetry && method === "POST") {
      const attachmentId = Number(fileRetry[1]);
      const [result] = await db.query<ResultSetHeader>(
        "UPDATE attachment SET status = ?, attempts = 0, last_error = '' WHERE id = ? AND status IN (?, ?)",
        [AttachmentStatus.Pending, attachmentId, AttachmentStatus.Failed, AttachmentStatus.Skipped]);
      if (result.affectedRows) downloader.enqueue(attachmentId);
      return redirect(response, "/files");
    }

    throw new HttpError(404, "Không có trang này");
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) log.error(`${request.method} ${request.url} lỗi: ${describeError(error)}`);
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const message = error instanceof HttpError ? error.message : "Lỗi máy chủ — xem log.";
      if (request.url?.startsWith("/api/")) {
        response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ phase: "failed", message }));
      } else {
        sendHtml(response, renderPage("Lỗi", "", `<div class="card"><p class="error-text">${escapeHtml(message)}</p><a class="btn outline" href="/">Về trang chính</a></div>`), status);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(config.web.port, config.web.host, () => {
      log.info(`giao diện quản trị: http://${config.web.host}:${config.web.port}`);
      resolve(server);
    });
  });
}

