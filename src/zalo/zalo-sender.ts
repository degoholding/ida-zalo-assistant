// Hàng đợi gửi tin của MỘT tài khoản bot: gửi lần lượt, cách nhau tối thiểu intervalMs.
// Mọi tin bot gửi ra đều đi qua đây — một chỗ duy nhất kiểm tốc độ gửi.
//
// Hai mức ưu tiên (09/10/2026): tin THƯỜNG (câu trả lời, báo, tệp…) luôn đi trước tin PHỤ («em nhận được rồi, chờ em
// xíu»). Giả lập 100 nhóm cùng gọi bot: nút thắt là chính hàng gửi này (1 tin / 1,5 giây để Zalo không khóa vì spam), không
// phải AI — 100 tin «chờ em xíu» chen trước làm nhóm cuối phải chờ ~5 phút mới có câu trả lời, mà tin «chờ» tới cũng muộn
// nên vô ích. Tin phụ gửi bằng sendIfQuiet: hàng đang đông thì bỏ hẳn, nhường chỗ cho câu trả lời thật.

import { BotHaltedError } from "../messaging/bot-halted-error.js";
import { CollectOnlyAccountError } from "./collect-only-account-error.js";

// Tắt bot khẩn (phase 9): cờ `isHalted` được kiểm TỪNG TIN lúc tới lượt (kể cả tin đã xếp sẵn) — đang tắt thì tin bị từ chối
// BotHaltedError ngay, không tốn giãn cách. Ngoại lệ duy nhất là mức "control" (câu trả lời lệnh tắt / bật / tình trạng):
// chen đầu hàng và đi qua cờ. Chỉ bot-halt-commands.ts được dùng mức này.

export type SendPriority = "normal" | "low" | "control";

// Tài khoản bot loại Normal (chỉ gom dữ liệu): `isCollectOnly` được kiểm TỪNG LỆNH, kể cả mức "control" — mọi lệnh bị từ
// chối CollectOnlyAccountError (không thử lại). Ngoại lệ duy nhất là lệnh đánh dấu `allowCollectOnly` (tab «Bạn bè» trên web:
// quản trị tự bấm tìm / gửi / nhận / hủy lời mời). Đổi loại tài khoản có hiệu lực ngay vì cờ đọc lại mỗi lần.
export interface SendOptions {
  allowCollectOnly?: boolean;
}

/** Tin phụ chỉ gửi khi hàng gửi còn không quá ngần này tin (kể cả tin đang gửi) — ngày thường vẫn nhắn «chờ em xíu». */
export const QUIET_MAX_PENDING = 2;

interface QueuedSend {
  priority: SendPriority;
  /** true = lệnh do quản trị tự bấm ở tab «Bạn bè» — được đi qua dù tài khoản chỉ gom dữ liệu. */
  allowCollectOnly: boolean;
  /** Từ chối tin này (bot đang tắt khẩn / tài khoản chỉ gom dữ liệu) — không gọi Zalo. */
  reject: (error: Error) => void;
  /** true = đã thật sự gọi Zalo (kể cả lỗi) → tính giãn cách; false = việc tự bỏ (trả null), không tốn lượt. */
  run: () => Promise<boolean>;
}

/** Số càng nhỏ càng đi trước. */
const RANK: Record<SendPriority, number> = { control: 0, normal: 1, low: 2 };

export class ZaloSender {
  private readonly queue: QueuedSend[] = [];
  private busy = false;
  private lastSentAt = 0;

  /** `isHalted`: true = bot đang tắt khẩn, chặn mọi tin trừ mức "control". Mặc định không bao giờ tắt (bài kiểm). */
  constructor(
    private intervalMs: number,
    private readonly isHalted: () => boolean = () => false,
    /** true = tài khoản loại Normal, chặn mọi lệnh trừ lệnh `allowCollectOnly`. Mặc định không bao giờ (bài kiểm). */
    private readonly isCollectOnly: () => boolean = () => false,
  ) {}

  /** Đổi giãn cách (màn Cài đặt) — áp dụng từ tin kế tiếp. */
  setInterval(intervalMs: number): void {
    this.intervalMs = intervalMs;
  }

  /** Số tin đang chờ + đang gửi. */
  get pending(): number {
    return this.queue.length + (this.busy ? 1 : 0);
  }

  send<T>(task: () => Promise<T>, priority: SendPriority = "normal", options: SendOptions = {}): Promise<T> {
    const allowCollectOnly = options.allowCollectOnly === true;
    // Chặn ngay lúc xếp hàng — lệnh bị chặn không chờ giãn cách, không chiếm chỗ của lệnh khác
    if (!allowCollectOnly && this.isCollectOnly()) return Promise.reject(new CollectOnlyAccountError());
    return new Promise<T>((resolve, reject) => {
      // Lỗi của tin này trả về đúng nơi gọi, không chặn các tin sau
      const item: QueuedSend = {
        priority,
        allowCollectOnly,
        reject,
        // async + try: task ném lỗi NGAY khi gọi (không phải lỗi bất đồng bộ) cũng chỉ về nơi gọi, vòng gửi chạy tiếp
        run: async () => {
          try {
            const result = await task();
            resolve(result);
            // Quy ước: việc trả null = tự bỏ, không gửi gì (vd tin «chờ em xíu» mà câu trả lời đã gửi rồi) — không tính giãn
            // cách. Giả lập 09/10/2026: 100 lượt bỏ như vậy vẫn chiếm 100 × 1,5 giây của hàng gửi
            return result !== null;
          } catch (error) {
            reject(error);
            return true;
          }
        },
      };
      // Control chen trước mọi tin; thường chen trước mọi tin phụ; giữ thứ tự đến trong cùng một mức
      const firstBehind = this.queue.findIndex((queued) => RANK[queued.priority] > RANK[priority]);
      if (firstBehind >= 0) this.queue.splice(firstBehind, 0, item);
      else this.queue.push(item);
      void this.pump();
    });
  }

  /** Tin phụ («chờ em xíu»): hàng gửi đang đông thì bỏ — trả null, không xếp hàng. */
  sendIfQuiet<T>(task: () => Promise<T>, maxPending = QUIET_MAX_PENDING): Promise<T | null> {
    if (this.pending > maxPending) return Promise.resolve(null);
    return this.send(task, "low");
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        // Tài khoản vừa được đổi sang «chỉ gom dữ liệu» khi lệnh còn đang xếp hàng: dọn hết lệnh không có ngoại lệ
        if (this.isCollectOnly()) {
          const blocked = this.queue.findIndex((queued) => !queued.allowCollectOnly);
          if (blocked >= 0) {
            this.queue.splice(blocked, 1)[0].reject(new CollectOnlyAccountError());
            continue;
          }
        }
        // Kiểm cờ trước khi chờ giãn cách: tin bị chặn không tốn lượt, hàng đã xếp sẵn được dọn ngay
        if (this.isHalted()) {
          const next = this.queue.findIndex((queued) => queued.priority !== "control");
          if (next >= 0) {
            this.queue.splice(next, 1)[0].reject(new BotHaltedError());
            continue;
          }
        }
        const wait = this.lastSentAt + this.intervalMs - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        const item = this.queue.shift();
        if (!item) break;
        // Cờ có thể bật trong lúc chờ giãn cách
        if (!item.allowCollectOnly && this.isCollectOnly()) {
          item.reject(new CollectOnlyAccountError());
          continue;
        }
        if (item.priority !== "control" && this.isHalted()) {
          item.reject(new BotHaltedError());
          continue;
        }
        if (await item.run()) this.lastSentAt = Date.now();
      }
    } finally {
      this.busy = false;
    }
  }
}
