import { createLogger, describeError } from "./logger.js";

const log = createLogger("process");
let installed = false;

/** Quá ngần này promise lẻ trong một phút → coi tiến trình đã hỏng âm thầm, thoát để Docker khởi động lại. */
const REJECTION_LIMIT_PER_MINUTE = 20;
let rejectionTimes: number[] = [];

/**
 * Lưới an toàn cuối cùng cho tiến trình giữ mọi phiên Zalo (gọi một lần, sớm, ở main + worker).
 * - unhandledRejection: log rồi chạy tiếp — một promise lẻ không đáng làm rớt mọi phiên; dồn dập quá
 *   REJECTION_LIMIT_PER_MINUTE lần / phút thì thoát mã 1 (vòng lỗi lặp = tiến trình sống mà hỏng).
 * - uncaughtException: log rồi thoát mã 1 — trạng thái sau ngoại lệ đồng bộ không còn đáng tin; Docker khởi động lại.
 * Lỗi cần xử lý đúng chỗ (.catch ở nơi gọi) — đây không thay thế việc đó.
 */
export function installProcessCrashGuards(): void {
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (reason) => {
    log.error(`promise bị từ chối mà không ai bắt: ${describeError(reason)}`);
    if (reason instanceof Error && reason.stack) console.error(reason.stack);
    const now = Date.now();
    rejectionTimes = [...rejectionTimes.filter((at) => now - at < 60_000), now];
    if (rejectionTimes.length >= REJECTION_LIMIT_PER_MINUTE) {
      log.error(`${rejectionTimes.length} promise lẻ trong một phút — tắt tiến trình để khởi động lại`);
      process.exit(1);
    }
  });
  process.on("uncaughtException", (error) => {
    log.error(`ngoại lệ không bắt, tắt tiến trình để khởi động lại: ${describeError(error)}`);
    if ((error as Error | null)?.stack) console.error((error as Error).stack);
    process.exit(1);
  });
}
