// Nối trợ lý phase 10 (suggest_replies + query_metrics) qua AssistantService trên MySQL THẬT, mô hình AI là bản giả có kịch bản.
// Chạy: TEST_DATABASE_URL=mysql://root:<mật khẩu>@127.0.0.1:3308/<csdl_thử> npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { AssistantService } from "../src/assistant/assistant-service.js";
import type { GeminiContent, ModelClient } from "../src/assistant/gemini-client.js";
import { runTool } from "../src/assistant/tools.js";
import { AssistantTurnStatus, ContactRole, ReplyTemplateStatus } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { findContactByUid, updateContact } from "../src/sync/contact-repository.js";
import { foldText } from "../src/alerts/keyword-matcher.js";
import { ensureGroup } from "../src/sync/group-repository.js";
import { ingestDirectMessage, ingestGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-14T05:00:00Z"); // thứ 4, 12:00 giờ VN
const DRAFTS = JSON.stringify({ template_id: 0, drafts: [
  { tone: "formal", text: "Dạ em gửi anh giá Flowertop là [giá], áp dụng đến [ngày] ạ." },
  { tone: "friendly", text: "Dạ giá Flowertop em báo anh nha: [giá]." },
  { tone: "brief", text: "Flowertop: [giá] ạ." },
] });

function message(patch: Partial<IncomingGroupMessage>): IncomingGroupMessage {
  return {
    zaloGroupId: "g-dai-ly", msgId: "1", cliMsgId: "", msgType: "webchat", senderUid: "u-sau", senderName: "Anh Sáu",
    sentAtMs: NOW.getTime() - 3_600_000, content: "Flowertop giá sao em?", quote: null, mentions: null, ...patch,
  };
}

class ScriptedModel implements ModelClient {
  requests = 0;
  constructor(private readonly turns: (GeminiContent["parts"] | ((request: { contents: GeminiContent[] }) => GeminiContent["parts"]))[]) {}
  readonly seen: GeminiContent[][] = [];
  async generate(request: { contents: GeminiContent[] }) {
    this.requests += 1;
    this.seen.push(structuredClone(request.contents));
    const next = this.turns.shift();
    if (!next) throw new Error("hết kịch bản");
    return { content: { role: "model" as const, parts: typeof next === "function" ? next(request) : next }, inputTokens: 10, outputTokens: 5 };
  }
}

describe("trợ lý: gợi ý trả lời + hỏi số liệu", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let botId: number;
  let templateId: number;

  before(async () => { await runMigrations(databaseUrl!); db = createPool(databaseUrl!); });
  after(async () => { await db?.end(); });

  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of ["assistant_turn", "attachment", "message", "group_member", "bot_group", "zalo_group", "contact", "company",
      "session_event", "bot_account", "reply_template", "metric_value", "metric_source", "catalog_entry"]) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    const [bot] = await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    botId = bot.insertId;
    const [tpl] = await db.query<any>(
      `INSERT INTO reply_template (tenant_id, name, situation, keywords, body, tone, status)
       VALUES (1, 'Báo giá sản phẩm', 'Khách hỏi giá', 'giá, báo giá', 'Dạ giá [giá] /bao, áp dụng đến [ngày].', 1, ?)`, [ReplyTemplateStatus.Approved]);
    templateId = tpl.insertId;
  });

  async function setup() {
    const { group } = await ensureGroup(db, "g-dai-ly", { readMessages: true, captureFiles: false });
    await db.query("UPDATE zalo_group SET name = 'Nhóm Đại lý' WHERE id = ?", [group.id]);
    const deps = { db, defaults: { readMessages: false, captureFiles: false } };
    const source = await ingestGroupMessage(deps, botId, message({}));
    const asked = await ingestDirectMessage(deps, botId, message({ zaloGroupId: "u-sep", senderUid: "u-sep", senderName: "Sếp", msgId: "q1", content: "gợi ý trả lời tin giá Flowertop" }));
    await updateContact(db, asked.contact.id, { kind: 2, role: ContactRole.Manager, companyId: null, note: "" });
    const contact = (await findContactByUid(db, "u-sep"))!;
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE text LIKE 'Flowertop giá sao%' LIMIT 1");
    void source;
    const service = (model: ModelClient) => new AssistantService(db, model, "gia-lap", { maxPerHour: 30, dailyTokenCap: 1_000_000 }, () => NOW);
    const request = (question: string) => ({ botAccountId: botId, contact, threadId: asked.thread.id, questionMessageId: asked.messageId, question });
    return { group, contact, messageId: Number(rows[0].id), service, request };
  }

  test("gợi ý trả lời: tin đầu = header máy chủ dựng, mỗi bản nháp một followUp, mô hình chính không viết lại", async () => {
    const { messageId, service, request } = await setup();
    const model = new ScriptedModel([
      [{ functionCall: { name: "suggest_replies", args: { request: "trả lời tin hỏi giá Flowertop của anh Sáu", message_id: messageId } } }],
      [{ text: DRAFTS.replace('"template_id":0', `"template_id":${templateId}`) }],
    ]);
    const reply = await service(model).answer(request("gợi ý trả lời tin giá Flowertop của anh Sáu"));
    assert.equal(reply.status, AssistantTurnStatus.Answered);
    assert.match(reply.text!, /^GỢI Ý TRẢ LỜI — theo mẫu «Báo giá sản phẩm»/);
    assert.match(reply.text!, /Tin gốc: \[Nhóm Đại lý · Anh Sáu/);
    assert.match(reply.text!, /Em KHÔNG gửi đi đâu/);
    assert.equal(reply.followUps?.length, 3);
    assert.ok(reply.followUps!.every((draft) => draft.includes("[cần bổ sung") && !draft.includes("GỢI Ý")));
    // Lượt 1 chọn công cụ, lượt 2 là gọi nháp của công cụ; KHÔNG có lượt 3 để mô hình diễn đạt lại
    assert.equal(model.requests, 2);
    console.log("HEADER:\n" + reply.text + "\nFOLLOWUPS:\n" + reply.followUps!.join("\n--\n"));
    const [turns] = await db.query<RowDataPacket[]>("SELECT answer, tool_calls FROM assistant_turn");
    assert.equal(turns.length, 1);
    assert.match(turns[0].answer, /---/);
    assert.match(JSON.stringify(turns[0].tool_calls), /suggest_replies/);
  });

  test("không có mẫu đã duyệt khớp: từ chối + liệt kê mẫu, không followUps, không gọi mô hình soạn", async () => {
    const { service, request } = await setup();
    const model = new ScriptedModel([[{ functionCall: { name: "suggest_replies", args: { request: "chào buổi sáng" } } }]]);
    const reply = await service(model).answer(request("gợi ý trả lời lời chào buổi sáng"));
    assert.equal(reply.status, AssistantTurnStatus.Answered);
    assert.match(reply.text!, /Chưa có mẫu ĐÃ DUYỆT hợp tình huống này\. Mẫu đang dùng: «Báo giá sản phẩm»/);
    assert.equal(reply.followUps, undefined);
    assert.equal(model.requests, 1);
    console.log("TỪ CHỐI:\n" + reply.text);
  });

  test("hai lần gọi suggest_replies trong một lượt: chỉ lần đầu có hiệu lực", async () => {
    const { messageId, service, request } = await setup();
    const call = { functionCall: { name: "suggest_replies", args: { request: "trả lời tin hỏi giá Flowertop", message_id: messageId } } };
    const model = new ScriptedModel([[call, call], [{ text: DRAFTS.replace('"template_id":0', `"template_id":${templateId}`) }]]);
    const reply = await service(model).answer(request("gợi ý trả lời tin giá Flowertop"));
    assert.equal(reply.followUps?.length, 3);
    assert.equal(model.requests, 2); // 1 chọn công cụ + 1 soạn nháp (lần gọi thứ hai bị chặn, không soạn lại)
  });

  test("trong nhóm: không có hai công cụ (danh sách) và runTool từ chối", async () => {
    const { group, contact, service } = await setup();
    const seen: string[][] = [];
    const model: ModelClient = { async generate(request) {
      seen.push((request.tools as { name: string }[]).map((tool) => tool.name));
      return { content: { role: "model", parts: [{ text: "ok" }] }, inputTokens: 1, outputTokens: 1 };
    } };
    await service(model).answer({ botAccountId: botId, contact, threadId: group.id, questionMessageId: null, question: "tóm tắt nhóm", groupScope: { groupId: group.id, groupName: "Đại lý" } });
    assert.ok(!seen[0].includes("suggest_replies") && !seen[0].includes("query_metrics"));
    const blocked = await runTool({ db, askerUid: "u-sep", filesToSend: [], now: NOW, scopeGroupId: group.id }, "query_metrics", { metric: "doanh số" });
    assert.match(String(blocked.error), /nhóm/);
    const dm = new ScriptedModel([[{ text: "ok" }]]);
    let dmTools: string[] = [];
    const spy: ModelClient = { async generate(request) { dmTools = (request.tools as { name: string }[]).map((tool) => tool.name); return dm.generate(request); } };
    const { request } = await setup();
    await service(spy).answer(request("xin chào"));
    assert.ok(dmTools.includes("suggest_replies") && dmTools.includes("query_metrics"));
  });

  test("query_metrics: chưa có nguồn → nói rõ chưa có số liệu; có số → khớp DB + nguồn + giờ đọc", async () => {
    const { service, request } = await setup();
    const empty = new ScriptedModel([
      [{ functionCall: { name: "query_metrics", args: { metric: "doanh số", period: "this_week" } } }],
      [{ text: "Chưa có số liệu từ bảng Drive, em chưa đọc được." }],
    ]);
    const first = await service(empty).answer(request("doanh số tuần này"));
    assert.match(JSON.stringify(empty.seen[1].at(-1)), /Chưa có số liệu từ bảng Drive \(đang chờ IDA gửi link bảng\)\./);
    assert.match(first.text!, /Chưa có số liệu/);

    const mapping = { date: "Ngày", staff: "Nhân viên", area: "Khu vực", metrics: [{ code: "doanh_so", label: "Doanh số", column: "Doanh số", unit: "đ", aggregate: "sum" }] };
    const [src] = await db.query<any>("INSERT INTO metric_source (name, spreadsheet_id, sheet_title, mapping, last_ok_at) VALUES ('BCSale', 'abc', 'NKCV', ?, '2026-10-14 04:30:00')", [JSON.stringify(mapping)]);
    const rows: [string, string, string, number][] = [
      ["2026-10-13", "tam", "Cần Thơ", 100], ["2026-10-14", "tam", "Cần Thơ", 50], ["2026-10-14", "bay", "Cà Mau", 70], ["2026-10-07", "tam", "Cần Thơ", 100],
    ];
    for (const [date, staff, area, value] of rows) {
      await db.query(
        `INSERT INTO metric_value (source_id, metric_date, staff_key, staff_name, area_key, area_name, metric_code, value) VALUES (?, ?, ?, ?, ?, ?, 'doanh_so', ?)`,
        [src.insertId, date, `n:${staff}`, staff, foldText(area).trim(), area, value]);
    }
    const result = await runTool({ db, askerUid: "u-sep", filesToSend: [], now: NOW }, "query_metrics", { metric: "doanh số", period: "this_week" }) as any;
    assert.equal(result.total, 220);
    assert.equal(result.previous_total, 100);
    assert.equal(result.change_pct, 120);
    assert.match(result.source, /BCSale, đọc lúc 11:30/);
    const byArea = await runTool({ db, askerUid: "u-sep", filesToSend: [], now: NOW }, "query_metrics", { metric: "doanh số", period: "this_week", area: "Cần Thơ" }) as any;
    assert.equal(byArea.total, 150);
    const none = await runTool({ db, askerUid: "u-sep", filesToSend: [], now: NOW }, "query_metrics", { metric: "doanh số", period: "last_month" }) as any;
    assert.match(none.error, /Chưa có số liệu «Doanh số» trong tháng trước/);
    const unknown = await runTool({ db, askerUid: "u-sep", filesToSend: [], now: NOW }, "query_metrics", { metric: "lợi nhuận" }) as any;
    assert.deepEqual(unknown.available_metrics, ["Doanh số"]);
  });
});
