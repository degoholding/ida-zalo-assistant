import type { BriefPeriod, BriefScope } from "../briefs/brief-types.js";
import type { MessageStatsResult } from "./periodic-report-message-stats.js";

// Đệm số liệu TIN của báo cáo tuần / tháng theo phạm vi trong CÙNG một lượt chạy (giống `HighlightCache` của điểm tin
// AI) — nhiều người nhận «mọi nhóm» (hoặc chọn đúng cùng tập nhóm) dùng chung một lượt truy vấn nặng (quét cả
// tháng, nhiều bảng) thay vì lặp lại mỗi người nhận một lần (review phase 8, M11). CHỈ đệm theo `groupIds` +
// `includeUngrouped` + mốc kỳ — KHÔNG đọc `scope.uid` vì `collectMessageStats` không lọc theo người.

export class PeriodicStatsCache {
  private readonly entries = new Map<string, Promise<MessageStatsResult>>();

  get(scope: BriefScope, period: BriefPeriod, now: Date, compute: () => Promise<MessageStatsResult>): Promise<MessageStatsResult> {
    const key = [
      [...scope.groupIds].sort((a, b) => a - b).join(","),
      scope.includeUngrouped ? 1 : 0,
      period.from.getTime(), period.to.getTime(), now.getTime(),
    ].join("|");
    const cached = this.entries.get(key);
    if (cached) return cached;
    const promise = compute();
    this.entries.set(key, promise);
    return promise;
  }
}
