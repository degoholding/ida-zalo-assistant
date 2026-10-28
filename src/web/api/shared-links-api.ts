import type { RowDataPacket } from "mysql2";
import { SYSTEM_PRINCIPAL, type Principal } from "../../auth/principal.js";
import { ConversationType } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { contactAvatarUrl } from "./contacts-api.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";
import { scopedWhere } from "./scope.js";

// API Link chia sẻ (phase 13.2): link bóc từ tin (bảng shared_link) — tab «Link chia sẻ» của màn Tệp. Cùng quyền + phạm vi nhóm với
// danh sách tệp (GET /api/files* = quyền xem tệp, route-permissions.ts); tin đã thu hồi không hiện.

export const SHARED_LINK_LIST_SPEC: ListSpec = {
  fields: {
    group_id: { sql: "l.group_id", type: "number" },
    thread_type: { sql: "g.thread_type", type: "number" },
    kind: { sql: "l.kind", type: "number" },
    host: { sql: "l.host", type: "text" },
    url: { sql: "l.url", type: "text" },
    title: { sql: "l.title", type: "text" },
    sender_uid: { sql: "l.sender_uid", type: "text" },
    sender_name: { sql: "l.sender_name", type: "text" },
    sent_at: { sql: "l.sent_at", type: "date" },
  },
  sorts: { sent_at: "l.sent_at", host: "l.host", kind: "l.kind" },
  defaultSort: { by: "sent_at", dir: "desc" },
  tieBreaker: "l.id",
  search: { param: "q", columns: ["l.url", "l.title", "l.sender_name"] },
};

const SHARED_LINK_FROM = `FROM shared_link l JOIN message m ON m.id = l.message_id JOIN zalo_group g ON g.id = l.group_id
  LEFT JOIN contact sc ON sc.zalo_uid = l.sender_uid`;
const SHARED_LINK_COLUMNS = `
  l.id, l.url, l.host, l.kind, l.google_file_id, l.title, l.message_id, l.sender_uid, l.sender_name, l.sent_at,
  sc.avatar_key AS sender_avatar_key, sc.id AS sender_contact_id, g.id AS thread_id, g.thread_type,
  IF(g.thread_type = ${ConversationType.Direct}, CONCAT('Nhắn riêng · ', g.name), COALESCE(NULLIF(g.label, ''), g.name)) AS thread_name`;

function decorateSharedLink(row: RowDataPacket): Record<string, unknown> {
  const { sender_avatar_key: avatarKey, ...rest } = row;
  return { ...rest, sender_avatar_url: contactAvatarUrl(row.sender_uid, avatarKey) };
}

export function listSharedLinks(db: Db, params: URLSearchParams, principal: Principal = SYSTEM_PRINCIPAL) {
  const base = scopedWhere(principal, { sql: "m.recalled_at IS NULL", params: [] }, "l.group_id");
  return runList(db, params, SHARED_LINK_LIST_SPEC, {
    select: SHARED_LINK_COLUMNS, from: SHARED_LINK_FROM, baseWhere: base, decorate: (rows) => rows.map(decorateSharedLink),
  });
}

export const sharedLinkRoutes: ApiRoute[] = [
  ["GET", /^\/api\/files\/links$/, async ({ response, url, service, principal }) => sendOk(response, await listSharedLinks(service.db, url.searchParams, principal))],
];
