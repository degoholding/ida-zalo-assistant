import type { RowDataPacket } from "mysql2";
import { BotAccountStatus, ConversationType } from "../../constants.js";
import type { SyncService } from "../../sync-service.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";
import { contactAvatarUrl } from "./contacts-api.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";

// API Tài khoản bot: danh sách (kèm cờ đang chạy), chi tiết, bật / tắt, đăng nhập QR.

const LABEL_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export const ACCOUNT_LIST_SPEC: ListSpec = {
  fields: {
    label: { sql: "b.label", type: "text" },
    display_name: { sql: "b.display_name", type: "text" },
    status: { sql: "b.status", type: "number" },
    is_active: { sql: "b.is_active", type: "boolean" },
    last_heartbeat_at: { sql: "b.last_heartbeat_at", type: "date" },
  },
  sorts: { label: "b.label", last_heartbeat_at: "b.last_heartbeat_at", created_at: "b.created_at", group_count: "group_count" },
  defaultSort: { by: "label", dir: "asc" },
  tieBreaker: "b.id",
  search: { param: "q", columns: ["b.label", "b.display_name", "b.zalo_uid"] },
};

const ACCOUNT_FROM = "FROM bot_account b LEFT JOIN contact c ON c.zalo_uid = b.zalo_uid";
const ACCOUNT_COLUMNS = `
  b.id, b.label, b.zalo_uid, b.display_name, b.status, b.is_active, b.last_connected_at, b.last_heartbeat_at, b.created_at,
  c.avatar_key,
  (SELECT COUNT(*) FROM bot_group bg WHERE bg.bot_account_id = b.id AND bg.left_at IS NULL) AS group_count,
  (SELECT COUNT(*) FROM zalo_group d WHERE d.thread_type = ${ConversationType.Direct} AND d.owner_bot_id = b.id) AS direct_count`;

/** Trạng thái gộp cho giao diện — một chữ, tính từ is_active + status + cờ đang chạy. */
export function describeAccountState(row: { is_active: unknown; status: unknown; running: boolean }): { code: string; label: string } {
  if (!row.is_active) return { code: "off", label: "Đã tắt" };
  if (row.status === BotAccountStatus.NeedsLogin) return { code: "needs_login", label: "Hết phiên — cần quét QR lại" };
  if (!row.running) return { code: "stopped", label: "Không chạy" };
  if (row.status === BotAccountStatus.Connected) return { code: "listening", label: "Đang nghe" };
  return { code: "reconnecting", label: "Đang nối lại" };
}

function decorate(service: SyncService, rows: RowDataPacket[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const { avatar_key: avatarKey, ...rest } = row;
    const running = service.isRunning(row.id as number);
    const state = describeAccountState({ is_active: row.is_active, status: row.status, running });
    return {
      ...rest, running, state: state.code, state_label: state.label, is_active: Boolean(row.is_active),
      avatar_url: contactAvatarUrl(row.zalo_uid, avatarKey), group_count: Number(row.group_count), direct_count: Number(row.direct_count),
    };
  });
}

async function loadAccount(service: SyncService, id: number): Promise<Record<string, unknown>> {
  const [rows] = await service.db.query<RowDataPacket[]>(`SELECT ${ACCOUNT_COLUMNS} ${ACCOUNT_FROM} WHERE b.id = ?`, [id]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có tài khoản bot này");
  return decorate(service, rows)[0];
}

export async function getAccountDetail(service: SyncService, id: number): Promise<Record<string, unknown>> {
  const account = await loadAccount(service, id);
  const [groups] = await service.db.query<RowDataPacket[]>(
    `SELECT g.id, COALESCE(NULLIF(g.label, ''), g.name) AS name, g.member_count, g.read_messages, bg.joined_at, bg.left_at,
            IF(g.avatar_key IS NULL, NULL, CONCAT('/avatars/g/', g.id)) AS avatar_url
     FROM bot_group bg JOIN zalo_group g ON g.id = bg.group_id WHERE bg.bot_account_id = ? ORDER BY bg.left_at IS NOT NULL, name`, [id]);
  const [events] = await service.db.query<RowDataPacket[]>(
    "SELECT id, event, code, detail, created_at FROM session_event WHERE bot_account_id = ? ORDER BY id DESC LIMIT 30", [id]);
  return { ...account, groups, events };
}

export const accountRoutes: ApiRoute[] = [
  ["GET", /^\/api\/accounts$/, async ({ response, url, service }) =>
    sendOk(response, await runList(service.db, url.searchParams, ACCOUNT_LIST_SPEC, {
      select: ACCOUNT_COLUMNS, from: ACCOUNT_FROM, decorate: (rows) => decorate(service, rows),
    }))],
  ["GET", /^\/api\/accounts\/(\d+)$/, async ({ response, match, service }) => sendOk(response, await getAccountDetail(service, parseId(match[1])))],
  ["PATCH", /^\/api\/accounts\/(\d+)$/, async ({ request, response, match, service }) => {
    const id = parseId(match[1]);
    const before = await loadAccount(service, id);
    const body = await readJson(request);
    if (body.is_active === undefined) throw new ApiError(422, "validation_error", "Chỉ sửa được ô Đang dùng của tài khoản bot");
    const active = body.is_active === true || body.is_active === 1 || body.is_active === "1" || body.is_active === "true";
    await service.db.query("UPDATE bot_account SET is_active = ? WHERE id = ?", [active ? 1 : 0, id]);
    if (active) await service.restartAccount(id);
    else await service.stopAccount(id);
    if (active !== Boolean(before.is_active)) {
      await recordAudit(service.db, { entity: "bot_account", entityId: id, action: active ? "activate" : "deactivate" });
    }
    sendOk(response, await getAccountDetail(service, id), active ? "Đã bật tài khoản bot" : "Đã tắt tài khoản bot");
  }],
  // Đăng nhập QR: tạo lượt theo nhãn (mới hoặc quét lại), rồi giao diện hỏi trạng thái 2 giây một lần
  ["POST", /^\/api\/accounts\/qr-login$/, async ({ request, response, qrLogins }) => {
    const body = await readJson(request);
    const label = String(body.label ?? "").trim();
    if (!LABEL_PATTERN.test(label)) {
      throw new ApiError(422, "validation_error", "Nhãn chỉ gồm chữ không dấu, số, gạch ngang, gạch dưới (tối đa 100 ký tự)");
    }
    const attempt = qrLogins.start(label);
    sendOk(response, { id: attempt.id, label: attempt.label, phase: attempt.phase, message: attempt.message, qr_image: attempt.qrImage }, "Đang lấy mã QR");
  }],
  ["GET", /^\/api\/accounts\/qr-login\/([a-f0-9]{1,64})$/, async ({ response, match, qrLogins }) => {
    const attempt = qrLogins.get(match[1]);
    if (!attempt) throw new ApiError(404, "not_found", "Lượt đăng nhập này đã hết hạn — bấm lấy mã QR mới.");
    sendOk(response, { id: attempt.id, label: attempt.label, phase: attempt.phase, message: attempt.message, qr_image: attempt.qrImage });
  }],
];
