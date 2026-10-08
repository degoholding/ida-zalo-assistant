import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { ScheduleRunStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import { vnLocalTime, type WorkCalendar } from "./work-calendar.js";

// Bộ lập lịch (phase 3, bước 3.2): việc chạy theo giờ — mỗi N phút, hằng ngày lúc HH:MM, hằng tuần, hằng tháng; có thể
// chỉ chạy ngày làm việc. Mỗi việc có «lượt» (slot) — vd ngày «2026-10-08» với việc hằng ngày. Lượt được NHẬN bằng một
// câu UPDATE có điều kiện trên bảng schedule_run nên: hai tiến trình không chạy trùng; tiến trình tắt qua giờ chạy thì
// bật lên chạy bù lượt hôm đó (chưa qua ngày). Giờ tính theo giờ Việt Nam.

const log = createLogger("schedule");
const TICK_MS = 30_000;

export type ScheduleSpec =
  | { every: "minutes"; minutes: number }
  | { every: "day"; at: string; workingDaysOnly?: boolean }
  /** weekday: 1 = thứ 2 … 7 = Chủ nhật */
  | { every: "week"; weekday: number; at: string }
  | { every: "month"; day: number; at: string };

export interface ScheduledTask {
  /** Khóa ổn định (cột schedule_run.task) — đổi tên là mất lịch sử chạy. */
  name: string;
  /** Tên hiện trên màn Cài đặt. */
  label: string;
  spec: ScheduleSpec;
  run: () => Promise<unknown>;
}

const parseAt = (at: string): number => {
  const [hours, minutes] = at.split(":").map(Number);
  return hours * 60 + minutes;
};

/**
 * Lượt đang tới hạn của một lịch tại mốc `now`, hoặc null nếu hôm nay / tuần này / tháng này chưa tới giờ. Hàm thuần.
 * Việc «mỗi N phút» luôn có lượt (số thứ tự khối N phút).
 */
export function currentSlot(spec: ScheduleSpec, now: Date, calendar: WorkCalendar | null): string | null {
  const local = vnLocalTime(now);
  if (spec.every === "minutes") return `m${Math.floor(now.getTime() / (Math.max(1, spec.minutes) * 60_000))}`;
  if (local.minuteOfDay < parseAt(spec.at)) return null;
  if (spec.every === "day") {
    if (spec.workingDaysOnly && calendar && !calendar.isWorkingDay(now)) return null;
    return local.date;
  }
  if (spec.every === "week") {
    if (local.weekday !== spec.weekday) return null;
    return `w${local.date}`;
  }
  const dayOfMonth = Number(local.date.slice(8, 10));
  if (dayOfMonth !== spec.day) return null;
  return `M${local.date.slice(0, 7)}`;
}

/** Câu mô tả lịch cho màn hình, vd «hằng ngày 07:30 (ngày làm việc)». */
export function describeSpec(spec: ScheduleSpec): string {
  const weekdays = ["", "thứ 2", "thứ 3", "thứ 4", "thứ 5", "thứ 6", "thứ 7", "Chủ nhật"];
  switch (spec.every) {
    case "minutes": return spec.minutes % 60 === 0 ? `mỗi ${spec.minutes / 60} giờ` : `mỗi ${spec.minutes} phút`;
    case "day": return `hằng ngày ${spec.at}${spec.workingDaysOnly ? " (ngày làm việc)" : ""}`;
    case "week": return `${weekdays[spec.weekday]} hằng tuần ${spec.at}`;
    case "month": return `ngày ${spec.day} hằng tháng ${spec.at}`;
  }
}

export interface ScheduleStatus {
  name: string;
  label: string;
  schedule: string;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastStatus: ScheduleRunStatus;
  lastError: string;
  lastDurationMs: number;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly running = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly tasks: ScheduledTask[],
    /** Lịch làm việc hiện hành — đọc lại mỗi lượt để đổi cài đặt có hiệu lực ngay. */
    private readonly getCalendar: () => WorkCalendar | null,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async start(): Promise<void> {
    if (this.tasks.length) {
      await this.db.query(`INSERT IGNORE INTO schedule_run (task) VALUES ${this.tasks.map(() => "(?)").join(", ")}`,
        this.tasks.map((task) => task.name));
    }
    await this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Một lượt quét: việc nào tới lượt mới thì nhận lượt rồi chạy (không chờ nhau). */
  async tick(): Promise<void> {
    const now = this.clock();
    let calendar: WorkCalendar | null = null;
    try {
      calendar = this.getCalendar();
    } catch (error) {
      log.warn(`lịch làm việc lỗi, việc «chỉ ngày làm việc» tạm coi mọi ngày là ngày làm: ${describeError(error)}`);
    }
    for (const task of this.tasks) {
      if (this.running.has(task.name)) continue;
      const slot = currentSlot(task.spec, now, calendar);
      if (!slot) continue;
      try {
        if (await this.claim(task.name, slot)) void this.execute(task);
      } catch (error) {
        log.error(`nhận lượt việc «${task.label}» lỗi`, error);
      }
    }
  }

  private async claim(name: string, slot: string): Promise<boolean> {
    const [result] = await this.db.query<ResultSetHeader>(
      `UPDATE schedule_run SET last_slot = ?, last_started_at = NOW(3), last_status = ?, last_error = ''
       WHERE task = ? AND (last_slot IS NULL OR last_slot <> ?)`,
      [slot, ScheduleRunStatus.Running, name, slot]);
    return result.affectedRows === 1;
  }

  private async execute(task: ScheduledTask): Promise<void> {
    this.running.add(task.name);
    const started = Date.now();
    let status = ScheduleRunStatus.Done;
    let error = "";
    try {
      await task.run();
    } catch (failure) {
      status = ScheduleRunStatus.Failed;
      error = describeError(failure).slice(0, 500);
      log.error(`việc theo lịch «${task.label}» lỗi`, failure);
    } finally {
      this.running.delete(task.name);
    }
    await this.db.query(
      "UPDATE schedule_run SET last_finished_at = NOW(3), last_status = ?, last_error = ?, last_duration_ms = ? WHERE task = ?",
      [status, error, Date.now() - started, task.name],
    ).catch((dbError) => log.error("ghi kết quả việc theo lịch lỗi", dbError));
  }
}

/** Trạng thái các việc theo lịch — cho màn Cài đặt (đọc bảng, không cần tiến trình worker trả lời). */
export async function listScheduleStatus(db: Db, tasks: Pick<ScheduledTask, "name" | "label" | "spec">[]): Promise<ScheduleStatus[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM schedule_run");
  const byName = new Map(rows.map((row) => [String(row.task), row]));
  return tasks.map((task) => {
    const row = byName.get(task.name);
    return {
      name: task.name, label: task.label, schedule: describeSpec(task.spec),
      lastStartedAt: row?.last_started_at ? new Date(row.last_started_at) : null,
      lastFinishedAt: row?.last_finished_at ? new Date(row.last_finished_at) : null,
      lastStatus: Number(row?.last_status ?? ScheduleRunStatus.NeverRun) as ScheduleRunStatus,
      lastError: String(row?.last_error ?? ""),
      lastDurationMs: Number(row?.last_duration_ms ?? 0),
    };
  });
}
