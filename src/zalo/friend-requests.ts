import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  FriendEventType,
  FriendRecommendationsType,
  type FriendEvent,
  type GetFriendRecommendationsResponse,
  type GetFriendRequestStatusResponse,
  type GetSentFriendRequestResponse,
  type UserBasic,
  type UserInfoResponse,
} from "zca-js";
import { FriendRequestDirection, FriendRequestStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { describeError } from "../logger.js";
import { upsertMemberContact } from "../sync/contact-repository.js";

// Kết bạn với tài khoản bot (tab «Kết bạn» ở trang tài khoản bot, 08/10/2026): nhân sự kết bạn với bot rồi kéo bot vào
// nhóm Zalo công việc để bot đọc. Lời mời ghi ở bảng friend_request; mọi lệnh gửi sang Zalo đi qua hàng gửi của tài khoản
// (ZaloSender) như tin nhắn — tra số điện thoại / gửi lời mời dồn dập là cách nhanh nhất để Zalo khóa tài khoản.

/** Trần lời mời bot GỬI mỗi ngày (giờ Việt Nam) — quá thì Zalo dễ đánh dấu tài khoản là máy rải lời mời. */
export const DAILY_OUTGOING_FRIEND_REQUEST_CAP = 30;
export const DEFAULT_FRIEND_REQUEST_MESSAGE =
  "Chào anh/chị, em là Bot trợ lý. Anh/chị đồng ý kết bạn để thêm em vào nhóm Zalo công việc nhé.";
/** Zalo cắt lời nhắn kèm lời mời ở khoảng này — dài hơn thì báo trước thay vì để Zalo từ chối. */
export const MAX_FRIEND_REQUEST_MESSAGE_LENGTH = 150;
/** Danh sách tự hỏi lại Zalo tối đa mỗi ngần này (bấm «Làm mới» thì hỏi ngay). */
const REFRESH_MIN_INTERVAL_MS = 60_000;
/** Mỗi lượt làm mới hỏi trạng thái từng người tối đa ngần này lần — đừng dồn dập. */
const MAX_STATUS_CHECKS_PER_REFRESH = 10;
const VIETNAM_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const ZALO_UID_PATTERN = /^\d{1,30}$/;

// Mã lỗi Zalo của sendFriendRequest (chú thích trong zca-js)
const ZALO_ALREADY_FRIEND = 225;
const ZALO_BLOCKED = 215;
const ZALO_THEY_ALREADY_REQUESTED = 222;

/** Lỗi nghiệp vụ kèm mã HTTP — tầng API đổi thành ApiError, câu tiếng Việt đưa thẳng ra giao diện. */
export class FriendRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Số điện thoại Việt Nam (di động) → dạng `84xxxxxxxxx` mà Zalo tra được. Nhận «0912 345 678», «+84 912.345.678»,
 * «0084912345678», «912345678». Sai / không phải số di động → null.
 */
export function normalizeVietnamesePhone(raw: string): string | null {
  const compact = String(raw ?? "").trim().replace(/[\s.\-()]/g, "");
  if (!compact || compact.length > 20) return null;
  let digits = compact.startsWith("+") ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith("0084")) digits = digits.slice(4);
  else if (digits.startsWith("84") && digits.length === 11) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  // Đầu số di động Việt Nam hiện hành: 3x, 5x, 7x, 8x, 9x — 9 chữ số sau mã nước
  return /^[35789]\d{8}$/.test(digits) ? `84${digits}` : null;
}

/** 0 giờ (giờ Việt Nam, UTC+7, không đổi giờ mùa) của ngày chứa `now`. */
export function startOfVietnamDay(now: Date): Date {
  const shifted = now.getTime() + VIETNAM_OFFSET_MS;
  return new Date(shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - VIETNAM_OFFSET_MS);
}

export interface FriendRequestRow {
  id: number;
  bot_account_id: number;
  zalo_uid: string;
  display_name: string;
  avatar_url: string;
  message: string;
  direction: FriendRequestDirection;
  status: FriendRequestStatus;
  requested_at: Date;
  updated_at: Date;
}

/** Ghi (hoặc gửi lại / nhận lại) một lời mời đang chờ. Tên / ảnh rỗng thì giữ bản cũ. */
export async function recordPendingFriendRequest(
  db: Db,
  entry: { botAccountId: number; zaloUid: string; direction: FriendRequestDirection; displayName?: string; avatarUrl?: string; message?: string; at: Date },
): Promise<void> {
  await db.query(
    `INSERT INTO friend_request (bot_account_id, zalo_uid, display_name, avatar_url, message, direction, status, requested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = IF(VALUES(display_name) = '', display_name, VALUES(display_name)),
       avatar_url = IF(VALUES(avatar_url) = '', avatar_url, VALUES(avatar_url)),
       message = VALUES(message), status = VALUES(status), requested_at = VALUES(requested_at)`,
    [entry.botAccountId, entry.zaloUid, (entry.displayName ?? "").slice(0, 255), (entry.avatarUrl ?? "").slice(0, 500),
     (entry.message ?? "").slice(0, 500), entry.direction, FriendRequestStatus.Pending, entry.at],
  );
}

/** Đổi trạng thái lời mời ĐANG CHỜ (chiều cho trước, hoặc cả hai chiều). Trả số dòng đổi. */
export async function settleFriendRequest(
  db: Db, botAccountId: number, zaloUid: string, direction: FriendRequestDirection | null, status: FriendRequestStatus,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE friend_request SET status = ? WHERE bot_account_id = ? AND zalo_uid = ? AND status = ? ${direction === null ? "" : "AND direction = ?"}`,
    direction === null ? [status, botAccountId, zaloUid, FriendRequestStatus.Pending] : [status, botAccountId, zaloUid, FriendRequestStatus.Pending, direction],
  );
  return result.affectedRows;
}

export async function findFriendRequest(db: Db, botAccountId: number, zaloUid: string, direction: FriendRequestDirection): Promise<FriendRequestRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM friend_request WHERE bot_account_id = ? AND zalo_uid = ? AND direction = ?", [botAccountId, zaloUid, direction]);
  return (rows[0] as FriendRequestRow | undefined) ?? null;
}

/** Lời mời một chiều: đang chờ lên đầu, rồi mới nhất trước. `onlyPending` = chỉ lời mời còn chờ. */
export async function listFriendRequests(db: Db, botAccountId: number, direction: FriendRequestDirection, options: { onlyPending: boolean; limit: number }): Promise<FriendRequestRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT * FROM friend_request WHERE bot_account_id = ? AND direction = ? ${options.onlyPending ? "AND status = ?" : ""}
     ORDER BY status = ${FriendRequestStatus.Pending} DESC, requested_at DESC, id DESC LIMIT ?`,
    options.onlyPending ? [botAccountId, direction, FriendRequestStatus.Pending, options.limit] : [botAccountId, direction, options.limit],
  );
  return rows as FriendRequestRow[];
}

/** Số lời mời bot đã gửi từ 0 giờ hôm nay (giờ Việt Nam). */
export async function countOutgoingSince(db: Db, botAccountId: number, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM friend_request WHERE bot_account_id = ? AND direction = ? AND requested_at >= ?",
    [botAccountId, FriendRequestDirection.Outgoing, since]);
  return Number(rows[0]?.n ?? 0);
}

/** Phần API zca-js mà việc kết bạn cần — bài kiểm truyền bản giả, không chạm Zalo thật. */
export interface FriendApi {
  findUser(phoneNumber: string): Promise<UserBasic>;
  sendFriendRequest(msg: string, userId: string): Promise<unknown>;
  acceptFriendRequest(friendId: string): Promise<unknown>;
  rejectFriendRequest(friendId: string): Promise<unknown>;
  undoFriendRequest(friendId: string): Promise<unknown>;
  getSentFriendRequest(): Promise<GetSentFriendRequestResponse>;
  getFriendRequestStatus(friendId: string): Promise<GetFriendRequestStatusResponse>;
  getFriendRecommendations(): Promise<GetFriendRecommendationsResponse>;
  getUserInfo(userId: string | string[]): Promise<UserInfoResponse>;
}

/** Quan hệ giữa bot và một người tra theo số điện thoại. */
export type FriendRelation = "self" | "friend" | "requested" | "incoming" | "none";

export interface FriendSearchResult {
  uid: string;
  display_name: string;
  zalo_name: string;
  avatar_url: string;
  relation: FriendRelation;
}

export interface FriendRequestManagerDeps {
  db: Db;
  botAccountId: number;
  ownUid: () => string;
  /** null = phiên Zalo chưa sẵn sàng. */
  api: () => FriendApi | null;
  /** Hàng gửi của tài khoản (ZaloSender.send) — giãn cách giữa các lệnh gửi sang Zalo. */
  send: <T>(task: () => Promise<T>) => Promise<T>;
  now?: () => Date;
  warn?: (message: string, error?: unknown) => void;
}

function zaloCode(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

const zaloFailure = (action: string, error: unknown) =>
  new FriendRequestError(502, "zalo_error", `Zalo không ${action}: ${describeError(error)}`);

export class FriendRequestManager {
  private lastRefreshAt = 0;

  constructor(private readonly deps: FriendRequestManagerDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private requireApi(): FriendApi {
    const api = this.deps.api();
    if (!api) throw new FriendRequestError(409, "account_not_running", "Tài khoản bot chưa kết nối Zalo — bật tài khoản hoặc quét QR lại rồi thử lại.");
    return api;
  }

  private assertUid(uid: string): void {
    if (!ZALO_UID_PATTERN.test(uid)) throw new FriendRequestError(422, "validation_error", "Mã Zalo không hợp lệ");
    if (uid === this.deps.ownUid()) throw new FriendRequestError(422, "validation_error", "Đây là chính tài khoản bot");
  }

  /** Tra người theo số điện thoại + quan hệ với bot (đã là bạn / đã mời / đang mời bot / chưa gì). */
  async search(rawPhone: string): Promise<FriendSearchResult> {
    const phone = normalizeVietnamesePhone(rawPhone);
    if (!phone) throw new FriendRequestError(422, "invalid_phone", "Số điện thoại không đúng — nhập số di động Việt Nam, vd 0912 345 678");
    const api = this.requireApi();
    let user: UserBasic | undefined;
    try {
      user = await this.deps.send(() => api.findUser(phone));
    } catch (error) {
      throw zaloFailure("tra được số này", error);
    }
    const uid = String(user?.uid ?? "");
    if (!uid) throw new FriendRequestError(404, "not_found", "Không tìm thấy tài khoản Zalo của số này (hoặc người đó tắt cho tìm bằng số điện thoại)");
    const result = {
      uid, display_name: String(user?.display_name || user?.zalo_name || ""), zalo_name: String(user?.zalo_name ?? ""), avatar_url: String(user?.avatar ?? ""),
    };
    if (uid === this.deps.ownUid()) return { ...result, relation: "self" };
    return { ...result, relation: await this.relationOf(api, uid) };
  }

  private async relationOf(api: FriendApi, uid: string): Promise<FriendRelation> {
    try {
      const status = await api.getFriendRequestStatus(uid);
      if (Number(status.is_friend) === 1) return "friend";
    } catch (error) {
      this.deps.warn?.(`hỏi trạng thái kết bạn ${uid} lỗi`, error);
    }
    const outgoing = await findFriendRequest(this.deps.db, this.deps.botAccountId, uid, FriendRequestDirection.Outgoing);
    if (outgoing?.status === FriendRequestStatus.Pending) return "requested";
    const incoming = await findFriendRequest(this.deps.db, this.deps.botAccountId, uid, FriendRequestDirection.Incoming);
    if (incoming?.status === FriendRequestStatus.Pending) return "incoming";
    return "none";
  }

  /** Lời mời bot đã gửi hôm nay (giờ Việt Nam) / trần. */
  async dailyUsage(): Promise<{ sent_today: number; daily_cap: number }> {
    return { sent_today: await countOutgoingSince(this.deps.db, this.deps.botAccountId, startOfVietnamDay(this.now())), daily_cap: DAILY_OUTGOING_FRIEND_REQUEST_CAP };
  }

  /** Bot mời một người kết bạn. Người đó đã mời bot trước thì Zalo coi là đồng ý luôn. */
  async sendRequest(input: { uid: string; message?: string; displayName?: string; avatarUrl?: string }): Promise<{ status: FriendRequestStatus; text: string }> {
    const uid = String(input.uid ?? "").trim();
    this.assertUid(uid);
    const message = (input.message ?? "").trim() || DEFAULT_FRIEND_REQUEST_MESSAGE;
    if (message.length > MAX_FRIEND_REQUEST_MESSAGE_LENGTH) {
      throw new FriendRequestError(422, "validation_error", `Lời nhắn tối đa ${MAX_FRIEND_REQUEST_MESSAGE_LENGTH} ký tự`);
    }
    const api = this.requireApi();
    const { db, botAccountId } = this.deps;
    const existing = await findFriendRequest(db, botAccountId, uid, FriendRequestDirection.Outgoing);
    if (existing?.status === FriendRequestStatus.Pending) throw new FriendRequestError(409, "already_requested", "Bot đã mời người này rồi, đang chờ họ đồng ý");
    if (existing?.status === FriendRequestStatus.Accepted) throw new FriendRequestError(409, "already_friend", "Người này đã là bạn của bot");
    const { sent_today: sentToday, daily_cap: cap } = await this.dailyUsage();
    if (sentToday >= cap) {
      throw new FriendRequestError(429, "daily_cap",
        `Hôm nay bot đã gửi ${sentToday}/${cap} lời mời kết bạn — gửi nhiều hơn Zalo dễ khóa tài khoản bot. Mai gửi tiếp nhé.`);
    }
    const at = this.now();
    try {
      await this.deps.send(() => api.sendFriendRequest(message, uid));
    } catch (error) {
      const code = zaloCode(error);
      if (code === ZALO_ALREADY_FRIEND || code === ZALO_THEY_ALREADY_REQUESTED) {
        // Đã là bạn, hoặc họ đã mời bot trước (Zalo tính là đồng ý) — ghi nhận là bạn
        await recordPendingFriendRequest(db, { botAccountId, zaloUid: uid, direction: FriendRequestDirection.Outgoing, displayName: input.displayName, avatarUrl: input.avatarUrl, message, at });
        await settleFriendRequest(db, botAccountId, uid, null, FriendRequestStatus.Accepted);
        await this.addToContacts(uid, input.displayName ?? "", input.avatarUrl ?? "");
        return { status: FriendRequestStatus.Accepted, text: "Người này đã là bạn của bot" };
      }
      if (code === ZALO_BLOCKED) throw new FriendRequestError(422, "blocked", "Người này đã chặn bot hoặc không nhận lời mời kết bạn");
      throw zaloFailure("nhận lời mời", error);
    }
    await recordPendingFriendRequest(db, { botAccountId, zaloUid: uid, direction: FriendRequestDirection.Outgoing, displayName: input.displayName, avatarUrl: input.avatarUrl, message, at });
    return { status: FriendRequestStatus.Pending, text: "Đã gửi lời mời kết bạn" };
  }

  private async requirePending(uid: string, direction: FriendRequestDirection): Promise<FriendRequestRow> {
    this.assertUid(uid);
    const row = await findFriendRequest(this.deps.db, this.deps.botAccountId, uid, direction);
    if (!row || row.status !== FriendRequestStatus.Pending) {
      throw new FriendRequestError(404, "not_found", direction === FriendRequestDirection.Incoming ? "Không còn lời mời này — bấm Làm mới" : "Không có lời mời đang chờ cho người này");
    }
    return row;
  }

  /** Đồng ý lời mời của một người — họ vào Danh bạ, rồi kéo bot vào nhóm được. */
  async accept(uid: string): Promise<FriendRequestRow> {
    const row = await this.requirePending(uid, FriendRequestDirection.Incoming);
    const api = this.requireApi();
    try {
      await this.deps.send(() => api.acceptFriendRequest(uid));
    } catch (error) {
      if (zaloCode(error) !== ZALO_ALREADY_FRIEND) throw zaloFailure("đồng ý được", error);
    }
    await settleFriendRequest(this.deps.db, this.deps.botAccountId, uid, null, FriendRequestStatus.Accepted);
    await this.addToContacts(uid, row.display_name, row.avatar_url);
    return row;
  }

  async reject(uid: string): Promise<FriendRequestRow> {
    const row = await this.requirePending(uid, FriendRequestDirection.Incoming);
    const api = this.requireApi();
    try {
      await this.deps.send(() => api.rejectFriendRequest(uid));
    } catch (error) {
      throw zaloFailure("từ chối được", error);
    }
    await settleFriendRequest(this.deps.db, this.deps.botAccountId, uid, FriendRequestDirection.Incoming, FriendRequestStatus.Rejected);
    return row;
  }

  /** Rút lại lời mời bot đã gửi. */
  async cancel(uid: string): Promise<FriendRequestRow> {
    const row = await this.requirePending(uid, FriendRequestDirection.Outgoing);
    const api = this.requireApi();
    try {
      await this.deps.send(() => api.undoFriendRequest(uid));
    } catch (error) {
      throw zaloFailure("rút lại được lời mời", error);
    }
    await settleFriendRequest(this.deps.db, this.deps.botAccountId, uid, FriendRequestDirection.Outgoing, FriendRequestStatus.Cancelled);
    return row;
  }

  /**
   * Đối chiếu bảng với Zalo: lời mời đến lúc bot tắt (getFriendRecommendations), lời mời bot gửi còn chờ không
   * (getSentFriendRequest); người không còn trong danh sách chờ thì hỏi trạng thái — đã là bạn / không. Tự hỏi tối đa
   * mỗi phút một lần; `force` (nút Làm mới) thì hỏi ngay. Lỗi Zalo chỉ ghi log — danh sách vẫn trả từ bảng.
   */
  async refresh(options: { force: boolean }): Promise<boolean> {
    const api = this.deps.api();
    if (!api) return false;
    const nowMs = this.now().getTime();
    if (!options.force && nowMs - this.lastRefreshAt < REFRESH_MIN_INTERVAL_MS) return false;
    this.lastRefreshAt = nowMs;
    const { db, botAccountId } = this.deps;
    try {
      let checks = 0;
      const checkGone = async (row: FriendRequestRow, goneStatus: FriendRequestStatus) => {
        if (checks >= MAX_STATUS_CHECKS_PER_REFRESH) return;
        checks += 1;
        const status = await api.getFriendRequestStatus(row.zalo_uid);
        if (Number(status.is_friend) === 1) {
          await settleFriendRequest(db, botAccountId, row.zalo_uid, null, FriendRequestStatus.Accepted);
          await this.addToContacts(row.zalo_uid, row.display_name, row.avatar_url);
        } else {
          await settleFriendRequest(db, botAccountId, row.zalo_uid, row.direction, goneStatus);
        }
      };

      const sent = await api.getSentFriendRequest().catch((error) => {
        // Zalo trả lỗi khi chưa gửi lời mời nào — coi như danh sách rỗng
        this.deps.warn?.("lấy lời mời đã gửi lỗi", error);
        return null;
      });
      if (sent) {
        for (const info of Object.values(sent)) {
          const uid = String(info.userId ?? "");
          if (!ZALO_UID_PATTERN.test(uid)) continue;
          const existing = await findFriendRequest(db, botAccountId, uid, FriendRequestDirection.Outgoing);
          if (existing?.status === FriendRequestStatus.Pending) continue;
          // Lời mời gửi từ điện thoại của bot (ngoài giao diện) — ghi vào để thấy; mốc theo giờ gửi thật (gửi hôm nay thì tính vào trần)
          const at = info.fReqInfo?.time ? new Date(Number(info.fReqInfo.time) * (Number(info.fReqInfo.time) < 1e12 ? 1000 : 1)) : this.now();
          await recordPendingFriendRequest(db, { botAccountId, zaloUid: uid, direction: FriendRequestDirection.Outgoing,
            displayName: info.displayName || info.zaloName, avatarUrl: info.avatar, message: info.fReqInfo?.message ?? "", at });
        }
        const pendingSent = await listFriendRequests(db, botAccountId, FriendRequestDirection.Outgoing, { onlyPending: true, limit: 200 });
        for (const row of pendingSent) if (!sent[row.zalo_uid]) await checkGone(row, FriendRequestStatus.Rejected);
      }

      const recommendations = await api.getFriendRecommendations().catch((error) => {
        this.deps.warn?.("lấy lời mời đến lỗi", error);
        return null;
      });
      if (recommendations) {
        const incomingUids = new Set<string>();
        for (const item of recommendations.recommItems ?? []) {
          const info = item.dataInfo;
          if (!info || info.recommType !== FriendRecommendationsType.ReceivedFriendRequest) continue;
          const uid = String(info.userId ?? "");
          if (!ZALO_UID_PATTERN.test(uid)) continue;
          incomingUids.add(uid);
          const existing = await findFriendRequest(db, botAccountId, uid, FriendRequestDirection.Incoming);
          if (existing?.status === FriendRequestStatus.Pending) continue;
          const at = info.recommTime ? new Date(Number(info.recommTime) < 1e12 ? Number(info.recommTime) * 1000 : Number(info.recommTime)) : this.now();
          await recordPendingFriendRequest(db, { botAccountId, zaloUid: uid, direction: FriendRequestDirection.Incoming,
            displayName: info.displayName || info.zaloName, avatarUrl: info.avatar, message: info.recommInfo?.message ?? "", at });
        }
        const pendingIncoming = await listFriendRequests(db, botAccountId, FriendRequestDirection.Incoming, { onlyPending: true, limit: 200 });
        for (const row of pendingIncoming) if (!incomingUids.has(row.zalo_uid)) await checkGone(row, FriendRequestStatus.Cancelled);
      }
    } catch (error) {
      this.deps.warn?.("đối chiếu lời mời kết bạn với Zalo lỗi", error);
    }
    return true;
  }

  /**
   * Sự kiện kết bạn từ listener zca-js. Sự kiện do chính bot làm (isSelf) bỏ qua — thao tác từ giao diện đã tự ghi.
   *   REQUEST: người khác mời bot → lời mời đến đang chờ (tên / ảnh hỏi Zalo vì sự kiện không mang theo).
   *   ADD: hai bên thành bạn (ai đồng ý cũng vậy) → mọi lời mời đang chờ với người đó = đã đồng ý, người đó vào Danh bạ.
   *   REJECT_REQUEST: người kia từ chối lời mời của bot. UNDO_REQUEST: người kia rút lời mời gửi bot.
   */
  async handleEvent(event: FriendEvent): Promise<void> {
    if (event.isSelf) return;
    const { db, botAccountId } = this.deps;
    const ownUid = this.deps.ownUid();
    switch (event.type) {
      case FriendEventType.REQUEST: {
        const fromUid = String(event.data.fromUid ?? "");
        if (!ZALO_UID_PATTERN.test(fromUid) || fromUid === ownUid || (ownUid && String(event.data.toUid) !== ownUid)) return;
        const profile = await this.lookupProfile(fromUid);
        await recordPendingFriendRequest(db, { botAccountId, zaloUid: fromUid, direction: FriendRequestDirection.Incoming,
          displayName: profile.displayName, avatarUrl: profile.avatar, message: String(event.data.message ?? ""), at: this.now() });
        return;
      }
      case FriendEventType.ADD: {
        const uid = String(event.data ?? "");
        if (!ZALO_UID_PATTERN.test(uid) || uid === ownUid) return;
        await settleFriendRequest(db, botAccountId, uid, null, FriendRequestStatus.Accepted);
        const [rows] = await db.query<RowDataPacket[]>(
          "SELECT display_name, avatar_url FROM friend_request WHERE bot_account_id = ? AND zalo_uid = ? ORDER BY updated_at DESC LIMIT 1", [botAccountId, uid]);
        const known = rows[0] ? { displayName: String(rows[0].display_name), avatar: String(rows[0].avatar_url) } : await this.lookupProfile(uid);
        await this.addToContacts(uid, known.displayName, known.avatar);
        return;
      }
      case FriendEventType.REJECT_REQUEST:
      case FriendEventType.UNDO_REQUEST: {
        const other = String(event.data.fromUid === ownUid ? event.data.toUid : event.data.fromUid);
        if (!ZALO_UID_PATTERN.test(other) || other === ownUid) return;
        if (event.type === FriendEventType.REJECT_REQUEST) {
          await settleFriendRequest(db, botAccountId, other, FriendRequestDirection.Outgoing, FriendRequestStatus.Rejected);
        } else {
          await settleFriendRequest(db, botAccountId, other, FriendRequestDirection.Incoming, FriendRequestStatus.Cancelled);
        }
        return;
      }
      default:
        return;
    }
  }

  /** Tên + ảnh: Danh bạ có thì dùng, không thì hỏi Zalo (getUserInfo). Lỗi → rỗng, không chặn việc ghi lời mời. */
  private async lookupProfile(uid: string): Promise<{ displayName: string; avatar: string }> {
    const [rows] = await this.deps.db.query<RowDataPacket[]>(
      "SELECT COALESCE(NULLIF(display_name, ''), zalo_name) AS name, avatar_url FROM contact WHERE zalo_uid = ?", [uid]);
    if (rows[0]?.name && rows[0]?.avatar_url) return { displayName: String(rows[0].name), avatar: String(rows[0].avatar_url) };
    const api = this.deps.api();
    if (!api) return { displayName: String(rows[0]?.name ?? ""), avatar: String(rows[0]?.avatar_url ?? "") };
    try {
      const info = await api.getUserInfo(uid);
      const profile = info.changed_profiles?.[uid] ?? info.changed_profiles?.[`${uid}_0`];
      return { displayName: String(profile?.displayName || profile?.zaloName || rows[0]?.name || ""), avatar: String(profile?.avatar || rows[0]?.avatar_url || "") };
    } catch (error) {
      this.deps.warn?.(`lấy hồ sơ ${uid} lỗi`, error);
      return { displayName: String(rows[0]?.name ?? ""), avatar: String(rows[0]?.avatar_url ?? "") };
    }
  }

  /** Bạn mới của bot vào Danh bạ (nếu chưa có) — để nhắn riêng / gán vai trò được ngay. */
  private async addToContacts(uid: string, displayName: string, avatarUrl: string): Promise<void> {
    await upsertMemberContact(this.deps.db, uid, displayName, "", avatarUrl).catch((error) => this.deps.warn?.(`ghi Danh bạ ${uid} lỗi`, error));
  }
}
