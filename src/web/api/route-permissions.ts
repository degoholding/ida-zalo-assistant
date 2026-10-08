import type { Action, Entity } from "../../auth/principal.js";

// Đường API nào cần quyền gì (phase 4). Khai một chỗ thay vì rải trong từng tệp *-api.ts; đường không khớp dòng nào ở
// đây thì CHẶN (chỉ quản trị) — thêm API mới mà quên khai cũng không lộ cho người không phải quản trị.
// Phạm vi nhóm (thấy nhóm nào) kiểm riêng trong từng API — ở đây chỉ là «được gọi đường này không».

type Rule = [method: "GET" | "WRITE", pattern: RegExp, entity: Entity, action: Action];

const RULES: Rule[] = [
  ["GET", /^\/api\/(groups|lookups\/groups)(\/|$)/, "group", "read"],
  ["WRITE", /^\/api\/groups\/\d+$/, "group", "write"],
  ["GET", /^\/api\/(conversations|lookups\/threads|events)(\/|$)/, "conversation", "read"],
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
  ["WRITE", /^\/api\/recipients(\/\d+(\/test)?)?$/, "recipient", "write"],
  ["GET", /^\/api\/accounts(\/|$)/, "bot_account", "read"],
  ["WRITE", /^\/api\/accounts(\/|$)/, "bot_account", "write"],
];

/** Quyền cần cho một lời gọi API. Không khai = cần quyền sửa cài đặt (chỉ quản trị). */
export function requiredPermission(method: string, path: string): { entity: Entity; action: Action } {
  const kind = method === "GET" ? "GET" : "WRITE";
  const rule = RULES.find(([ruleMethod, pattern]) => ruleMethod === kind && pattern.test(path));
  return rule ? { entity: rule[2], action: rule[3] } : { entity: "setting", action: "write" };
}
