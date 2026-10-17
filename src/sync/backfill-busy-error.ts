// Trần việc «Lấy tin cũ» chạy cùng lúc trên một tài khoản bot (kéo lịch sử nhiều nhóm một lúc dễ chạm giới hạn của Zalo).

/** Số nhóm tối đa được «Lấy tin cũ» cùng lúc trên một tài khoản bot. */
export const MAX_CONCURRENT_BACKFILLS_PER_ACCOUNT = 2;

/** Tài khoản bot đang kéo tin cũ cho đủ số nhóm tối đa — giao diện trả 429. */
export class BackfillBusyError extends Error {
  constructor(readonly running: number) {
    super(`Đang lấy tin cũ cho ${running} nhóm, thử lại sau`);
    this.name = "BackfillBusyError";
  }
}
