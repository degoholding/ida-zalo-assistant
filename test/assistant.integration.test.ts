// Tin riêng 1-1, Danh bạ, công cụ AI và vòng hỏi đáp — chạy trên MySQL THẬT, mô hình AI là bản giả
// có kịch bản (không gọi Gemini, không tốn tiền).
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { AssistantService, splitForZalo, stripMarkdown } from "../src/assistant/assistant-service.js";
import { WebSearchUnavailableError, type GeminiContent, type ModelClient, type WebSearchResult } from "../src/assistant/gemini-client.js";
import { runTool, type ToolContext } from "../src/assistant/tools.js";
import { AssistantTurnStatus, ContactKind, ContactRole, ConversationType, GroupKind } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { findContactByUid, updateContact } from "../src/sync/contact-repository.js";
import { ensureGroup, updateGroupSettings } from "../src/sync/group-repository.js";
import { syncGroupMembers } from "../src/sync/member-sync.js";
import {
  ingestDirectMessage,
  ingestGroupMessage,
  recordOutgoingMessage,
  type IncomingGroupMessage,
} from "../src/sync/message-ingest.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["assistant_turn", "attachment", "message", "group_member", "bot_group", "zalo_group", "contact", "company",
  "session_event", "bot_account"];
const NOW = new Date("2026-10-01T05:00:00Z"); // 12:00 giờ Việt Nam

function message(overrides: Partial<IncomingGroupMessage>): IncomingGroupMessage {
  return {
    zaloGroupId: "g-ban-hang", msgId: "1", cliMsgId: "", msgType: "webchat", senderUid: "u-lan", senderName: "Chị Lan",
    sentAtMs: NOW.getTime() - 3_600_000, content: "Báo giá gửi khách chưa?", quote: null, mentions: null, ...overrides,
  };
}

/** Mô hình giả: trả lần lượt các lượt đã soạn, ghi lại mọi yêu cầu nhận được. */
class ScriptedModel implements ModelClient {
  readonly requests: { contents: GeminiContent[]; toolCount: number }[] = [];
  constructor(private readonly turns: GeminiContent["parts"][]) {}
  async generate(request: { system: string; contents: GeminiContent[]; tools: unknown[] }) {
    this.requests.push({ contents: structuredClone(request.contents), toolCount: request.tools.length });
    const parts = this.turns.shift();
    if (!parts) throw new Error("hết kịch bản");
    return { content: { role: "model" as const, parts }, inputTokens: 1000, outputTokens: 200 };
  }
}

describe("tin riêng + Danh bạ + trợ lý", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let botId: number;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => {
    await db?.end();
  });
  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    const [result] = await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    botId = result.insertId;
  });

  async function seedGroup() {
    const { group } = await ensureGroup(db, "g-ban-hang", { readMessages: true, captureFiles: true });
    await db.query("UPDATE zalo_group SET name = 'Bán hàng miền Nam', label = 'bán hàng' WHERE id = ?", [group.id]);
    return group;
  }

  test("tin riêng của người lạ: lưu tin, vào Danh bạ (role 0), mặc định CÓ lưu", async () => {
    const deps = { db, defaults: { readMessages: false, captureFiles: false } };
    const result = await ingestDirectMessage(deps, botId, message({ zaloGroupId: "u-khach", senderUid: "u-khach", senderName: "Anh Khách", content: "Cho hỏi giá" }));
    assert.equal(result.outcome, "stored");
    assert.equal(result.contact.role, ContactRole.None);
    // Chỉ nhắn riêng, không ở nhóm nào → mặc định Khách hàng (tự động)
    assert.equal(result.contact.kind, ContactKind.Customer);
    assert.equal(result.thread.thread_type, ConversationType.Direct);
    assert.equal(result.thread.owner_bot_id, botId);
    const contact = await findContactByUid(db, "u-khach");
    assert.equal(contact?.display_name, "Anh Khách");
    const [rows] = await db.query<RowDataPacket[]>("SELECT dm_count FROM contact WHERE zalo_uid = 'u-khach'");
    assert.equal(rows[0].dm_count, 1);
    // Bù tin lỡ khi kết nối lại gửi lại đúng tin đó: không lưu lần hai, KHÔNG cộng dôi số tin
    const again = await ingestDirectMessage(deps, botId, message({ zaloGroupId: "u-khach", senderUid: "u-khach", senderName: "Anh Khách", content: "Cho hỏi giá" }));
    assert.equal(again.outcome, "duplicate");
    const [after] = await db.query<RowDataPacket[]>("SELECT dm_count FROM contact WHERE zalo_uid = 'u-khach'");
    assert.equal(after[0].dm_count, 1);
  });

  test("cùng mã Zalo ở nhóm và tin riêng KHÔNG đụng nhau: một nhóm, một cuộc riêng", async () => {
    await seedGroup();
    const deps = { db, defaults: { readMessages: false, captureFiles: false } };
    // Trùng chuỗi mã với mã nhóm — khóa (loại, mã, bot) phải tách được
    await ingestDirectMessage(deps, botId, message({ zaloGroupId: "g-ban-hang", senderUid: "g-ban-hang", msgId: "d1" }));
    const [rows] = await db.query<RowDataPacket[]>("SELECT thread_type FROM zalo_group WHERE zalo_group_id = 'g-ban-hang' ORDER BY thread_type");
    assert.deepEqual(rows.map((row) => row.thread_type), [ConversationType.Direct, ConversationType.Group]);
  });

  test("đồng bộ thành viên nhóm đổ vào Danh bạ, không ghi đè vai trò đã gán", async () => {
    const group = await seedGroup();
    await ingestDirectMessage({ db, defaults: { readMessages: false, captureFiles: false } }, botId,
      message({ zaloGroupId: "u-lan", senderUid: "u-lan", msgId: "d1" }));
    const lan = await findContactByUid(db, "u-lan");
    await updateContact(db, lan!.id, { kind: 2, role: ContactRole.Manager, companyId: null, note: "0909" });
    await syncGroupMembers(db, {
      getGroupInfo: async () => ({ gridInfoMap: { "g-ban-hang": { name: "Bán hàng", totalMember: 2, memVerList: ["u-lan_1", "u-binh_1"],
        currentMems: [{ id: "u-lan", dName: "Lan KD", zaloName: "Nguyễn Lan" }, { id: "u-binh", dName: "Anh Bình", zaloName: "Trần Bình" }] } } }),
      getGroupMembersInfo: async () => ({ profiles: {} }),
    }, group.id, "g-ban-hang");
    const after = await findContactByUid(db, "u-lan");
    assert.equal(after?.role, ContactRole.Manager);
    assert.equal(after?.zalo_name, "Nguyễn Lan");
    assert.equal((await findContactByUid(db, "u-binh"))?.display_name, "Anh Bình");
  });

  test("loại người theo loại nhóm: khách hàng mặc định, nhóm nội bộ → nhân sự, chỉnh tay thì giữ", async () => {
    const customerGroup = await seedGroup();
    const { group: internalGroup } = await ensureGroup(db, "g-noi-bo", { readMessages: true, captureFiles: false });
    const source = (groupId: string, uids: string[]) => ({
      getGroupInfo: async () => ({ gridInfoMap: { [groupId]: { name: groupId, totalMember: uids.length, memVerList: uids.map((uid) => `${uid}_1`),
        currentMems: uids.map((uid) => ({ id: uid, dName: uid, zaloName: uid })) } } }),
      getGroupMembersInfo: async () => ({ profiles: {} }),
    });
    const kindOf = async (uid: string) => (await findContactByUid(db, uid))?.kind;

    // Nhóm mới mặc định là nhóm khách hàng → mọi thành viên là Khách hàng
    await syncGroupMembers(db, source("g-ban-hang", ["u-khach", "u-sale"]), customerGroup.id, "g-ban-hang");
    assert.equal(await kindOf("u-khach"), ContactKind.Customer);
    assert.equal(await kindOf("u-sale"), ContactKind.Customer);

    // Nhân viên sale cũng ở nhóm nội bộ → Nhân sự (nội bộ thắng), khách vẫn là khách
    await updateGroupSettings(db, internalGroup.id, { groupKind: GroupKind.Internal });
    await syncGroupMembers(db, source("g-noi-bo", ["u-sale", "u-ketoan"]), internalGroup.id, "g-noi-bo");
    assert.equal(await kindOf("u-sale"), ContactKind.Staff);
    assert.equal(await kindOf("u-ketoan"), ContactKind.Staff);
    assert.equal(await kindOf("u-khach"), ContactKind.Customer);

    // Đổi nhóm nội bộ về nhóm khách hàng → thành viên tự đổi theo
    await updateGroupSettings(db, internalGroup.id, { groupKind: GroupKind.Customer });
    assert.equal(await kindOf("u-ketoan"), ContactKind.Customer);
    await updateGroupSettings(db, internalGroup.id, { groupKind: GroupKind.Internal });

    // Chỉnh tay: khách này thật ra là nhân sự → tự động không ghi đè nữa
    const khach = (await findContactByUid(db, "u-khach"))!;
    await updateContact(db, khach.id, { kind: ContactKind.Staff, role: 0, companyId: null, note: "" });
    await syncGroupMembers(db, source("g-ban-hang", ["u-khach", "u-sale"]), customerGroup.id, "g-ban-hang");
    assert.equal(await kindOf("u-khach"), ContactKind.Staff);
    // Trả về tự động → suy lại theo nhóm
    await updateContact(db, khach.id, { kind: "auto", role: 0, companyId: null, note: "" });
    assert.equal(await kindOf("u-khach"), ContactKind.Customer);

    // Chỉ đổi vai trò (loại giữ nguyên) KHÔNG biến thành "chỉnh tay"
    const sale = (await findContactByUid(db, "u-sale"))!;
    await updateContact(db, sale.id, { kind: ContactKind.Staff, role: ContactRole.Manager, companyId: null, note: "" });
    const [rows] = await db.query<RowDataPacket[]>("SELECT kind_source FROM contact WHERE zalo_uid = 'u-sale'");
    assert.equal(rows[0].kind_source, 0);
  });

  test("công cụ: tóm nhóm theo khoảng giờ, tìm người không dấu, tìm tệp nhiều từ khóa", async () => {
    const group = await seedGroup();
    const deps = { db, defaults: { readMessages: false, captureFiles: false } };
    await ingestGroupMessage(deps, botId, message({ msgId: "1" }));
    await ingestGroupMessage(deps, botId, message({ msgId: "2", senderUid: "u-binh", senderName: "Anh Bình", content: "Chiều nay gửi",
      sentAtMs: NOW.getTime() - 1_800_000, quote: { globalMsgId: 1, msg: "Báo giá gửi khách chưa?" } }));
    await ingestGroupMessage(deps, botId, message({ msgId: "3", msgType: "share.file", senderUid: "u-binh", senderName: "Anh Bình",
      content: { title: "Báo giá DL Thành Công.xlsx", href: "https://f/x", params: "{}" }, sentAtMs: NOW.getTime() - 600_000 }));
    await ingestGroupMessage(deps, botId, message({ msgId: "old", content: "tin hôm qua", sentAtMs: NOW.getTime() - 30 * 3_600_000 }));
    await db.query("INSERT INTO contact (zalo_uid, display_name) VALUES ('u-hoa', 'Chị Hòa')");
    const context: ToolContext = { db, askerUid: "u-lan", filesToSend: [], now: NOW };

    const groups = await runTool(context, "list_groups", { query: "ban hang" }) as any;
    assert.equal(groups.groups[0].id, group.id);

    const today = await runTool(context, "get_group_messages",
      { group_id: group.id, from: "2026-10-01T00:00:00+07:00", to: "2026-10-01T23:59:59+07:00" }) as any;
    assert.equal(today.message_count, 3);
    assert.match(today.messages, /\[01\/10 11:00\] Chị Lan: Báo giá gửi khách chưa\?/);
    assert.match(today.messages, /Anh Bình: \[trả lời: "Báo giá gửi khách chưa\?"\] Chiều nay gửi/);
    assert.doesNotMatch(today.messages, /tin hôm qua/);

    const people = await runTool(context, "find_people", { name: "hoa" }) as any;
    assert.equal(people.people[0].uid, "u-hoa");

    const files = await runTool(context, "search_files", { query: "bao gia thanh cong" }) as any;
    assert.equal(files.files.length, 1);
    assert.equal(files.files[0].can_send, false); // chưa tải về kho
    const send = await runTool(context, "send_file", { attachment_id: files.files[0].id }) as any;
    assert.match(send.error, /chưa có trong kho/);

    const unknown = await runTool(context, "get_group_messages", { group_id: 9999, from: "x", to: "y" }) as any;
    assert.match(unknown.error, /Không có nhóm/);
  });

  test("trao đổi với một người: tin của họ + tin nhắc tên họ + tin riêng giữa họ và bot", async () => {
    await seedGroup();
    const deps = { db, defaults: { readMessages: false, captureFiles: false } };
    await ingestGroupMessage(deps, botId, message({ msgId: "1", senderUid: "u-binh", senderName: "Anh Bình", content: "Em gửi báo cáo rồi" }));
    await ingestGroupMessage(deps, botId, message({ msgId: "2", senderUid: "u-sep", senderName: "Sếp", content: "@Bình làm tiếp nhé",
      mentions: [{ uid: "u-binh", pos: 0, len: 6 }] }));
    await ingestGroupMessage(deps, botId, message({ msgId: "3", senderUid: "u-khac", senderName: "Người khác", content: "không liên quan" }));
    await ingestDirectMessage(deps, botId, message({ zaloGroupId: "u-binh", senderUid: "u-binh", senderName: "Anh Bình", msgId: "d1", content: "Bot ơi" }));
    // Người hỏi là người THỨ BA — tin "@Bình" của Sếp chỉ lọt qua đúng điều kiện "nhắc tên"
    const result = await runTool({ db, askerUid: "u-lan", filesToSend: [], now: NOW }, "get_conversation_with_person",
      { person_uid: "u-binh", from: "2026-10-01T00:00:00+07:00", to: "2026-10-02T00:00:00+07:00" }) as any;
    assert.equal(result.message_count, 3);
    assert.match(result.messages, /Em gửi báo cáo rồi/);
    assert.match(result.messages, /@Bình làm tiếp nhé/);
    assert.match(result.messages, /\(nhắn riêng bot\) Anh Bình:\s+Bot ơi/);
    assert.doesNotMatch(result.messages, /không liên quan/);
  });

  test("vòng hỏi đáp: gọi công cụ → trả lời; lịch sử cuộc riêng đưa vào; gỡ markdown; ghi nhật ký", async () => {
    const group = await seedGroup();
    const deps = { db, defaults: { readMessages: false, captureFiles: false } };
    await ingestGroupMessage(deps, botId, message({ msgId: "1" }));
    const asked = await ingestDirectMessage(deps, botId, message({ zaloGroupId: "u-sep", senderUid: "u-sep", senderName: "Sếp", msgId: "q0", content: "Chào bot" }));
    await recordOutgoingMessage(db, asked.thread, { uid: "u-bot", name: "Bot" }, "a0", "Chào anh");
    const question = await ingestDirectMessage(deps, botId, message({ zaloGroupId: "u-sep", senderUid: "u-sep", senderName: "Sếp", msgId: "q1", content: "Tóm tắt nhóm bán hàng hôm nay" }));
    await updateContact(db, question.contact.id, { kind: 2, role: ContactRole.Manager, companyId: null, note: "" });
    const contact = (await findContactByUid(db, "u-sep"))!;

    const model = new ScriptedModel([
      [{ functionCall: { name: "get_group_messages", args: { group_id: group.id, from: "2026-10-01T00:00:00+07:00", to: "2026-10-01T23:59:59+07:00" } } }],
      [{ text: "**Nhóm bán hàng hôm nay**\n* Chị Lan hỏi báo giá" }],
    ]);
    const service = new AssistantService(db, model, "gia-lap", { maxPerHour: 30, dailyTokenCap: 1_000_000 }, () => NOW);
    const reply = await service.answer({ botAccountId: botId, contact, threadId: question.thread.id, questionMessageId: question.messageId, question: "Tóm tắt nhóm bán hàng hôm nay" });

    assert.equal(reply.status, AssistantTurnStatus.Answered);
    assert.equal(reply.text, "Nhóm bán hàng hôm nay\n- Chị Lan hỏi báo giá");
    // Lượt 1: lịch sử (Chào bot / Chào anh) + câu hỏi; lượt 2: có kết quả công cụ chứa tin nhóm
    const first = model.requests[0].contents;
    assert.equal(first[0].parts[0].text, "Chào bot");
    assert.equal(first[1].role, "model");
    assert.equal(first[2].parts[0].text, "Tóm tắt nhóm bán hàng hôm nay");
    const toolResult = JSON.stringify(model.requests[1].contents.at(-1));
    assert.match(toolResult, /Báo giá gửi khách chưa/);
    const [turns] = await db.query<RowDataPacket[]>("SELECT status, input_tokens, output_tokens, tool_calls FROM assistant_turn");
    assert.equal(turns.length, 1);
    assert.equal(turns[0].input_tokens, 2000);
    assert.equal(turns[0].tool_calls[0].name, "get_group_messages");
  });

  test("tìm web: kết quả + nguồn đưa cho mô hình, token lượt tìm cộng vào nhật ký; chưa bật thì báo rõ", async () => {
    const asked = await ingestDirectMessage({ db, defaults: { readMessages: false, captureFiles: false } }, botId,
      message({ zaloGroupId: "u-sep", senderUid: "u-sep", senderName: "Sếp", msgId: "q1", content: "giá xăng hôm nay" }));
    const contact = (await findContactByUid(db, "u-sep"))!;
    const request = { botAccountId: botId, contact, threadId: asked.thread.id, questionMessageId: asked.messageId, question: "giá xăng hôm nay" };

    const model = new ScriptedModel([
      [{ functionCall: { name: "web_search", args: { query: "giá xăng RON95 hôm nay" } } }],
      [{ text: "Xăng RON95 giá 23.000đ/lít (nguồn: Petrolimex)" }],
    ]) as ScriptedModel & { searchWeb: (query: string) => Promise<WebSearchResult> };
    const queries: string[] = [];
    model.searchWeb = async (query) => {
      queries.push(query);
      return { text: "RON95: 23.000đ/lít", sources: [{ title: "Petrolimex", url: "https://x" }], inputTokens: 300, outputTokens: 50 };
    };
    const service = new AssistantService(db, model, "gia-lap", { maxPerHour: 30, dailyTokenCap: 1_000_000 }, () => NOW);
    const reply = await service.answer(request);
    assert.equal(reply.status, AssistantTurnStatus.Answered);
    assert.deepEqual(queries, ["giá xăng RON95 hôm nay"]);
    assert.ok(model.requests[0].toolCount >= 7); // 6 công cụ dữ liệu + web_search
    assert.match(JSON.stringify(model.requests[1].contents.at(-1)), /Petrolimex/);
    const [turns] = await db.query<RowDataPacket[]>("SELECT input_tokens, output_tokens FROM assistant_turn ORDER BY id DESC LIMIT 1");
    assert.equal(turns[0].input_tokens, 2000 + 300);
    assert.equal(turns[0].output_tokens, 400 + 50);

    const blocked = new ScriptedModel([
      [{ functionCall: { name: "web_search", args: { query: "giá vàng" } } }],
      [{ text: "Tìm web chưa bật" }],
    ]) as ScriptedModel & { searchWeb: (query: string) => Promise<WebSearchResult> };
    blocked.searchWeb = async () => { throw new WebSearchUnavailableError("429"); };
    await new AssistantService(db, blocked, "gia-lap", { maxPerHour: 30, dailyTokenCap: 1_000_000 }, () => NOW).answer(request);
    assert.match(JSON.stringify(blocked.requests[1].contents.at(-1)), /CHƯA BẬT.*bật thanh toán/);
  });

  test("giới hạn: quá số câu/giờ thì báo MỘT lần rồi im; chạm trần token ngày thì nghỉ", async () => {
    const asked = await ingestDirectMessage({ db, defaults: { readMessages: false, captureFiles: false } }, botId,
      message({ zaloGroupId: "u-sep", senderUid: "u-sep", senderName: "Sếp", msgId: "q1", content: "hỏi" }));
    await updateContact(db, asked.contact.id, { kind: 2, role: ContactRole.Manager, companyId: null, note: "" });
    const contact = (await findContactByUid(db, "u-sep"))!;
    const request = { botAccountId: botId, contact, threadId: asked.thread.id, questionMessageId: asked.messageId, question: "hỏi" };

    const limited = new AssistantService(db, new ScriptedModel([[{ text: "ok" }]]), "gia-lap", { maxPerHour: 1, dailyTokenCap: 1_000_000 }, () => NOW);
    assert.equal((await limited.answer(request)).status, AssistantTurnStatus.Answered);
    const second = await limited.answer(request);
    assert.equal(second.status, AssistantTurnStatus.RateLimited);
    assert.match(second.text ?? "", /hỏi hơi nhiều/);
    const third = await limited.answer(request);
    assert.equal(third.status, AssistantTurnStatus.RateLimited);
    assert.equal(third.text, null);

    const capped = new AssistantService(db, new ScriptedModel([]), "gia-lap", { maxPerHour: 100, dailyTokenCap: 1000 }, () => NOW);
    const capReply = await capped.answer(request);
    assert.equal(capReply.status, AssistantTurnStatus.DailyCapReached);
    assert.match(capReply.text ?? "", /hết hạn mức/);
    assert.equal((await capped.answer(request)).text, null);
  });

  test("mô hình lỗi: trả câu xin lỗi, ghi nhật ký Failed kèm lỗi", async () => {
    const asked = await ingestDirectMessage({ db, defaults: { readMessages: false, captureFiles: false } }, botId,
      message({ zaloGroupId: "u-sep", senderUid: "u-sep", senderName: "Sếp", msgId: "q1", content: "hỏi" }));
    const contact = (await findContactByUid(db, "u-sep"))!;
    const service = new AssistantService(db, new ScriptedModel([]), "gia-lap", { maxPerHour: 30, dailyTokenCap: 1_000_000 }, () => NOW);
    const reply = await service.answer({ botAccountId: botId, contact, threadId: asked.thread.id, questionMessageId: asked.messageId, question: "hỏi" });
    assert.equal(reply.status, AssistantTurnStatus.Failed);
    assert.match(reply.text ?? "", /Xin lỗi/);
    const [turns] = await db.query<RowDataPacket[]>("SELECT error FROM assistant_turn");
    assert.match(turns[0].error, /hết kịch bản/);
  });
});

test("chia tin dài cho Zalo ở chỗ xuống dòng; gỡ markdown", () => {
  const long = Array.from({ length: 50 }, (_, i) => `Dòng ${i} ${"x".repeat(60)}`).join("\n");
  const chunks = splitForZalo(long, 1000);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1000));
  assert.equal(chunks.join("\n"), long);
  assert.equal(stripMarkdown("## Tiêu đề\n**đậm** và `mã`"), "Tiêu đề\nđậm và mã");
});
