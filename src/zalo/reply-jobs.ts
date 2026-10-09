import { JobKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import { enqueueJob } from "../jobs/job-queue.js";
import type { IncomingGroupMessage } from "../sync/message-ingest.js";
import { ACK_DELAY_MS } from "./assistant-ack.js";

// Câu hỏi gửi bot đi qua hàng đợi (08/10/2026): lúc nhận tin chỉ ghi việc rồi đi tiếp, bộ chạy việc trả lời sau với trần
// số việc song song. Câu hỏi chờ quá REPLY_EXPIRES_MS (bot tắt lâu, hàng đợi kẹt) thì bỏ — trả lời muộn hơn thế vô nghĩa.

export const REPLY_EXPIRES_MS = 15 * 60_000;
export const REPLY_MAX_ATTEMPTS = 2;

/** Hỏi qua tin riêng. */
export interface DirectReplyPayload {
  accountId: number;
  threadId: number;
  senderUid: string;
  messageId: number | null;
  question: string;
}

/** Gọi bot trong nhóm. `quote` = dữ liệu gốc của tin được hỏi (zca-js) — để câu trả lời trích dẫn đúng tin. */
export interface GroupReplyPayload {
  accountId: number;
  groupId: number;
  incoming: IncomingGroupMessage;
  quote: unknown;
  question: string;
}

/** Mỗi cuộc trò chuyện trả lời lần lượt từng câu — câu sau đọc được câu trả lời trước. */
export const threadSerialKey = (threadId: number) => `thread:${threadId}`;

export function enqueueDirectReply(db: Db, payload: DirectReplyPayload, zaloMsgId: string): Promise<number | null> {
  return enqueueJob(db, {
    kind: JobKind.AssistantDirectReply, payload,
    // Zalo gửi lại tin cũ lúc nối lại kết nối — cùng mã tin thì không trả lời lần hai
    dedupeKey: `dm:${payload.accountId}:${zaloMsgId}`,
    serialKey: threadSerialKey(payload.threadId), expiresInMs: REPLY_EXPIRES_MS, maxAttempts: REPLY_MAX_ATTEMPTS,
  });
}

export function enqueueGroupReply(db: Db, payload: GroupReplyPayload): Promise<number | null> {
  return enqueueJob(db, {
    kind: JobKind.AssistantGroupReply, payload,
    // Nhiều tài khoản bot cùng nhóm: bot ghi việc trước thắng, mỗi tin chỉ một câu trả lời
    dedupeKey: `grp:${payload.incoming.zaloGroupId}:${payload.incoming.msgId}`,
    serialKey: threadSerialKey(payload.groupId), expiresInMs: REPLY_EXPIRES_MS, maxAttempts: REPLY_MAX_ATTEMPTS,
  });
}

/** Trạng thái «em nhận được rồi» của một việc trả lời: đã nhắn chưa, đã bắt đầu chưa, đã có câu trả lời chưa. */
export interface AckState {
  acked: boolean;
  started: boolean;
  /**
   * Trợ lý đã trả lời xong (câu trả lời đang / đã vào hàng gửi). Tin «chờ em xíu» còn nằm trong hàng gửi kiểm cờ này lúc tới
   * lượt: câu trả lời là tin thường nên chen trước tin phụ (ZaloSender) — không kiểm thì tin chờ tới SAU câu trả lời.
   */
  answered: boolean;
  timer: NodeJS.Timeout | null;
}

const newAckState = (): AckState => ({ acked: false, started: false, answered: false, timer: null });

/**
 * Giữ trạng thái nhắn xác nhận theo id việc. Hai đường nhắn: (1) việc nằm chờ trong hàng quá ACK_DELAY_MS — nhắn từ
 * lúc ghi việc; (2) việc đã chạy mà câu trả lời lâu — nhắn từ lúc trợ lý nhận câu hỏi. Chỉ nhắn MỘT lần.
 */
export class AckTracker {
  private readonly states = new Map<number, AckState>();

  /**
   * Gọi ngay sau khi ghi việc: quá ACK_DELAY_MS mà việc chưa chạy thì `send()`. `isAnswered` — kiểm lại lúc tin chờ tới lượt
   * trong hàng gửi: việc đã chạy và trả lời xong trong lúc tin chờ còn xếp hàng thì bỏ tin chờ.
   */
  watchQueued(jobId: number, send: (isAnswered: () => boolean) => Promise<void>): void {
    const state = newAckState();
    state.timer = setTimeout(() => {
      state.timer = null;
      if (state.started || state.acked) return;
      state.acked = true;
      void send(() => state.answered).catch(() => undefined);
    }, ACK_DELAY_MS);
    state.timer.unref?.();
    this.states.set(jobId, state);
  }

  /** Việc bắt đầu chạy — hủy hẹn nhắn lúc chờ; trả trạng thái để đường (2) biết đã nhắn chưa. */
  begin(jobId: number): AckState {
    const state = this.states.get(jobId) ?? newAckState();
    state.started = true;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    this.states.set(jobId, state);
    return state;
  }

  end(jobId: number): void {
    const state = this.states.get(jobId);
    if (state?.timer) clearTimeout(state.timer);
    this.states.delete(jobId);
  }
}
