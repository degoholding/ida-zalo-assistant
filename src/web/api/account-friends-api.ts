import type { RowDataPacket } from "mysql2";
import { FriendRequestDirection } from "../../constants.js";
import type { SyncService } from "../../sync-service.js";
import {
  DAILY_OUTGOING_FRIEND_REQUEST_CAP,
  DEFAULT_FRIEND_REQUEST_MESSAGE,
  FriendRequestError,
  MAX_FRIEND_REQUEST_MESSAGE_LENGTH,
  countOutgoingSince,
  listFriendRequests,
  startOfVietnamDay,
  type FriendRequestManager,
  type FriendRequestRow,
} from "../../zalo/friend-requests.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";

// API tab «Kết bạn» ở trang tài khoản bot (08/10/2026): tra số điện thoại, bot mời kết bạn, đồng ý / từ chối lời mời
// đến, rút lời mời đã gửi. Chỉ quản trị (route-permissions: /api/accounts… = bot_account). Lệnh sang Zalo cần tài khoản
// đang chạy; danh sách thì đọc từ bảng friend_request dù tài khoản đang tắt.

/** Lời mời đã gửi hiện tối đa ngần này dòng gần nhất (đang chờ lên đầu). */
const SENT_LIST_LIMIT = 100;
const INCOMING_LIST_LIMIT = 200;
const UID_IN_PATH = "(\\d{1,30})";

async function loadAccountName(service: SyncService, id: number): Promise<string> {
  const [rows] = await service.db.query<RowDataPacket[]>("SELECT label FROM bot_account WHERE id = ?", [id]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có tài khoản bot này");
  return String(rows[0].label);
}

function requireManager(service: SyncService, id: number): FriendRequestManager {
  const manager = service.friendsFor(id);
  if (!manager) throw new ApiError(409, "account_not_running", "Tài khoản bot đang tắt hoặc chưa kết nối Zalo — bật tài khoản (hoặc quét QR lại) rồi thử lại.");
  return manager;
}

/** Lỗi nghiệp vụ kết bạn → ApiError cùng mã HTTP và câu tiếng Việt. */
async function translateFriendError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FriendRequestError) throw new ApiError(error.status, error.code, error.message);
    throw error;
  }
}

function decorateRequest(row: FriendRequestRow): Record<string, unknown> {
  return {
    id: Number(row.id), zalo_uid: row.zalo_uid, display_name: row.display_name, avatar_url: row.avatar_url || null, message: row.message,
    direction: row.direction, status: row.status, requested_at: row.requested_at, updated_at: row.updated_at,
  };
}

const describePerson = (row: { display_name?: string; zalo_uid: string }) => `«${row.display_name || row.zalo_uid}» (${row.zalo_uid})`;

/** Ảnh lấy từ kết quả tra — chỉ nhận đường http(s), còn lại bỏ. */
function cleanAvatarUrl(value: unknown): string {
  const url = typeof value === "string" ? value.trim() : "";
  return /^https?:\/\//i.test(url) && url.length <= 500 ? url : "";
}

export async function getFriendOverview(service: SyncService, id: number, refresh: boolean): Promise<Record<string, unknown>> {
  await loadAccountName(service, id);
  const manager = service.friendsFor(id);
  if (manager) await manager.refresh({ force: refresh });
  const [incoming, sent, sentToday] = await Promise.all([
    listFriendRequests(service.db, id, FriendRequestDirection.Incoming, { onlyPending: true, limit: INCOMING_LIST_LIMIT }),
    listFriendRequests(service.db, id, FriendRequestDirection.Outgoing, { onlyPending: false, limit: SENT_LIST_LIMIT }),
    countOutgoingSince(service.db, id, startOfVietnamDay(new Date())),
  ]);
  return {
    running: Boolean(manager), incoming: incoming.map(decorateRequest), sent: sent.map(decorateRequest),
    sent_today: sentToday, daily_cap: DAILY_OUTGOING_FRIEND_REQUEST_CAP,
    default_message: DEFAULT_FRIEND_REQUEST_MESSAGE, max_message_length: MAX_FRIEND_REQUEST_MESSAGE_LENGTH,
  };
}

export const accountFriendRoutes: ApiRoute[] = [
  ["GET", /^\/api\/accounts\/(\d+)\/friends$/, async ({ response, match, url, service }) => {
    sendOk(response, await getFriendOverview(service, parseId(match[1]), url.searchParams.get("refresh") === "1"));
  }],
  // Tra người theo số điện thoại (không ghi gì — không cần nhật ký)
  ["GET", /^\/api\/accounts\/(\d+)\/friends\/search$/, async ({ response, match, url, service }) => {
    const id = parseId(match[1]);
    await loadAccountName(service, id);
    const phone = url.searchParams.get("phone") ?? "";
    if (!phone.trim()) throw new ApiError(422, "validation_error", "Nhập số điện thoại cần tìm");
    sendOk(response, await translateFriendError(() => requireManager(service, id).search(phone)));
  }],
  ["POST", /^\/api\/accounts\/(\d+)\/friends\/requests$/, async ({ request, response, match, service }) => {
    const id = parseId(match[1]);
    await loadAccountName(service, id);
    const body = await readJson(request);
    const uid = typeof body.uid === "string" || typeof body.uid === "number" ? String(body.uid).trim() : "";
    if (!uid) throw new ApiError(422, "validation_error", "Thiếu người cần mời (tra số điện thoại trước)");
    if (body.message !== undefined && typeof body.message !== "string") throw new ApiError(422, "validation_error", "Lời nhắn phải là chữ");
    const displayName = typeof body.display_name === "string" ? body.display_name.trim().slice(0, 255) : "";
    const manager = requireManager(service, id);
    const result = await translateFriendError(() => manager.sendRequest({
      uid, message: body.message as string | undefined, displayName, avatarUrl: cleanAvatarUrl(body.avatar_url),
    }));
    await recordAudit(service.db, { entity: "bot_account", entityId: id, action: "friend_request", message: `${result.text}: ${describePerson({ display_name: displayName, zalo_uid: uid })}` });
    sendOk(response, { status: result.status, ...(await manager.dailyUsage()) }, result.text);
  }],
  ["POST", new RegExp(`^/api/accounts/(\\d+)/friends/requests/${UID_IN_PATH}/cancel$`), async ({ response, match, service }) => {
    const id = parseId(match[1]);
    await loadAccountName(service, id);
    const row = await translateFriendError(() => requireManager(service, id).cancel(match[2]));
    await recordAudit(service.db, { entity: "bot_account", entityId: id, action: "friend_cancel", message: `Rút lời mời kết bạn ${describePerson(row)}` });
    sendOk(response, null, "Đã rút lại lời mời kết bạn");
  }],
  ["POST", new RegExp(`^/api/accounts/(\\d+)/friends/incoming/${UID_IN_PATH}/(accept|reject)$`), async ({ response, match, service }) => {
    const id = parseId(match[1]);
    await loadAccountName(service, id);
    const manager = requireManager(service, id);
    const accept = match[3] === "accept";
    const row = await translateFriendError(() => (accept ? manager.accept(match[2]) : manager.reject(match[2])));
    await recordAudit(service.db, {
      entity: "bot_account", entityId: id, action: accept ? "friend_accept" : "friend_reject",
      message: `${accept ? "Đồng ý" : "Từ chối"} lời mời kết bạn của ${describePerson(row)}`,
    });
    sendOk(response, null, accept ? "Đã đồng ý kết bạn — giờ người này thêm được bot vào nhóm Zalo" : "Đã từ chối lời mời");
  }],
];
