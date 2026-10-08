import os from "node:os";
import type { JobKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import { claimJobs, completeJob, failJob, recoverStaleJobs, type JobRow } from "./job-queue.js";

// Bộ chạy việc: lấy việc từ bảng `job` theo loại mình xử lý, chạy song song tối đa `concurrency` việc. Có việc mới ghi
// từ chính tiến trình này thì gọi wake() để lấy ngay; việc ghi từ tiến trình khác thì lượt quét định kỳ (pollMs) nhặt.
//
// Mỗi loại việc chỉ nên có MỘT tiến trình xử lý: hai tiến trình cùng lấy một loại có thể chạy song song hai việc cùng
// serial_key trong khoảnh khắc chưa commit (SKIP LOCKED không thấy dòng của nhau). Hiện: trả lời trợ lý → app.

export type JobHandler = (job: JobRow) => Promise<void>;

export interface JobRunnerOptions {
  db: Db;
  /** Tên vai tiến trình ghi vào locked_by, vd «app», «worker». */
  role: string;
  handlers: Partial<Record<JobKind, JobHandler>>;
  concurrency: number;
  pollMs?: number;
  /** Việc «đang chạy» giữ quá ngần này coi như tiến trình đã chết — trả về hàng. */
  staleMs?: number;
}

const DEFAULT_POLL_MS = 2000;
const DEFAULT_STALE_MS = 15 * 60_000;
const STOP_WAIT_MS = 20_000;

export class JobRunner {
  private readonly log;
  private readonly workerId: string;
  private readonly kinds: JobKind[];
  private concurrency: number;
  private readonly running = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  /** Đang trong một lượt lấy việc — các lượt claim không chồng lên nhau trong cùng tiến trình. */
  private pumping = false;
  private pumpAgain = false;

  constructor(private readonly options: JobRunnerOptions) {
    this.log = createLogger(`jobs:${options.role}`);
    this.workerId = `${options.role}:${os.hostname()}:${process.pid}`.slice(0, 100);
    this.kinds = Object.keys(options.handlers).map(Number) as JobKind[];
    this.concurrency = Math.max(1, options.concurrency);
  }

  async start(): Promise<void> {
    this.stopped = false;
    const recovered = await recoverStaleJobs(this.options.db, this.options.staleMs ?? DEFAULT_STALE_MS);
    if (recovered) this.log.warn(`trả ${recovered} việc bị bỏ dở về hàng`);
    this.schedule(0);
  }

  setConcurrency(value: number): void {
    this.concurrency = Math.max(1, value);
    this.wake();
  }

  /** Có việc mới — lấy ngay, không đợi lượt quét. */
  wake(): void {
    if (!this.stopped) this.schedule(0);
  }

  get activeCount(): number {
    return this.running.size;
  }

  /** Thôi lấy việc mới; chờ việc đang chạy xong (tối đa STOP_WAIT_MS) rồi về. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.running.size) return;
    await Promise.race([Promise.allSettled([...this.running]), new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS))]);
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, delayMs);
  }

  private async pump(): Promise<void> {
    if (this.stopped) return;
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    try {
      const free = this.concurrency - this.running.size;
      if (free > 0) {
        const jobs = await claimJobs(this.options.db, this.workerId, this.kinds, free);
        for (const job of jobs) this.track(job);
      }
    } catch (error) {
      this.log.error("lấy việc lỗi", error);
    } finally {
      this.pumping = false;
    }
    if (this.stopped) return;
    if (this.pumpAgain) {
      this.pumpAgain = false;
      this.schedule(0);
    } else if (!this.timer) {
      this.schedule(this.options.pollMs ?? DEFAULT_POLL_MS);
    }
  }

  private track(job: JobRow): void {
    const task = this.execute(job).finally(() => {
      this.running.delete(task);
      // Vừa có chỗ trống: việc cùng serial_key đang chờ có thể chạy được rồi
      this.wake();
    });
    this.running.add(task);
  }

  private async execute(job: JobRow): Promise<void> {
    const handler = this.options.handlers[job.kind];
    const { db } = this.options;
    try {
      if (!handler) throw new Error(`không có bộ xử lý cho loại việc ${job.kind}`);
      await handler(job);
      await completeJob(db, job.id);
    } catch (error) {
      const message = describeError(error);
      const status = await failJob(db, job, message).catch((dbError) => {
        this.log.error(`ghi lỗi việc #${job.id} lỗi`, dbError);
        return null;
      });
      this.log.warn(`việc #${job.id} (loại ${job.kind}, lần ${job.attempts}/${job.maxAttempts}) lỗi${status === null ? "" : status === 0 ? ", sẽ thử lại" : ", bỏ"}: ${message}`);
    }
  }
}
