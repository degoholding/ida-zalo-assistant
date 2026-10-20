// Cổng đồng thời TOÀN CỤC cho lời gọi công cụ MCP (mọi khóa cộng lại). Pool MySQL chỉ 10 kết nối dùng chung với đồng bộ Zalo + web;
// một truy vấn nặng có thể quét vài giây, nên chỉ cho `max` lời gọi chạy cùng lúc, số còn lại xếp hàng tối đa `waitMs` rồi báo bận.

export type GateResult = { ok: true; release: () => void } | { ok: false };

interface Waiter {
  grant: () => void;
  timer: NodeJS.Timeout;
}

export class ConcurrencyGate {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(private readonly max: number, private readonly waitMs: number) {}

  /** Thời gian chờ chỗ tối đa (ms) — bộ chờ lời gọi phía client dùng để đặt hạn chờ lớn hơn nó. */
  get maxWaitMs(): number {
    return this.waitMs;
  }

  get inFlight(): number {
    return this.active;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /** Lấy một chỗ; hết chỗ thì chờ tối đa `waitMs`. Thành công thì NHỚ gọi `release()` (gọi lặp vô hại). */
  acquire(): Promise<GateResult> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve({ ok: true, release: this.makeRelease() });
    }
    return new Promise((resolve) => {
      const waiter: Waiter = {
        // Chỗ được chuyển thẳng cho người chờ (active giữ nguyên) nên không ai chen ngang
        grant: () => { clearTimeout(waiter.timer); resolve({ ok: true, release: this.makeRelease() }); },
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          resolve({ ok: false });
        }, this.waitMs),
      };
      this.queue.push(waiter);
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) next.grant();
      else this.active = Math.max(0, this.active - 1);
    };
  }
}
