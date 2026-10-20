import type { WriteExecuted } from "../write/write-action.js";

// Kết quả CÓ CẤU TRÚC của thao tác ghi việc, đưa từ `execute` ra công cụ (lớp lệnh dựng câu từ nó). Tách khỏi `WriteExecuted` qua WeakMap để không đổi kiểu
// dùng chung của khung ghi — cùng cách với họ ticket.

const OUTCOMES = new WeakMap<WriteExecuted, unknown>();

export function executedTask<T>(outcome: T, id: number | null, message: string, changed: string): WriteExecuted {
  const executed: WriteExecuted = { entity: "task", id, changed: [changed], message };
  OUTCOMES.set(executed, outcome);
  return executed;
}

export function taskOutcomeOf<T>(executed: WriteExecuted): T {
  if (!OUTCOMES.has(executed)) throw new Error("thiếu kết quả có cấu trúc của thao tác việc");
  return OUTCOMES.get(executed) as T;
}
