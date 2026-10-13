import type { Action, Entity } from "../../auth/principal.js";

// Đường API nào cần quyền gì (phase 4). Khai một chỗ thay vì rải trong từng tệp *-api.ts; đường không khớp dòng nào ở
// đây thì CHẶN (chỉ quản trị) — thêm API mới mà quên khai cũng không lộ cho người không phải quản trị.
// Phạm vi nhóm (thấy nhóm nào) kiểm riêng trong từng API — ở đây chỉ là «được gọi đường này không».

type Rule = [method: "GET" | "WRITE", pattern: RegExp, entity: Entity, action: Action];

const RULES: Rule[] = [
  ["GET", /^\/api\/(groups|lookups\/groups)(\/|$)/, "group", "read"],
  ["WRITE", /^\/api\/groups\/\d+$/, "group", "write"],
  ["GET", /^\/api\/(conversations|lookups\/threads|events)(\/|$)/, "conversation", "read"],
  // Tìm tin (phase 6): cùng quyền xem hội thoại; phạm vi nhóm áp trong API
  ["GET", /^\/api\/messages\/search$/, "conversation", "read"],
  ["WRITE", /^\/api\/conversations\/\d+\/(messages|attachments)$/, "conversation", "write"],
  ["GET", /^\/api\/(contacts|contact-cards|lookups\/contact-tags)(\/|$)/, "contact", "read"],
  ["WRITE", /^\/api\/contacts\/\d+$/, "contact", "write"],
  ["GET", /^\/api\/files(\/|$)/, "file", "read"],
  ["WRITE", /^\/api\/files\/\d+(\/(retry|extract))?$/, "file", "write"],
  ["GET", /^\/api\/(companies|lookups\/companies)(\/|$)/, "company", "read"],
  ["WRITE", /^\/api\/companies(\/\d+)?$/, "company", "write"],
  ["GET", /^\/api\/audit-logs$/, "audit", "read"],
  ["GET", /^\/api\/users(\/|$)/, "user", "read"],
  ["WRITE", /^\/api\/users(\/\d+)?$/, "user", "write"],
  ["GET", /^\/api\/recipients(\/|$)/, "recipient", "read"],
  ["WRITE", /^\/api\/recipients(\/\d+(\/test|\/brief-test)?)?$/, "recipient", "write"],
  ["GET", /^\/api\/accounts(\/|$)/, "bot_account", "read"],
  // Ticket (08/10/2026): xem + thao tác theo quyền «ticket»; sửa danh sách người xử lý KHÔNG khai → chỉ quản trị
  ["GET", /^\/api\/(tickets|ticket-handlers)(\/|$)/, "ticket", "read"],
  ["WRITE", /^\/api\/tickets\/\d+\/actions$/, "ticket", "write"],
  // Việc (phase 7): xem = mọi vai trò trong phạm vi nhóm; tạo / thao tác = quản trị + quản lý (quyền «task»)
  ["GET", /^\/api\/tasks(\/|$)/, "task", "read"],
  ["WRITE", /^\/api\/tasks$/, "task", "write"],
  ["WRITE", /^\/api\/tasks\/\d+\/actions$/, "task", "write"],
  // Bản tin (phase 8, màn web phase 5): chỉ đọc — phạm vi dòng (quản trị thấy hết, người khác chỉ thấy bản của mình) kiểm trong API
  ["GET", /^\/api\/briefs(\/|$)/, "brief", "read"],
  // Gửi tin (phase 9, màn web phase 5): phạm vi dòng + «gửi lại nơi lỗi chỉ quản trị» kiểm trong API. Tắt / Bật bot (POST
  // /api/bot-halt) KHÔNG khai → chỉ quản trị; đọc tình trạng cho mọi người xem được hội thoại (dải đỏ trên mọi trang)
  ["GET", /^\/api\/send-commands(\/|$)/, "send_command", "read"],
  ["WRITE", /^\/api\/send-commands\/\d+\/actions$/, "send_command", "write"],
  ["GET", /^\/api\/bot-halt$/, "conversation", "read"],
  // Mẫu tin trả lời (phase 10): soạn / sửa / gửi duyệt = quyền write; duyệt / trả lại kiểm thêm can(…, "approve") trong API.
  ["GET", /^\/api\/reply-templates(\/|$)/, "reply_template", "read"],
  ["WRITE", /^\/api\/reply-templates(\/\d+(\/actions)?)?$/, "reply_template", "write"],
  // Số liệu + danh mục (phase 10): chỉ đọc cho Quản lý. `/api/metric-sources*` và ghi `/api/catalog*` KHÔNG khai → chỉ quản trị
  ["GET", /^\/api\/metrics(\/|$)/, "metric", "read"],
  ["GET", /^\/api\/catalog(\/|$)/, "catalog", "read"],
  ["WRITE", /^\/api\/accounts(\/|$)/, "bot_account", "write"],
];

/** Quyền cần cho một lời gọi API. Không khai = cần quyền sửa cài đặt (chỉ quản trị). */
export function requiredPermission(method: string, path: string): { entity: Entity; action: Action } {
  const kind = method === "GET" ? "GET" : "WRITE";
  const rule = RULES.find(([ruleMethod, pattern]) => ruleMethod === kind && pattern.test(path));
  return rule ? { entity: rule[2], action: rule[3] } : { entity: "setting", action: "write" };
}
