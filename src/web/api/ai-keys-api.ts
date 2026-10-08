import { AiKeyCheckError } from "../../assistant/ai-key-providers.js";
import { parseAiKeyInput, parseAiKeyPatch, type AiKeyStore, type AiKeyView } from "../../assistant/ai-key-store.js";
import type { SyncService } from "../../sync-service.js";
import { ApiError, readJson, sendOk } from "./api-http.js";
import { ADMIN_USER, type ApiRoute } from "./api-route.js";
import { diffFields, recordAudit } from "./audit-log.js";

// API màn «Khóa AI» (tab đầu của Cài đặt, 07/10/2026): danh sách khóa có thứ tự, thêm (gọi thử hãng rồi mới lưu), sửa mô
// hình / trần lượt, đưa lên, gỡ. Khóa chỉ đi VÀO (thân POST) — mọi phản hồi chỉ có đuôi «…ab12». KHÔNG log thân POST.
// Nhật ký ghi vào «Lịch sử thay đổi» của màn Cài đặt (entity setting #1), không bao giờ ghi khóa.

/** Trùng với `SETTINGS_ENTITY_ID` của settings-api — mục «Lịch sử thay đổi» của màn Cài đặt. */
const SETTINGS_ENTITY_ID = 1;
const PATCH_LABELS = { model: "Mô hình", model_heavy: "Mô hình việc nặng", daily_cap: "Trần lượt / ngày" };

function describeKey(view: AiKeyView): string {
  return `${view.provider_label} ${view.key_tail}`;
}

function requireStore(service: SyncService): AiKeyStore {
  if (!service.aiKeys) throw new ApiError(503, "unavailable", "Kho Khóa AI chưa sẵn sàng");
  return service.aiKeys;
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(404, "not_found", "Không có khóa này");
  return id;
}

async function audit(service: SyncService, action: string, message: string, changedFields?: string[]): Promise<void> {
  await recordAudit(service.db, { entity: "setting", entityId: SETTINGS_ENTITY_ID, action, message, changedFields });
}

/** Gắn cờ «hãng được phép» (cài đặt «Hãng AI được phép dùng») — màn Khóa AI hiện khóa bị bỏ qua. */
function withAllowed(service: SyncService, views: AiKeyView[]): (AiKeyView & { allowed: boolean })[] {
  // Chưa có cấu hình (dịch vụ dựng tối giản, vd bài kiểm) = mọi hãng được phép, như mặc định của cài đặt
  const allowed = service.config?.privacy?.allowedAiProviders;
  return views.map((view) => ({ ...view, allowed: !allowed || allowed.includes(String(view.provider)) }));
}

export const aiKeyRoutes: ApiRoute[] = [
  ["GET", /^\/api\/ai-keys$/, async ({ response, service }) => {
    sendOk(response, withAllowed(service, service.aiKeys?.list() ?? []));
  }],

  ["POST", /^\/api\/ai-keys$/, async ({ request, response, service }) => {
    const store = requireStore(service);
    const input = parseAiKeyInput(await readJson(request));
    let added: Awaited<ReturnType<AiKeyStore["add"]>>;
    try {
      added = await store.add(input, ADMIN_USER.full_name);
    } catch (error) {
      if (error instanceof AiKeyCheckError) throw new ApiError(422, "ai_key_check_failed", error.message);
      throw error;
    }
    service.applyAiKeys();
    await audit(service, "create", `Khóa AI: thêm số ${added.view.position} — ${describeKey(added.view)}`);
    sendOk(response, withAllowed(service, store.list()), [`Đã kiểm và lưu khóa ${describeKey(added.view)} (số ${added.view.position})`, added.note].filter(Boolean).join(". "), 201);
  }],

  ["PATCH", /^\/api\/ai-keys\/(\d+)$/, async ({ request, response, service, match }) => {
    const store = requireStore(service);
    const patch = parseAiKeyPatch(await readJson(request));
    const result = await store.update(parseId(match[1]), patch, ADMIN_USER.full_name);
    if (!result) throw new ApiError(404, "not_found", "Không có khóa này");
    const changed = diffFields(result.before as unknown as Record<string, unknown>, result.after as unknown as Record<string, unknown>, PATCH_LABELS);
    if (changed.length) {
      service.applyAiKeys();
      await audit(service, "update", `Khóa AI số ${result.after.position} — ${describeKey(result.after)}: đổi ${changed.join(", ")}`, changed);
    }
    sendOk(response, withAllowed(service, store.list()), changed.length ? "Đã lưu khóa" : "Không có gì thay đổi");
  }],

  ["POST", /^\/api\/ai-keys\/(\d+)\/move-up$/, async ({ response, service, match }) => {
    const store = requireStore(service);
    const id = parseId(match[1]);
    const view = store.find(id);
    if (!view) throw new ApiError(404, "not_found", "Không có khóa này");
    const position = await store.moveUp(id, ADMIN_USER.full_name);
    if (position) {
      service.applyAiKeys();
      await audit(service, "reorder", `Khóa AI: đưa ${describeKey(view)} từ số ${view.position} lên số ${position}`);
    }
    sendOk(response, withAllowed(service, store.list()), position ? `Đã đưa khóa lên số ${position}` : "Khóa đã đứng đầu");
  }],

  ["DELETE", /^\/api\/ai-keys\/(\d+)$/, async ({ response, service, match }) => {
    const store = requireStore(service);
    const removed = await store.remove(parseId(match[1]), ADMIN_USER.full_name);
    if (!removed) throw new ApiError(404, "not_found", "Không có khóa này");
    service.applyAiKeys();
    await audit(service, "delete", `Khóa AI: gỡ số ${removed.position} — ${describeKey(removed)}`);
    sendOk(response, withAllowed(service, store.list()), `Đã gỡ khóa ${describeKey(removed)}`);
  }],
];
