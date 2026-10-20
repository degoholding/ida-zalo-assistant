import { ASSISTANT_FAMILIES, type AssistantFamily } from "../../data-access/tool-definition.js";
import { createLogger } from "../../logger.js";

// Công tắc chuỗi `assistant_mcp_families` (T2): «core,reads,…» hoặc «all»; rỗng = tắt hết (đường cũ). Họ lạ bị bỏ qua + log.

const log = createLogger("assistant");

export function parseMcpFamilies(raw: string | null | undefined): ReadonlySet<AssistantFamily> {
  const tokens = (raw ?? "").split(",").map((token) => token.trim().toLowerCase()).filter(Boolean);
  if (tokens.includes("all")) return new Set(ASSISTANT_FAMILIES);
  const known = new Set<string>(ASSISTANT_FAMILIES);
  const picked = new Set<AssistantFamily>();
  for (const token of tokens) {
    if (known.has(token)) picked.add(token as AssistantFamily);
    else log.warn(`assistant_mcp_families: bỏ qua họ lạ «${token}»`);
  }
  return picked;
}
