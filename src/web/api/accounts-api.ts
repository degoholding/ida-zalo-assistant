import type { RowDataPacket } from "mysql2";
import { BotAccountKind, BotAccountStatus, ConversationType } from "../../constants.js";
import type { SyncService } from "../../sync-service.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";
import { planTestAccountPurge, purgeTestAccount, PurgeRefusedError, type PurgePlan } from "../../sync/test-account-purge.js";
import { contactAvatarUrl } from "./contacts-api.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";

// API Tài khoản bot: danh sách (kèm cờ đang chạy), chi tiết, bật / tắt, đăng nhập QR.

const ACCOUNT_KIND_LABEL: Record<number, string> = { [BotAccountKind.Assistant]: "Trợ lý", [BotAccountKind.Normal]: "Chỉ thu thập dữ liệu" };
const LABEL_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export const ACCOUNT_LIST_SPEC: ListSpec = {
  fields: {
    label: { sql: "b.label", type: "text" },
    display_name: { sql: "b.display_name", type: "text" },
    status: { sql: "b.status", type: "number" },
    is_active: { sql: "b.is_active", type: "boolean" },
    kind: { sql: "b.kind", type: "number" },
    last_heartbeat_at: { sql: "b.last_heartbeat_at", type: "date" },
  },
  sorts: { label: "b.label", last_heartbeat_at: "b.last_heartbeat_at", created_at: "b.created_at", group_count: "group_count" },
  defaultSort: { by: "label", dir: "asc" },
  tieBreaker: "b.id",
  search: { param: "q", columns: ["b.label", "b.display_name", "b.zalo_uid"] },
};

const ACCOUNT_FROM = "FROM bot_account b LEFT JOIN contact c ON c.zalo_uid = b.zalo_uid";
const ACCOUNT_COLUMNS = `
  b.id, b.label, b.zalo_uid, b.display_name, b.status, b.is_active, b.kind, b.is_test, b.last_connected_at, b.last_heartbeat_at, b.created_at,
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
      ...rest, running, state: state.code, state_label: state.label, is_active: Boolean(row.is_active), is_test: Boolean(row.is_test),
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

/** Cờ bật / tắt nhận đúng true / false, 0 / 1, "0" / "1", "true" / "false"; còn lại 422 (không đoán). */
function parseStrictFlag(raw: unknown, label: string): boolean {
  if (raw === true || raw === 1 || raw === "1" || raw === "true") return true;
  if (raw === false || raw === 0 || raw === "0" || raw === "false") return false;
  throw new ApiError(422, "validation_error", `${label} chỉ nhận bật / tắt`);
}

function serializePlan(plan: PurgePlan): Record<string, unknown> {
  return {
    account_id: plan.accountId, label: plan.label, direct_count: plan.directCount, solo_group_count: plan.soloGroupCount,
    shared_group_count: plan.sharedGroupCount, message_count: plan.messageCount, attachment_count: plan.attachmentCount,
    stored_file_count: plan.storedFileCount, stored_bytes: plan.storedBytes,
  };
}

const refuse = (error: unknown): never => {
  if (error instanceof PurgeRefusedError) throw new ApiError(409, "conflict", error.message);
  throw error;
};

/**
 * Xóa tài khoản thử kèm dữ liệu (27/10/2026). Điều kiện: is_test = 1, gõ lại ĐÚNG nhãn, xác nhận đã sao lưu. Thứ tự: tắt +
 * dừng phiên Zalo → xóa trong một giao dịch → xóa tệp trong kho (hỏng thì ghi storage_cleanup) → nhật ký thao tác.
 */
export async function purgeAccount(service: Pick<SyncService, "db" | "storage" | "stopAccount">, id: number, body: Record<string, unknown>) {
  const plan = await planTestAccountPurge(service.db, id).catch(refuse);
  if (String(body.confirm_label ?? "") !== plan.label) {
    throw new ApiError(422, "validation_error", "Gõ lại đúng nhãn tài khoản để xác nhận xóa");
  }
  if (body.backup_confirmed !== true) throw new ApiError(422, "validation_error", "Chưa xác nhận đã sao lưu dữ liệu");
  await service.db.query("UPDATE bot_account SET is_active = 0 WHERE id = ?", [id]);
  await service.stopAccount(id);
  const result = await purgeTestAccount(service.db, service.storage, id).catch(refuse);
  const summary = `Xóa tài khoản thử "${result.label}": ${result.directCount} cuộc riêng, ${result.soloGroupCount} nhóm chỉ có nó, `
    + `${result.messageCount} tin, ${result.attachmentCount} tệp (${result.storageDeleted} đã xóa khỏi kho`
    + `${result.storageFailed ? `, ${result.storageFailed} lỗi chờ dọn lại` : ""}); giữ ${result.sharedGroupCount} nhóm có tài khoản khác`;
  await recordAudit(service.db, { entity: "bot_account", entityId: id, action: "purge", message: summary });
  return { ...serializePlan(result), storage_deleted: result.storageDeleted, storage_failed: result.storageFailed, message: summary };
}

export const accountRoutes: ApiRoute[] = [
  // Xem trước khi xóa tài khoản thử: số cuộc riêng / nhóm / tin / tệp / dung lượng sẽ xóa
  ["GET", /^\/api\/accounts\/(\d+)\/purge-preview$/, async ({ response, match, service }) =>
    sendOk(response, serializePlan(await planTestAccountPurge(service.db, parseId(match[1])).catch(refuse)))],
  ["POST", /^\/api\/accounts\/(\d+)\/purge$/, async ({ request, response, match, service }) => {
    const result = await purgeAccount(service, parseId(match[1]), await readJson(request));
    sendOk(response, result, "Đã xóa tài khoản thử kèm dữ liệu");
  }],
  ["GET", /^\/api\/accounts$/, async ({ response, url, service }) =>
    sendOk(response, await runList(service.db, url.searchParams, ACCOUNT_LIST_SPEC, {
      select: ACCOUNT_COLUMNS, from: ACCOUNT_FROM, decorate: (rows) => decorate(service, rows),
    }))],
  ["GET", /^\/api\/accounts\/(\d+)$/, async ({ response, match, service }) => sendOk(response, await getAccountDetail(service, parseId(match[1])))],
  ["PATCH", /^\/api\/accounts\/(\d+)$/, async ({ request, response, match, service }) => {
    const id = parseId(match[1]);
    const before = await loadAccount(service, id);
    const body = await readJson(request);
    if (body.is_active === undefined && body.kind === undefined && body.is_test === undefined) {
      throw new ApiError(422, "validation_error", "Chỉ sửa được ô Đang dùng, Loại và Tài khoản thử của tài khoản bot");
    }
    // Kiểm hết đầu vào TRƯỚC khi ghi gì (loại chỉ nhận đúng 0 / 1 hoặc "0" / "1"; chuỗi rỗng, true, 1.5… đều 422)
    let nextKind: BotAccountKind | null = null;
    if (body.kind !== undefined) {
      const raw = body.kind;
      const kind = raw === 0 || raw === 1 || raw === "0" || raw === "1" ? Number(raw) : NaN;
      if (kind !== BotAccountKind.Assistant && kind !== BotAccountKind.Normal) {
        throw new ApiError(422, "validation_error", "Loại tài khoản không hợp lệ (0 = Trợ lý, 1 = Chỉ thu thập dữ liệu)");
      }
      nextKind = kind;
    }
    const nextTest = body.is_test === undefined ? null : parseStrictFlag(body.is_test, "Tài khoản thử");
    const nextActive = body.is_active === undefined
      ? null
      : body.is_active === true || body.is_active === 1 || body.is_active === "1" || body.is_active === "true";
    const kindChanged = nextKind !== null && nextKind !== Number(before.kind);
    const activeChanged = nextActive !== null && nextActive !== Boolean(before.is_active);
    const testChanged = nextTest !== null && nextTest !== Boolean(before.is_test);

    // Loại tài khoản: đổi có hiệu lực NGAY (runner đang chạy áp dụng liền, không khởi động lại)
    if (kindChanged && nextKind !== null) {
      await service.db.query("UPDATE bot_account SET kind = ? WHERE id = ?", [nextKind, id]);
      service.setAccountKind(id, nextKind);
      await recordAudit(service.db, {
        entity: "bot_account", entityId: id, action: "update", changedFields: ["kind"],
        message: `Đổi loại tài khoản: ${ACCOUNT_KIND_LABEL[Number(before.kind)] ?? before.kind} → ${ACCOUNT_KIND_LABEL[nextKind]}`,
      });
    }
    // Tài khoản thử (27/10/2026): chỉ đổi cờ, không đụng phiên; bật cờ mới hiện nút "Xóa kèm dữ liệu"
    if (testChanged && nextTest !== null) {
      await service.db.query("UPDATE bot_account SET is_test = ? WHERE id = ?", [nextTest ? 1 : 0, id]);
      await recordAudit(service.db, {
        entity: "bot_account", entityId: id, action: "update", changedFields: ["is_test"],
        message: nextTest ? "Đánh dấu Tài khoản thử" : "Bỏ đánh dấu Tài khoản thử",
      });
    }
    // Chỉ dừng / chạy lại tài khoản khi Đang dùng THỰC SỰ đổi — lưu lại cùng giá trị không làm rớt phiên Zalo
    if (activeChanged && nextActive !== null) {
      await service.db.query("UPDATE bot_account SET is_active = ? WHERE id = ?", [nextActive ? 1 : 0, id]);
      if (nextActive) await service.restartAccount(id);
      else await service.stopAccount(id);
      await recordAudit(service.db, { entity: "bot_account", entityId: id, action: nextActive ? "activate" : "deactivate" });
    }
    const message = activeChanged
      ? (nextActive ? "Đã bật tài khoản bot" : "Đã tắt tài khoản bot") + (kindChanged ? " và đổi loại tài khoản" : "")
      : kindChanged ? "Đã lưu loại tài khoản" + (testChanged ? " và cờ Tài khoản thử" : "")
        : testChanged ? "Đã lưu cờ Tài khoản thử" : "Không có thay đổi";
    sendOk(response, await getAccountDetail(service, id), message);
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
