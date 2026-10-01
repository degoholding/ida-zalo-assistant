import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { BotAccountStatus, SessionEvent } from "../constants.js";
import type { Db } from "../db/pool.js";

export interface BotAccountRow {
  id: number;
  label: string;
  zalo_uid: string | null;
  display_name: string;
  session_cipher: string | null;
  status: number;
  is_active: number;
}

export async function listActiveAccounts(db: Db): Promise<BotAccountRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM bot_account WHERE is_active = 1 AND session_cipher IS NOT NULL ORDER BY id",
  );
  return rows as BotAccountRow[];
}

/** Sau khi quét QR: có tài khoản theo nhãn thì cập nhật phiên, chưa có thì tạo. */
export async function saveLoggedInAccount(
  db: Db,
  label: string,
  zaloUid: string,
  displayName: string,
  sessionCipher: string,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO bot_account (label, zalo_uid, display_name, session_cipher, status)
     VALUES (?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), zalo_uid = VALUES(zalo_uid),
       display_name = VALUES(display_name), session_cipher = VALUES(session_cipher), status = 0`,
    [label, zaloUid, displayName.slice(0, 255), sessionCipher],
  );
  return result.insertId;
}

export async function setAccountStatus(db: Db, accountId: number, status: BotAccountStatus): Promise<void> {
  await db.query(
    `UPDATE bot_account SET status = ?,
       last_connected_at = IF(? = 1, CURRENT_TIMESTAMP(3), last_connected_at) WHERE id = ?`,
    [status, status, accountId],
  );
}

export async function touchHeartbeat(db: Db, accountId: number): Promise<void> {
  await db.query("UPDATE bot_account SET last_heartbeat_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [accountId]);
}

export async function recordSessionEvent(
  db: Db,
  accountId: number,
  event: SessionEvent,
  code: number | null = null,
  detail = "",
): Promise<void> {
  await db.query("INSERT INTO session_event (bot_account_id, event, code, detail) VALUES (?, ?, ?, ?)", [
    accountId,
    event,
    code,
    detail.slice(0, 500),
  ]);
}
