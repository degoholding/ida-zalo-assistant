import type { Db } from "../db/pool.js";
import { recordAudit } from "../web/api/audit-log.js";
import { runCatalogMatching } from "./catalog-match-actions.js";
import { formatRowError, parseCatalogWorkbook } from "./catalog-import-parser.js";
import { resolveCatalogOwners, upsertCatalogEntries } from "./catalog-repository.js";
import type { CatalogImportSummary } from "./catalog-types.js";

/** Nạp tệp Excel: đọc → thêm / cập nhật → giải người phụ trách → khớp Danh bạ → nhật ký. Lỗi cả tệp ném ApiError 422. Không lưu tệp. */
export async function importCatalog(db: Db, buffer: Buffer): Promise<CatalogImportSummary> {
  const parsed = parseCatalogWorkbook(buffer);
  const { created, updated } = await upsertCatalogEntries(db, parsed.entries);
  await resolveCatalogOwners(db);
  const tally = await runCatalogMatching(db);
  const summary: CatalogImportSummary = { created, updated, ...tally, errors: parsed.errors.map(formatRowError) };
  await recordAudit(db, {
    entity: "catalog", entityId: 0, action: "import",
    message: `Nạp danh mục: ${created} mới, ${updated} cập nhật, ${tally.matched} khớp, ${tally.suggested} gợi ý, ${summary.errors.length} lỗi dòng`,
  });
  return summary;
}
