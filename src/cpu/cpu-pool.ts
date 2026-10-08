import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { createLogger } from "../logger.js";
import type { CpuRequest, CpuResponse, CpuTask } from "./cpu-worker.js";

// Bể luồng phụ cho việc nặng CPU (bóc chữ xlsx / docx). Luồng chính của Node vừa nghe tin Zalo, vừa chạy web, vừa đợi
// AI — một tệp Excel lớn bóc ngay trên luồng chính là cả bot đứng vài giây. Ở đây: tối đa `size` luồng, việc dư xếp
// hàng; một việc quá `timeoutMs` thì giết luồng đó (tệp hiểm) và dựng luồng mới cho việc sau.

const log = createLogger("cpu");
const DEFAULT_TIMEOUT_MS = 60_000;

// Chạy mã đã build (dist/*.js) hay qua tsx (src/*.ts): luồng phụ dùng cùng đuôi với tệp này. Luồng phụ thừa hưởng
// execArgv của tiến trình (vd `--import tsx`) nên đọc được .ts khi chạy dev / bài kiểm.
const selfPath = fileURLToPath(import.meta.url);
const WORKER_PATH = path.join(path.dirname(selfPath), `cpu-worker${path.extname(selfPath)}`);

interface PendingTask {
  id: number;
  task: CpuTask;
  data: Buffer;
  resolve: (result: { text: string; summary: string }) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  busy: PendingTask | null;
  timer: NodeJS.Timeout | null;
}

export class CpuPool {
  private readonly slots: Slot[] = [];
  private readonly queue: PendingTask[] = [];
  private nextId = 1;
  private closed = false;

  constructor(private readonly size = 1, private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  run(task: CpuTask, data: Buffer): Promise<{ text: string; summary: string }> {
    if (this.closed) return Promise.reject(new Error("bể luồng đã đóng"));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, task, data, resolve, reject });
      this.dispatch();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const pending of this.queue.splice(0)) pending.reject(new Error("bể luồng đã đóng"));
    await Promise.allSettled(this.slots.splice(0).map((slot) => slot.worker.terminate()));
  }

  private dispatch(): void {
    while (this.queue.length) {
      let slot = this.slots.find((candidate) => !candidate.busy);
      if (!slot && this.slots.length < this.size) slot = this.spawn();
      if (!slot) return;
      const pending = this.queue.shift()!;
      slot.busy = pending;
      slot.timer = setTimeout(() => this.kill(slot!, new Error(`bóc chữ quá ${Math.max(1, Math.round(this.timeoutMs / 1000))} giây, đã dừng`)), this.timeoutMs);
      const request: CpuRequest = { id: pending.id, task: pending.task, data: pending.data };
      slot.worker.postMessage(request);
    }
  }

  private spawn(): Slot {
    const worker = new Worker(WORKER_PATH);
    const slot: Slot = { worker, busy: null, timer: null };
    worker.on("message", (response: CpuResponse) => {
      const pending = slot.busy;
      if (!pending || pending.id !== response.id) return;
      this.release(slot);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error));
      this.dispatch();
    });
    worker.on("error", (error) => this.kill(slot, error));
    worker.on("exit", (code) => {
      if (this.slots.includes(slot)) this.kill(slot, new Error(`luồng phụ thoát (mã ${code})`));
    });
    // Luồng rảnh không giữ tiến trình sống
    worker.unref();
    this.slots.push(slot);
    return slot;
  }

  private release(slot: Slot): void {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.busy = null;
  }

  /** Luồng hỏng / quá giờ: báo lỗi việc đang làm, bỏ luồng, việc sau dựng luồng mới. */
  private kill(slot: Slot, error: Error): void {
    const index = this.slots.indexOf(slot);
    if (index === -1) return;
    this.slots.splice(index, 1);
    const pending = slot.busy;
    this.release(slot);
    void slot.worker.terminate();
    if (pending) {
      log.warn(`luồng bóc chữ bỏ việc: ${error.message}`);
      pending.reject(error);
    }
    this.dispatch();
  }
}
