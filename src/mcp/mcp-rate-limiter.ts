// Giới hạn nhịp của cổng MCP, trong bộ nhớ (một tiến trình app): thùng token + đếm đồng thời theo khóa, và cửa sổ đếm lần sai khóa theo IP.
// Map có dọn định kỳ để không phình bộ nhớ khi có nhiều khóa / IP lạ.

export interface RateLimitConfig {
  perMinute: number;
  maxConcurrent: number;
}

export type TakeResult = { ok: true; release: () => void } | { ok: false; reason: "rate" | "concurrent"; retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  updatedAt: number;
  inFlight: number;
}

const SWEEP_EVERY_MS = 60_000;

export class McpRateLimiter {
  private readonly buckets = new Map<number, Bucket>();
  private lastSweep = 0;

  constructor(private readonly config: RateLimitConfig, private readonly clock: () => number = Date.now) {}

  /** Lấy một lượt cho khóa; thành công thì NHỚ gọi `release()` khi lời gọi xong (đếm đồng thời). */
  take(keyId: number): TakeResult {
    const now = this.clock();
    this.sweep(now);
    const bucket = this.buckets.get(keyId) ?? { tokens: this.config.perMinute, updatedAt: now, inFlight: 0 };
    const refillPerMs = this.config.perMinute / 60_000;
    bucket.tokens = Math.min(this.config.perMinute, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;
    this.buckets.set(keyId, bucket);
    if (bucket.inFlight >= this.config.maxConcurrent) return { ok: false, reason: "concurrent", retryAfterSeconds: 1 };
    if (bucket.tokens < 1) return { ok: false, reason: "rate", retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)) };
    bucket.tokens -= 1;
    bucket.inFlight += 1;
    let released = false;
    return { ok: true, release: () => { if (!released) { released = true; bucket.inFlight = Math.max(0, bucket.inFlight - 1); } } };
  }

  // Bỏ thùng đã đầy lại + không còn lời gọi đang chạy (tương đương chưa từng tồn tại)
  private sweep(now: number): void {
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    for (const [keyId, bucket] of this.buckets) {
      if (bucket.inFlight === 0 && now - bucket.updatedAt >= 60_000) this.buckets.delete(keyId);
    }
  }
}

/** Đếm lần sai khóa theo IP trong cửa sổ 60 giây; quá `limit` thì `isBlocked` = true tới hết cửa sổ. */
export class FailureWindow {
  private readonly windows = new Map<string, { count: number; startedAt: number }>();
  private lastSweep = 0;

  constructor(private readonly limit: number, private readonly clock: () => number = Date.now) {}

  isBlocked(ip: string): boolean {
    const now = this.clock();
    this.sweep(now);
    const entry = this.windows.get(ip);
    return !!entry && now - entry.startedAt < 60_000 && entry.count >= this.limit;
  }

  recordFailure(ip: string): void {
    const now = this.clock();
    const entry = this.windows.get(ip);
    if (!entry || now - entry.startedAt >= 60_000) this.windows.set(ip, { count: 1, startedAt: now });
    else entry.count += 1;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    for (const [ip, entry] of this.windows) {
      if (now - entry.startedAt >= 60_000) this.windows.delete(ip);
    }
  }
}
