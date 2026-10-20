// mcp-guard: infra — nhật ký + giới hạn lượt hỏi của CHÍNH trợ lý (bảng assistant_turn), không phải dữ liệu nghiệp vụ đưa cho mô hình
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { AssistantTurnStatus } from "../../constants.js";
import type { Db } from "../../db/pool.js";

// Giới hạn số câu / giờ + trần token / ngày của trợ lý và ghi nhật ký từng lượt. Tách khỏi assistant-service.ts (O5: hạ tầng ngoài MCP).

export interface AssistantLimits {
  maxPerHour: number;
  dailyTokenCap: number;
  /** Trần token mỗi ngày của MỘT tài khoản bot; 0 / bỏ trống = không giới hạn riêng. */
  dailyTokenCapPerBot?: number;
}

/** Phần của yêu cầu mà nhật ký + giới hạn cần. */
export interface TurnLogRequest {
  botAccountId: number;
  contact: { id: number };
  threadId: number;
  questionMessageId: number | null;
}

export interface TurnLogDetail {
  started: number;
  answer?: string;
  toolCalls?: unknown[];
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  model?: string;
}

/** `ok` = cho qua; `rate_limited` / `daily_cap` = chạm trần (`alreadyTold`: đã báo một lần rồi nên lần này im lặng). */
export type TurnLimitVerdict = { kind: "ok" } | { kind: "rate_limited" | "daily_cap"; alreadyTold: boolean };

/** Kiểm trần số câu / giờ (theo người hỏi) rồi trần token / ngày (toàn bot + riêng từng tài khoản bot). */
export async function checkTurnLimits(db: Db, limits: AssistantLimits, request: TurnLogRequest, now: Date): Promise<TurnLimitVerdict> {
  const [hourRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n, SUM(status = ?) AS limited FROM assistant_turn
     WHERE contact_id = ? AND created_at > ? AND status IN (?, ?, ?)`,
    [AssistantTurnStatus.RateLimited, request.contact.id, new Date(now.getTime() - 3_600_000),
     AssistantTurnStatus.Answered, AssistantTurnStatus.Failed, AssistantTurnStatus.RateLimited],
  );
  if (Number(hourRows[0].n) - Number(hourRows[0].limited ?? 0) >= limits.maxPerHour) {
    // Chỉ báo MỘT lần trong giờ đó, các câu sau im lặng — tránh bot gửi tin dồn dập
    return { kind: "rate_limited", alreadyTold: Number(hourRows[0].limited ?? 0) > 0 };
  }
  // Ngày theo giờ Việt Nam
  const dayStart = new Date(Math.floor((now.getTime() + 7 * 3_600_000) / 86_400_000) * 86_400_000 - 7 * 3_600_000);
  const [dayRows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
            COALESCE(SUM(CASE WHEN bot_account_id = ? THEN input_tokens + output_tokens END), 0) AS bot_tokens,
            SUM(status = ? AND contact_id = ?) AS told
     FROM assistant_turn WHERE created_at >= ?`,
    [request.botAccountId, AssistantTurnStatus.DailyCapReached, request.contact.id, dayStart],
  );
  const perBotCap = limits.dailyTokenCapPerBot ?? 0;
  if (Number(dayRows[0].tokens) >= limits.dailyTokenCap || (perBotCap > 0 && Number(dayRows[0].bot_tokens) >= perBotCap)) {
    return { kind: "daily_cap", alreadyTold: Number(dayRows[0].told ?? 0) > 0 };
  }
  return { kind: "ok" };
}

/** Ghi một lượt vào assistant_turn. `model` đã là tên mô hình thật trả lời (có thể là mô hình dự phòng). */
export async function logAssistantTurn(db: Db, request: TurnLogRequest, status: AssistantTurnStatus, detail: TurnLogDetail, model: string, now: Date): Promise<void> {
  await db.query<ResultSetHeader>(
    `INSERT INTO assistant_turn (bot_account_id, contact_id, thread_id, question_msg_id, status, model, tool_calls,
       answer, input_tokens, output_tokens, error, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [request.botAccountId, request.contact.id, request.threadId, request.questionMessageId, status, detail.model ?? model,
     detail.toolCalls?.length ? JSON.stringify(detail.toolCalls) : null, detail.answer ?? null,
     detail.inputTokens ?? 0, detail.outputTokens ?? 0, (detail.error ?? "").slice(0, 500), Date.now() - detail.started, now],
  );
}
