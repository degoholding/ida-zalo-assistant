// Chỉ số phản hồi (phase 15, 10/11/2026) — lõi thuần, không DB: đi qua tin của MỘT cuộc theo thứ tự thời gian, ghép thành
// «lượt chờ»: tin KHÁCH đầu tiên mở lượt, các tin khách kế tiếp nối vào cùng lượt, tin NHÂN VIÊN đầu tiên sau đó đóng lượt và
// nhận công (responder). Mỗi lượt tính vào NGÀY mở lượt (giờ VN). Thời gian chờ đo hai kiểu: giờ thường và giờ làm việc theo
// lịch; trễ = chờ quá `slaMinutes` phút làm việc. Lượt chưa ai trả lời tới mốc `now` là «đang mở»; mở quá ngưỡng là «mở quá hạn».
// Tin nhân viên không thuộc lượt nào (chủ động nhắn) chỉ đếm vào staffMessages.

export interface EpisodeMessage {
  sentAt: Date;
  senderUid: string;
  senderName: string;
}

export interface ReplyStats {
  customerMessages: number;
  episodes: number;
  answered: number;
  answeredLate: number;
  openEpisodes: number;
  openOverdue: number;
  waitSumSec: number;
  waitMaxSec: number;
  workWaitSumSec: number;
  workWaitMaxSec: number;
  staffMessages: number;
}

export interface ResponderStats extends ReplyStats {
  responderUid: string;
  responderName: string;
}

export interface ReplyComputeOptions {
  /** Mốc tính — lượt chưa trả lời đo tới đây. */
  now: Date;
  /** Ngưỡng trễ, phút LÀM VIỆC. 0 = không xét trễ. */
  slaMinutes: number;
  isStaff: (uid: string) => boolean;
  /** Phút làm việc giữa hai mốc (WorkCalendar.workingMinutesBetween); null = tính theo giờ thường. */
  workingMinutesBetween: ((from: Date, to: Date) => number) | null;
  /** Ngày VN 'YYYY-MM-DD' của một mốc. */
  dayOf: (at: Date) => string;
  /** Chỉ tính lượt mở từ ngày này (bao gồm); tin trước đó chỉ để dựng trạng thái. Bỏ trống = tính hết. */
  fromDay?: string;
}

export interface ReplyComputeResult {
  /** Theo ngày mở lượt — dòng tổng của cuộc. */
  byDay: Map<string, ReplyStats>;
  /** Theo ngày × người trả lời — khóa `${day}\u0000${uid}`. */
  byResponderDay: Map<string, ResponderStats>;
}

export function emptyReplyStats(): ReplyStats {
  return {
    customerMessages: 0, episodes: 0, answered: 0, answeredLate: 0, openEpisodes: 0, openOverdue: 0,
    waitSumSec: 0, waitMaxSec: 0, workWaitSumSec: 0, workWaitMaxSec: 0, staffMessages: 0,
  };
}

interface OpenEpisode {
  startedAt: Date;
  day: string;
  counted: boolean;
}

export function responderKey(day: string, uid: string): string {
  return `${day}\u0000${uid}`;
}

/** Tin phải xếp theo sentAt tăng dần. */
export function computeReplyStats(messages: readonly EpisodeMessage[], options: ReplyComputeOptions): ReplyComputeResult {
  const byDay = new Map<string, ReplyStats>();
  const byResponderDay = new Map<string, ResponderStats>();
  const dayStats = (day: string): ReplyStats => {
    let stats = byDay.get(day);
    if (!stats) byDay.set(day, (stats = emptyReplyStats()));
    return stats;
  };
  const responderStats = (day: string, uid: string, name: string): ResponderStats => {
    const key = responderKey(day, uid);
    let stats = byResponderDay.get(key);
    if (!stats) byResponderDay.set(key, (stats = { ...emptyReplyStats(), responderUid: uid, responderName: name }));
    else if (!stats.responderName && name) stats.responderName = name;
    return stats;
  };
  const inWindow = (day: string) => !options.fromDay || day >= options.fromDay;
  const waitSeconds = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  const workWaitSeconds = (from: Date, to: Date) =>
    options.workingMinutesBetween ? Math.round(options.workingMinutesBetween(from, to) * 60) : waitSeconds(from, to);
  const isLate = (workSec: number) => options.slaMinutes > 0 && workSec > options.slaMinutes * 60;

  let open: OpenEpisode | null = null;
  for (const message of messages) {
    const day = options.dayOf(message.sentAt);
    const counted = inWindow(day);
    if (options.isStaff(message.senderUid)) {
      if (counted) {
        dayStats(day).staffMessages += 1;
        responderStats(day, message.senderUid, message.senderName).staffMessages += 1;
      }
      if (open) {
        if (open.counted) {
          const wait = waitSeconds(open.startedAt, message.sentAt);
          const workWait = workWaitSeconds(open.startedAt, message.sentAt);
          const late = isLate(workWait);
          for (const stats of [dayStats(open.day), responderStats(open.day, message.senderUid, message.senderName)]) {
            stats.answered += 1;
            if (late) stats.answeredLate += 1;
            stats.waitSumSec += wait;
            stats.waitMaxSec = Math.max(stats.waitMaxSec, wait);
            stats.workWaitSumSec += workWait;
            stats.workWaitMaxSec = Math.max(stats.workWaitMaxSec, workWait);
          }
        }
        open = null;
      }
      continue;
    }
    // Tin khách
    if (counted) dayStats(day).customerMessages += 1;
    if (!open) {
      open = { startedAt: message.sentAt, day, counted };
      if (counted) dayStats(day).episodes += 1;
    }
  }
  if (open && open.counted) {
    const stats = dayStats(open.day);
    stats.openEpisodes += 1;
    if (isLate(workWaitSeconds(open.startedAt, options.now))) stats.openOverdue += 1;
  }
  return { byDay, byResponderDay };
}
