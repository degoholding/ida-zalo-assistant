import type { AnyToolDefinition } from "../tool-definition.js";
import type { AnyWriteAction } from "../write/write-action.js";
import { alertsFamilyCatalog } from "./alerts-family-tools.js";
import { coreFamilyCatalog } from "./core-family-tools.js";
import { draftsFamilyCatalog } from "./drafts-family-tools.js";
import { filesFamilyCatalog } from "./files-family-tools.js";
import type { FamilyCatalog } from "./family-catalog.js";
import { metricsFamilyCatalog } from "./metrics-family-tools.js";
import { readsFamilyCatalog } from "./reads-family-tools.js";
import { sendFamilyCatalog } from "./send-family-tools.js";
import { tasksFamilyCatalog } from "./tasks-family-tools.js";
import { ticketsFamilyCatalog } from "./tickets-family-tools.js";

// Gộp danh mục của mọi họ. `read-tool-catalog` lấy công cụ, `write-tool-catalog` lấy thao tác ghi (cho confirm).

export const FAMILY_CATALOGS: readonly FamilyCatalog[] = [
  coreFamilyCatalog, draftsFamilyCatalog, readsFamilyCatalog, filesFamilyCatalog, ticketsFamilyCatalog,
  tasksFamilyCatalog, alertsFamilyCatalog, metricsFamilyCatalog, sendFamilyCatalog,
];

export const FAMILY_TOOLS: readonly AnyToolDefinition[] = FAMILY_CATALOGS.flatMap((catalog) => catalog.tools);
export const FAMILY_ACTIONS: readonly AnyWriteAction[] = FAMILY_CATALOGS.flatMap((catalog) => catalog.actions);
