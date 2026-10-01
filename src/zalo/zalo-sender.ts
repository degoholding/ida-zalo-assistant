// Hàng đợi gửi tin của MỘT tài khoản bot: gửi lần lượt, cách nhau tối thiểu intervalMs.
// Mọi tin bot gửi ra đều đi qua đây — một chỗ duy nhất kiểm tốc độ gửi.

export class ZaloSender {
  private chain: Promise<unknown> = Promise.resolve();
  private lastSentAt = 0;

  constructor(private readonly intervalMs: number) {}

  send<T>(task: () => Promise<T>): Promise<T> {
    const run = async () => {
      const wait = this.lastSentAt + this.intervalMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      try {
        return await task();
      } finally {
        this.lastSentAt = Date.now();
      }
    };
    const result = this.chain.then(run, run);
    // Lỗi của tin này không được chặn các tin sau
    this.chain = result.catch(() => undefined);
    return result;
  }
}
