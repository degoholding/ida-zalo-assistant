import { ThreadType, type API } from "zca-js";
import type { Db } from "../db/pool.js";
import type { Logger } from "../logger.js";
import { handleHaltGate } from "../messaging/bot-halt-commands.js";
import type { BotHaltControl } from "../messaging/bot-halt.js";
import type { ContactRow } from "../sync/contact-repository.js";
import type { GroupRow } from "../sync/group-repository.js";
import { recordOutgoingMessage } from "../sync/message-ingest.js";
import type { ZaloSender } from "./zalo-sender.js";

// Nối cổng lệnh tắt / bật bot vào tin riêng của một tài khoản bot (phase 9): chạy lệnh, gửi câu trả lời mức "control"
// (qua được cờ tắt), báo tin có được xử lý hết không. Tách khỏi account-runner.ts cho gọn.

export interface DirectHaltGateDeps {
  db: Db;
  control: BotHaltControl;
  sender: ZaloSender;
  log: Pick<Logger, "info" | "warn">;
  getApi: () => API | null;
  getBot: () => { uid: string; name: string };
}

/** true = tin đã được cổng xử lý (lệnh bot hoặc bot đang tắt) → KHÔNG xếp việc trả lời nữa. */
export async function applyDirectHaltGate(deps: DirectHaltGateDeps, thread: GroupRow, contact: ContactRow, text: string): Promise<boolean> {
  let result;
  try {
    result = await handleHaltGate({ db: deps.db, control: deps.control }, contact, text);
  } catch (error) {
    // Lỗi cổng (vd DB) khi bot ĐANG TẮT phải chặn, không để tin lọt xuống xếp việc; đang bật thì cho đi tiếp luồng thường
    deps.log.warn("cổng lệnh tắt / bật bot lỗi", error);
    return deps.control.status().halted;
  }
  const api = deps.getApi();
  if (result.reply && api) {
    try {
      const response = await deps.sender.send(() => api.sendMessage(result.reply!, contact.zalo_uid, ThreadType.User), "control");
      const msgId = response.message?.msgId;
      if (msgId) await recordOutgoingMessage(deps.db, thread, deps.getBot(), String(msgId), result.reply);
    } catch (error) {
      deps.log.warn("gửi câu trả lời lệnh tắt / bật bot lỗi", error);
    }
  }
  return result.consumed;
}
