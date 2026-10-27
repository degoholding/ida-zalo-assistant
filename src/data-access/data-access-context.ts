import { McpCallSource } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { ContactActor } from "./actors/contact-actor.js";
import type { AlertRuntime } from "./alerts/alert-asker-facts.js";
import { can, canSeeConfidential, type Entity, type Principal } from "../auth/principal.js";

// Ngữ cảnh một lời gọi vào lõi truy cập dữ liệu: AI là AI NÀO của ai, được thấy gì. Mọi hàm của lõi nhận ngữ cảnh này —
// không hàm nào tự đọc `Principal` rời rạc, để phạm vi + Mật được quyết ở MỘT chỗ.

export interface DataAccessContext {
  db: Db;
  principal: Principal;
  /** Khóa MCP mức đọc+ghi (hoặc trợ lý trong app). Phase này chỉ có công cụ đọc nhưng `canUse` đã tính sẵn cho phase 8. */
  allowWrite: boolean;
  /** Được đưa nhóm Mật cho AI không — NƠI DUY NHẤT quyết định. Dựng bằng `buildDataAccessContext`, đừng gán tay. */
  includeConfidential: boolean;
  /** Bật «Che dữ liệu cá nhân trước khi gửi AI» (config.privacy.maskPersonalData). */
  maskPersonal: boolean;
  /**
   * Chỉ thấy cuộc nhắn RIÊNG của chính người hỏi (zalo_group.zalo_group_id = `ownDirectUid`), không thấy cuộc riêng của người khác.
   * Mặc định tắt = giữ luật web (người «mọi nhóm» thấy mọi cuộc riêng). Phase 6 (trợ lý) bật để câu trả lời trong cuộc riêng không
   * lọt sang người khác (H2 / L7 của review phase 2). `ownDirectUid` null = không có cuộc riêng nào thấy được.
   */
  ownDirectThreadsOnly?: boolean;
  ownDirectUid?: string | null;
  /** Hỏi trong nhóm (trợ lý): id nhóm — mọi thành viên đọc câu trả lời nên công cụ chỉ cho thực thể gắn nhóm (xem catalog/group-scope-guard.ts). */
  groupScopeId?: number;
  source: McpCallSource;
  /** Khóa MCP đang gọi (null = trợ lý trong app) — cổng ghi vào mcp_call_log. */
  keyId: number | null;
  /** Mốc «bây giờ» của lời gọi (kiểm khoảng ngày, tính hạn); tiêm được cho test. */
  now: Date;
  /** Đánh thức bộ chạy việc nền sau khi ghi (báo Zalo qua hàng đợi). Thiếu = bộ chạy tự quét theo chu kỳ. */
  wakeJobs?: () => void;
  /**
   * Người đang nhắn bot trên Zalo (có hoặc không tài khoản web) — chủ thể của các thao tác ghi theo QUAN HỆ (`WriteAction.permission =
   * "relationship"`). Chỉ trợ lý đặt (từ tin Zalo đã nhận); cổng HTTP không bao giờ có ⇒ công cụ quan hệ không lộ ra MCP ngoài.
   */
  contactActor?: ContactActor;
  /**
   * Đưa tệp đính kèm (id `attachment`) về hàng tải nền — móc của ứng dụng, chỉ ctx trợ lý có (HTTP không). Công cụ ghi do MÔ HÌNH khởi xướng
   * (`create_ticket`, `ticket_action note`, họ `files`) gọi sau khi ghi để ảnh vừa gửi được tải ngay như đường cũ; thiếu móc = bộ tải nhặt khi khởi động lại.
   */
  requestDownload?: (attachmentIds: number[]) => void;
  /** Lưu cài đặt áp nóng (dịch vụ cài đặt) — chỉ ctx trợ lý có, HTTP không. Trả danh sách khóa đã đổi. */
  saveSettings?: (patch: Record<string, unknown>, actor: string) => Promise<string[]>;
  /** Móc chạy của họ `alerts` (cài đặt đang hiệu lực + nạp lại người nhận / VIP) — chỉ ctx trợ lý của người dùng cảnh báo có; thiếu ⇒ công cụ họ `alerts` ẩn. */
  alertRuntime?: AlertRuntime;
  /** Đọc tệp gốc trong kho + ký link tải ngắn hạn — chỉ cổng HTTP có (27/10/2026, công cụ `get_file`); thiếu ⇒ `get_file` ẩn. */
  fileAccess?: FileAccess;
}

export interface FileAccess {
  /** Được trả TỆP GỐC (ảnh / pdf / link tải) — công tắc MCP_FILE_RAW, mặc định bật (ngoại lệ của che dữ liệu cá nhân, đại ca chốt 27/10). */
  rawAllowed: boolean;
  /** Đọc cả tệp (đã cất) vào bộ nhớ; quá `maxBytes` thì ném. */
  read(storageKey: string, maxBytes: number): Promise<Buffer>;
  /** Link tải ký sẵn hạn ngắn cho tệp `attachmentId`; null = máy chủ chưa khai gốc công khai (MCP_PUBLIC_URL). */
  signLink(attachmentId: number): string | null;
}

export interface DataAccessContextInput {
  db: Db;
  principal: Principal;
  allowWrite?: boolean;
  maskPersonal: boolean;
  ownDirectThreadsOnly?: boolean;
  ownDirectUid?: string | null;
  source: McpCallSource;
  keyId?: number | null;
  now?: Date;
  wakeJobs?: () => void;
  contactActor?: ContactActor;
  saveSettings?: DataAccessContext["saveSettings"];
  alertRuntime?: AlertRuntime;
  fileAccess?: FileAccess;
}

/**
 * Dựng ngữ cảnh. Mật = cờ của principal (`canViewConfidential`): với khóa MCP, `verifyMcpKey` đã nhân cờ người dùng với cờ
 * khóa; với trợ lý trong app chỉ cờ người dùng. Quản trị KHÔNG tự được Mật (quyết định 17/10/2026).
 */
export function buildDataAccessContext(input: DataAccessContextInput): DataAccessContext {
  return {
    db: input.db, principal: input.principal, allowWrite: input.allowWrite === true,
    includeConfidential: canSeeConfidential(input.principal), maskPersonal: input.maskPersonal,
    ownDirectThreadsOnly: input.ownDirectThreadsOnly === true, ownDirectUid: input.ownDirectUid ?? null,
    source: input.source, keyId: input.keyId ?? null, now: input.now ?? new Date(),
    wakeJobs: input.wakeJobs, contactActor: input.contactActor, saveSettings: input.saveSettings, alertRuntime: input.alertRuntime,
    fileAccess: input.fileAccess,
  };
}

/** Được dùng thực thể `entity` cho thao tác `action` không: quyền vai trò, và ghi còn cần khóa mức đọc+ghi. */
export function canUse(ctx: DataAccessContext, entity: Entity, action: "read" | "write"): boolean {
  return can(ctx.principal, entity, action) && (action === "read" || ctx.allowWrite);
}
