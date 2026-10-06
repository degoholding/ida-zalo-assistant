// Hỏi trợ lý AI từ dòng lệnh, không cần Zalo: `npm run ask -- "tóm tắt nhóm K52 hôm nay"`. Câu hỏi đi dưới tên
// quản lý demo (seed bằng `npm run seed:demo`), qua đúng đường AssistantService như tin Zalo thật — cùng
// cài đặt (web > .env), cùng công cụ, cùng giới hạn. Câu hỏi + câu trả lời lưu vào cuộc riêng nên hiện ở màn
// Hội thoại, và câu sau hiểu được câu trước («gửi tệp số 2»).

import type { RowDataPacket } from "mysql2";
import { loadConfig } from "../config.js";
import path from "node:path";
import { AssistantTurnStatus, MessageKind } from "../constants.js";
import { createPool } from "../db/pool.js";
import { reportFileExtension } from "../reports/report-exporter.js";
import { SettingsStore } from "../settings/settings-store.js";
import { createFileStorage } from "../storage/file-storage.js";
import { ingestDirectMessage, recordOutgoingMessage } from "../sync/message-ingest.js";
import { SyncService } from "../sync-service.js";
import { DEMO_BOT, DEMO_MANAGER } from "./demo-conversations.js";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Cách dùng: npm run ask -- "câu hỏi"');
  process.exit(1);
}

const config = loadConfig();
const db = createPool(config.databaseUrl);
try {
  const settings = new SettingsStore(db, config);
  await settings.load();
  // Chỉ mượn SyncService để dựng trợ lý đúng như dịch vụ thật — không bật tài khoản bot nào
  const assistant = new SyncService(db, config, createFileStorage(config), settings).assistant;
  if (!assistant) throw new Error("Trợ lý AI đang tắt — đặt khóa Gemini trong .env hoặc màn Cài đặt");
  const [bots] = await db.query<RowDataPacket[]>("SELECT id FROM bot_account WHERE label = ?", [DEMO_BOT.label]);
  if (!bots[0]) throw new Error("Chưa có dữ liệu demo — chạy: npm run seed:demo");
  const botAccountId = Number(bots[0].id);

  const now = Date.now();
  const deps = { db, defaults: { readMessages: true, captureFiles: false } };
  const asked = await ingestDirectMessage(deps, botAccountId, {
    zaloGroupId: DEMO_MANAGER.uid, msgId: `demo-ask-${now}`, cliMsgId: "", msgType: "webchat",
    senderUid: DEMO_MANAGER.uid, senderName: DEMO_MANAGER.name, sentAtMs: now, content: question, quote: null, mentions: null,
  });
  console.log(`«${DEMO_MANAGER.name}» hỏi: ${question}\n`);
  const startedAt = Date.now();
  const reply = await assistant.answer({
    botAccountId, contact: asked.contact, threadId: asked.thread.id, questionMessageId: asked.messageId, question,
  });
  if (reply.text) {
    await recordOutgoingMessage(db, asked.thread, { uid: DEMO_BOT.uid, name: DEMO_BOT.name }, `demo-reply-${Date.now()}`, reply.text);
    console.log(`Bot trả lời:\n${reply.text}\n`);
  }
  for (const file of reply.reportFiles ?? []) {
    // Như bot thật: ghi tin gửi tệp vào cuộc riêng → màn Tệp / Hội thoại thấy, tải về được
    await recordOutgoingMessage(db, asked.thread, { uid: DEMO_BOT.uid, name: DEMO_BOT.name }, `demo-report-${Date.now()}`, file.fileName, {
      kind: MessageKind.File, file: { name: file.fileName, ext: reportFileExtension(file.fileName), storageKey: file.storageKey, bytes: file.bytes },
    });
    const where = config.storageDriver === "local" ? path.resolve(config.dataDir, "files", file.storageKey) : `R2: ${file.storageKey}`;
    console.log(`Báo cáo Excel: ${where} (${Math.round(file.bytes / 1024)} KB) — trên Zalo thật bot gửi tệp này cho người hỏi`);
  }
  if (reply.attachmentIds.length) console.log(`Bot gửi kèm tệp #${reply.attachmentIds.join(", #")} (chỉ ghi nhận — demo không có tệp thật)`);
  console.log(`(${AssistantTurnStatus[reply.status]}, ${((Date.now() - startedAt) / 1000).toFixed(1)} giây — chi tiết token / công cụ ở bảng assistant_turn)`);
} finally {
  await db.end();
}
