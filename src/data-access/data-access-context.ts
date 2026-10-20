import { McpCallSource } from "../constants.js";
import type { Db } from "../db/pool.js";
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
    wakeJobs: input.wakeJobs,
  };
}

/** Được dùng thực thể `entity` cho thao tác `action` không: quyền vai trò, và ghi còn cần khóa mức đọc+ghi. */
export function canUse(ctx: DataAccessContext, entity: Entity, action: "read" | "write"): boolean {
  return can(ctx.principal, entity, action) && (action === "read" || ctx.allowWrite);
}
