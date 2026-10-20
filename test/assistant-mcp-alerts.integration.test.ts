// Phase 10 — họ `alerts` qua MCP trong tiến trình. MySQL thật. TEST VÀNG: tin cần xử lý, «xong tin số», lệnh gõ cảnh báo (cấu hình, từ khóa, phút chờ, VIP,
// «đồng ý» / «hủy») so ĐƯỜNG CŨ (alert-tools-legacy + alert-chat-commands-legacy, kho đề xuất trong RAM) với đường MCP (công cụ mặt `assistant_command` /
// `assistant_model`, nháp `mcp_write_draft`): cùng câu trả lời từng ký tự, cùng `settings` được lưu, cùng `audit_log`, cùng VIP / tin đã xử lý.
// Cộng: đề xuất qua «khởi động lại» vẫn lưu (cũ: mất), mô hình không có đường xác nhận, cổng /mcp ngoài không thấy công cụ cảnh báo, thiếu móc ⇒ đường cũ.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_p10 npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { alertPendingProvider, runAlertChatCommand } from "../src/assistant/alert-chat-commands.js";
import { alertPendingProviderLegacy, runAlertChatCommandLegacy } from "../src/assistant/alert-chat-commands-legacy.js";
import {
  alertRuntimeFromDeps, alertToolDeclarations, clearPendingAlertChanges, resolveAlertAsker, runAlertTool, type AlertAsker, type AlertToolsDeps,
} from "../src/assistant/alert-tools.js";
import { AssistantService } from "../src/assistant/assistant-service.js";
import { runPlainConfirmCancel } from "../src/assistant/chat-confirm-router.js";
import { parseChatCommand } from "../src/assistant/chat-command-parser.js";
import type { ChatCommandContext } from "../src/assistant/chat-commands.js";
import type { GeminiContent, ModelClient } from "../src/assistant/gemini-client.js";
import { resolveAskerAccess, type AskerAccess } from "../src/assistant/infra/asker-access.js";
import type { AssistantMcpBridge } from "../src/assistant/mcp-bridge/assistant-mcp-bridge-config.js";
import { parseMcpFamilies } from "../src/assistant/mcp-bridge/assistant-mcp-families.js";
import type { AssistantMcpTurn } from "../src/assistant/mcp-bridge/assistant-mcp-turn.js";
import { openMcpTurn } from "../src/assistant/mcp-bridge/open-mcp-turn.js";
import type { AppConfig } from "../src/config.js";
import { ContactRole, ConversationType, MessagePriority, ReplyState, UserRole } from "../src/constants.js";
import type { AlertRuntime } from "../src/data-access/alerts/alert-asker-facts.js";
import { ALL_TOOLS, toolsFor } from "../src/data-access/read-tool-catalog.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { ConcurrencyGate } from "../src/mcp/mcp-concurrency-gate.js";
import { findContactByUid } from "../src/sync/contact-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
// Giờ thật (tròn phút): nháp hết hạn theo đồng hồ thật ở vài nhánh — giờ cứng sẽ thành «bom hẹn giờ» sau 10–15 phút
const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000);
const TABLES = ["mcp_call_log", "mcp_write_draft", "assistant_turn", "message_flag", "job", "recipient_vip", "recipient_group", "recipient", "attachment", "message",
  "group_member", "bot_group", "zalo_group", "contact_tag", "contact", "company", "session_event", "bot_account", "user_group_scope", "app_user", "audit_log"];

type Parts = GeminiContent["parts"];
class ScriptedModel implements ModelClient {
  readonly requests: { contents: GeminiContent[]; tools: { name: string }[] }[] = [];
  constructor(private readonly turns: Parts[]) {}
  async generate(request: { contents: GeminiContent[]; tools: { name: string }[] }) {
    this.requests.push({ contents: structuredClone(request.contents), tools: structuredClone(request.tools) });
    const turn = this.turns.shift();
    if (!turn) throw new Error("hết kịch bản");
    return { content: { role: "model" as const, parts: turn }, inputTokens: 10, outputTokens: 5 };
  }
}
const call = (name: string, args: Record<string, unknown>) => ({ functionCall: { name, args } });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("họ alerts qua MCP (phase 10)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let dmThread = 0;
  let groupA = 0;
  let groupB = 0;
  let secretGroup = 0;
  let saved: Record<string, unknown>[] = [];
  let invalidated = 0;
  let config: AppConfig;
  let deps: AlertToolsDeps;
  const bridge: AssistantMcpBridge = { families: () => parseMcpFamilies("alerts"), gate: new ConcurrencyGate(5, 20_000) };
  const uids = { ceo: "u-ceo", tp: "u-tp", nv: "u-nv", stranger: "u-str", disabled: "u-dis", web: "u-web" } as const;
  type Who = keyof typeof uids;
  const msg: Record<string, number> = {};

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });

  const insertId = async (sql: string, params: unknown[] = []): Promise<number> => ((await db.query<any>(sql, params))[0] as any).insertId as number;
  const rows = async (sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0];

  async function addMessage(name: string, groupId: number, flag: { priority: number; state: number; hoursAgo?: number; forUid?: string | null; pendingAi?: number; dueAt?: Date | null }) {
    // Mỗi tin lệch một phút: câu cũ xếp theo (mức khẩn, giờ gửi) — trùng giờ thì thứ tự do MySQL tự chọn
    const sentAt = new Date(NOW.getTime() - (flag.hoursAgo ?? 1) * 3_600_000 - Object.keys(msg).length * 60_000);
    const id = await insertId("INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text) VALUES (?, ?, 0, 'u-khach', 'Khách A', ?, ?)",
      [groupId, `m-${name}`, sentAt, `tin ${name} cần gấp   xử lý`]);
    await db.query("INSERT INTO message_flag (message_id, group_id, priority, reply_state, reason, due_at, for_uid, pending_ai) VALUES (?, ?, ?, ?, 'từ khóa', ?, ?, ?)",
      [id, groupId, flag.priority, flag.state, flag.dueAt ?? null, flag.forUid ?? null, flag.pendingAi ?? 0]);
    msg[name] = id;
  }

  async function seed() {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    saved = [];
    invalidated = 0;
    clearPendingAlertChanges();
    await insertId("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    const group = (zaloId: string, name: string, type: number, secret = 0) =>
      insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages, is_confidential) VALUES (?, ?, ?, 1, ?)", [type, zaloId, name, secret]);
    dmThread = await group("u-ceo", "Tin riêng", ConversationType.Direct);
    groupA = await group("g-a", "Bán hàng A", ConversationType.Group);
    groupB = await group("g-b", "Đại lý B", ConversationType.Group);
    secretGroup = await group("g-s", "Ban giám đốc", ConversationType.Group, 1);
    const contact = (uid: string, name: string, role: number, kind = 2) => insertId("INSERT INTO contact (zalo_uid, display_name, role, kind) VALUES (?, ?, ?, ?)", [uid, name, role, kind]);
    const ids = {
      ceo: await contact(uids.ceo, "CEO", ContactRole.Manager), tp: await contact(uids.tp, "Trưởng phòng", ContactRole.DepartmentHead),
      nv: await contact(uids.nv, "Nhân viên", ContactRole.None), stranger: await contact(uids.stranger, "Khách lạ", ContactRole.None, 1),
      disabled: await contact(uids.disabled, "Đã tắt", ContactRole.Manager), web: await contact(uids.web, "Web Minh", ContactRole.DepartmentHead),
      vip: await contact("u-vip", "Đại lý VIP", ContactRole.None, 1),
    };
    await contact("u-np1", "Nguyễn Phát", ContactRole.None, 1);
    await contact("u-np2", "Trần Phát", ContactRole.None, 1);
    // CEO: chỉ nhóm A. Trưởng phòng + nhân viên (không vai trò): mọi nhóm. Trưởng phòng có VIP u-vip.
    const ceoRecipient = await insertId("INSERT INTO recipient (contact_id, name, rank_order, all_groups) VALUES (?, 'CEO', 1, 0)", [ids.ceo]);
    await db.query("INSERT INTO recipient_group (recipient_id, group_id) VALUES (?, ?)", [ceoRecipient, groupA]);
    const tpRecipient = await insertId("INSERT INTO recipient (contact_id, name, rank_order, all_groups) VALUES (?, 'Trưởng phòng', 2, 1)", [ids.tp]);
    await db.query("INSERT INTO recipient_vip (recipient_id, contact_id) VALUES (?, ?)", [tpRecipient, ids.vip]);
    await insertId("INSERT INTO recipient (contact_id, name, rank_order, all_groups) VALUES (?, 'Nhân viên', 3, 1)", [ids.nv]);
    const account = (name: string, contactId: number, active: number) => db.query(
      "INSERT INTO app_user (email, username, full_name, role, contact_id, all_groups, can_view_confidential, is_active) VALUES (?, ?, ?, ?, ?, 1, 0, ?)", [`${name}@x.vn`, name, name, UserRole.Manager, contactId, active]);
    await account("dis", ids.disabled, 0);
    await account("web", ids.web, 1);
    const past = new Date(NOW.getTime() - 3_600_000);
    await addMessage("urgentA", groupA, { priority: MessagePriority.Urgent, state: ReplyState.Waiting });
    await addMessage("waitB", groupB, { priority: MessagePriority.Normal, state: ReplyState.Waiting, dueAt: past });
    await addMessage("urgentSecret", secretGroup, { priority: MessagePriority.Urgent, state: ReplyState.Waiting });
    await addMessage("urgentForTp", groupA, { priority: MessagePriority.Urgent, state: ReplyState.Waiting, forUid: uids.tp });
    await addMessage("handled", groupA, { priority: MessagePriority.Urgent, state: ReplyState.Handled });
    await addMessage("oldUrgent", groupA, { priority: MessagePriority.Urgent, state: ReplyState.NotNeeded, hoursAgo: 72 });
    await addMessage("seenA", groupA, { priority: MessagePriority.Normal, state: ReplyState.Seen });
    await addMessage("pendingAi", groupA, { priority: MessagePriority.Urgent, state: ReplyState.Waiting, pendingAi: 1 });
    await addMessage("urgentB", groupB, { priority: MessagePriority.Urgent, state: ReplyState.Waiting, hoursAgo: 2 });
  }

  beforeEach(async () => {
    await seed();
    config = {
      alerts: { enabled: true, aiEnabled: false, urgentKeywords: "gấp, khẩn", importantKeywords: "báo giá", strictKeywords: "la, ngay", replyWaitMinutes: 120, vipWaitMinutes: 30,
        dailyReminderCap: 3, urgentMergeSeconds: 30, telegramBotToken: "", telegramChatId: "" },
      calendar: { workHours: "08:30-17:30", quietHours: "21:00-06:30" },
    } as unknown as AppConfig;
    deps = { db, config, saveSettings: async (patch) => { saved.push(json(patch)); return Object.keys(patch); }, invalidate: () => { invalidated += 1; } };
  });

  const runtime = (): AlertRuntime => alertRuntimeFromDeps(deps);

  /** Ngữ cảnh truy cập thật của người hỏi (tin riêng); `withRuntime` = giả lập nơi dựng ctx đã gắn móc họ `alerts`. */
  async function accessOf(who: Who, withRuntime = true, now = NOW): Promise<AskerAccess> {
    const contact = (await findContactByUid(db, uids[who]))!;
    const access = await resolveAskerAccess(db, contact, { maskPersonal: false, now, turn: { threadId: dmThread, messageId: null, botAccountId: 1 }, saveSettings: deps.saveSettings });
    const enriched: AskerAccess & { alertRuntime?: AlertRuntime } = withRuntime ? { ...access, alertRuntime: runtime() } : access;
    return enriched;
  }
  const askerOf = async (who: Who): Promise<AlertAsker | null> => resolveAlertAsker(db, (await findContactByUid(db, uids[who]))!);

  const turns: AssistantMcpTurn[] = [];
  const openTurn = (access: AskerAccess) => {
    const turn = openMcpTurn(access, bridge)!;
    turns.push(turn);
    return turn;
  };
  after(async () => { for (const turn of turns) await turn.close(); });

  const structured = async (turn: AssistantMcpTurn, surface: "assistant_model" | "assistant_command", name: string, args: Record<string, unknown>) => {
    const result = await turn.callTool(surface, name, args);
    return { isError: Boolean(result.isError), data: json(result.structuredContent ?? null) as any, error: (result._meta as any)?.["bot-tro-ly/error"] as { code: string; message: string } | undefined };
  };

  // ------------------------------------------------------------------ tin cần xử lý + xong tin số
  test("tin cần xử lý: kết quả lõi (cả hai mặt) == đường cũ từng ký tự cho mọi người hỏi + limit", async () => {
    for (const who of ["ceo", "tp", "nv", "web"] as const) {
      const asker = (await askerOf(who))!;
      assert.ok(asker, who);
      for (const args of [{}, { limit: 1 }, { limit: 99 }]) {
        const old = json(await runAlertTool(deps, asker, "list_pending_items", args, NOW, Date.now(), await accessOf(who, false)));
        const turn = openTurn(await accessOf(who));
        const viaCommand = await structured(turn, "assistant_command", "alert_pending_list", args);
        const viaModel = await structured(turn, "assistant_model", "list_pending_items", args);
        assert.deepEqual(viaCommand.data, old, `${who} ${JSON.stringify(args)}`);
        assert.deepEqual(viaModel.data, old, `${who} ${JSON.stringify(args)}`);
      }
    }
    // Phạm vi: CEO (chỉ nhóm A, không Mật) không thấy tin nhóm B / nhóm Mật; trưởng phòng thấy B nhưng không thấy nhóm Mật (không cờ Mật)
    const ceoTurn = openTurn(await accessOf("ceo"));
    const ceoItems = (await structured(ceoTurn, "assistant_command", "alert_pending_list", {})).data.items as { message_id: number }[];
    assert.deepEqual(ceoItems.map((item) => item.message_id), [msg.urgentA, msg.seenA].sort((a, b) => ceoItems.findIndex((i) => i.message_id === a) - ceoItems.findIndex((i) => i.message_id === b)));
    assert.ok(!ceoItems.some((item) => [msg.urgentSecret, msg.urgentB, msg.waitB, msg.urgentForTp, msg.handled, msg.oldUrgent, msg.pendingAi].includes(item.message_id)));
    const tpIds = ((await structured(openTurn(await accessOf("tp")), "assistant_command", "alert_pending_list", { limit: 30 })).data.items as { message_id: number }[]).map((item) => item.message_id);
    assert.ok(tpIds.includes(msg.urgentB) && tpIds.includes(msg.urgentForTp) && !tpIds.includes(msg.urgentSecret));
  });

  test("người không dùng được công cụ cảnh báo: người lạ → cùng câu từ chối (mặt mô hình), tài khoản tắt → không có công cụ", async () => {
    const strangerAsker = await askerOf("stranger");
    assert.equal(strangerAsker, null);
    const old = json(await runAlertTool(deps, undefined, "list_pending_items", {}, NOW, Date.now(), await accessOf("stranger", false)));
    const turn = openTurn(await accessOf("stranger"));
    const viaModel = await structured(turn, "assistant_model", "list_pending_items", {});
    assert.equal(viaModel.isError, true);
    assert.equal(viaModel.error?.message, (old as { error: string }).error);
    assert.equal(await askerOf("disabled"), null);
    const disabledSession = await openTurn(await accessOf("disabled")).command();
    assert.ok(!disabledSession?.toolNames.has("alert_pending_list"));
    assert.ok(!(await openTurn(await accessOf("disabled")).model())?.toolNames.has("list_pending_items"));
  });

  const flagState = async () => rows("SELECT message_id, reply_state, handled_by_uid, handled_at, handled_message_id FROM message_flag ORDER BY message_id");

  test("xong tin số: kết quả + trạng thái message_flag == đường cũ (trong phạm vi, ngoài phạm vi, nhóm Mật, không có cờ, id sai)", async () => {
    const targets = ["urgentA", "waitB", "urgentSecret", "handled", "seenA"].map((name) => msg[name]).concat([999_999, 0, -4]);
    for (const who of ["ceo", "tp", "nv", "web"] as const) {
      const asker = (await askerOf(who))!;
      for (const target of targets) {
        await seed();
        const old = json(await runAlertTool(deps, asker, "mark_item_handled", { message_id: target }, NOW, Date.now(), await accessOf(who, false)));
        const oldState = json(await flagState());
        await seed();
        // D-A (20/10/2026): mô hình chỉ ghi NGAY khi mã tin nằm trong chữ của chính người hỏi — ở đây người hỏi nêu «tin số <id>» (ma trận nháp: assistant-injection-guard-and-web-role)
        const access = await accessOf(who);
        const named = { ...access, contactActor: { ...access.contactActor!, facts: { ...access.contactActor!.facts, ownTurnTexts: async () => ({ asker: `xong tin số ${target}`, previousBotReply: "" }) } } };
        const turn = openTurn(named);
        const viaModel = await structured(turn, "assistant_model", "mark_item_handled", { message_id: target });
        const modelState = json(await flagState());
        const model = viaModel.isError ? { error: viaModel.error!.message } : viaModel.data;
        assert.deepEqual(model, old, `${who} #${target}`);
        assert.deepEqual(modelState, oldState, `${who} #${target}`);
        if (!viaModel.isError) {
          // Ghi NGAY (BC1 bỏ): không để lại nháp nào
          assert.equal((await rows("SELECT COUNT(*) AS n FROM mcp_write_draft"))[0].n, 0);
        }
      }
    }
  });

  // ------------------------------------------------------------------ lệnh gõ: vàng cũ / mới
  interface ScriptResult { replies: (string | null)[]; saved: Record<string, unknown>[]; audit: unknown[]; vips: unknown[]; flags: unknown[]; invalidated: number }

  /** Chạy một kịch bản các tin gõ của một người ở MỘT đường ("legacy" = RAM, "mcp" = nháp qua máy chủ MCP trong tiến trình). */
  async function runScript(mode: "legacy" | "mcp", who: Who, texts: string[], options: { withRuntime?: boolean; between?: () => void } = {}): Promise<ScriptResult & { calls: number }> {
    await seed();
    const asker = await askerOf(who);
    const access = await accessOf(who, mode === "mcp" && options.withRuntime !== false);
    let turn: AssistantMcpTurn | undefined;
    const mcp = mode === "mcp" ? async () => (turn ??= openTurn(access)) : undefined;
    const ctx: ChatCommandContext = { db, alertTools: deps, asker, inGroup: false, now: NOW, access: async () => access, mcp };
    const replies: (string | null)[] = [];
    for (const text of texts) {
      options.between?.();
      // Đường cũ so «đề xuất tạo TRƯỚC lượt xác nhận» bằng đồng hồ mili giây thật: hai tin liên tiếp trong cùng mili giây bị coi là cùng lượt
      await new Promise((resolve) => setTimeout(resolve, 5));
      const command = parseChatCommand(text);
      if (!command) { replies.push(null); continue; }
      if (command.kind === "confirm" || command.kind === "cancel") {
        replies.push(await runPlainConfirmCancel(ctx, command.kind, [mode === "legacy" ? alertPendingProviderLegacy : alertPendingProvider]));
      } else if (!asker) {
        replies.push("(không phải người dùng cảnh báo)");
      } else {
        replies.push(await (mode === "legacy" ? runAlertChatCommandLegacy : runAlertChatCommand)(ctx, command, asker, deps));
      }
    }
    return {
      replies, saved: json(saved), invalidated,
      audit: json(await rows("SELECT entity, entity_id, action, message, actor FROM audit_log WHERE entity <> 'setting' ORDER BY id")),
      vips: json(await rows("SELECT recipient_id, contact_id FROM recipient_vip ORDER BY recipient_id, contact_id")),
      flags: json(await flagState()),
      calls: Number((await rows("SELECT COUNT(*) AS n FROM mcp_call_log WHERE source = 3"))[0].n),
    };
  }

  const SCRIPTS: Record<string, { who: Who; texts: string[] }> = {
    ceo: { who: "ceo", texts: ["cấu hình", "cần xử lý", "xong 999999", "ok", "thêm từ khẩn Bể Bao", "đồng ý", "đồng ý", "phút chờ 90", "hủy", "phút chờ 3", "phút chờ vip 3000",
      "bỏ từ khẩn không có từ này", "bỏ từ khẩn gấp", "hủy", "thêm từ quan trọng Đơn Hàng Lớn", "ok", "thêm vip nguyen phat", "vip", "can xu ly"] },
    tp: { who: "tp", texts: ["cấu hình", "them vip phat", "thêm vip nguyen phat", "ok", "bỏ vip trần phát", "bỏ vip đại lý vip", "đồng ý", "thêm vip zzz", "thêm vip Đại lý VIP", "hủy",
      "phút chờ vip 20", "đồng ý", "cần xử lý"] },
    nv: { who: "nv", texts: ["thêm từ khẩn abc", "phút chờ 100", "cấu hình", "thêm vip nguyen phat", "đồng ý", "bỏ vip nguyen phat", "đồng ý", "cần xử lý"] },
    stranger: { who: "stranger", texts: ["cấu hình", "ok", "thêm từ khẩn abc", "hủy"] },
    web: { who: "web", texts: ["cấu hình", "cần xử lý", "thêm từ quan trọng khuyến mãi", "đồng ý", "thêm vip nguyen phat"] },
  };

  for (const [name, script] of Object.entries(SCRIPTS)) {
    test(`lệnh gõ (${name}): câu trả lời, settings, audit_log, VIP, tin đã xử lý — đường MCP == đường cũ`, async () => {
      const old = await runScript("legacy", script.who, script.texts);
      const next = await runScript("mcp", script.who, script.texts);
      assert.deepEqual(next.replies, old.replies);
      assert.deepEqual(next.saved, old.saved);
      assert.deepEqual(next.audit, old.audit);
      assert.deepEqual(next.vips, old.vips);
      assert.deepEqual(next.flags, old.flags);
      assert.equal(next.invalidated, old.invalidated);
      // Mỗi lệnh dùng công cụ lệnh của máy chủ trong tiến trình (nguồn 3) khi người hỏi là người dùng cảnh báo
      if (name !== "stranger") assert.ok(next.calls > 0, "không có lời gọi công cụ nào qua MCP");
    });
  }

  test("thiếu móc alertRuntime ở ngữ cảnh (chưa nối ở nơi dựng ctx) ⇒ lệnh gõ chạy đường cũ, không lời gọi công cụ nào", async () => {
    const texts = ["cấu hình", "cần xử lý", "thêm từ khẩn Bể Bao", "đồng ý"];
    const old = await runScript("legacy", "ceo", texts);
    const next = await runScript("mcp", "ceo", texts, { withRuntime: false });
    assert.deepEqual(next.replies, old.replies);
    assert.deepEqual(next.saved, old.saved);
    assert.equal(next.calls, 0);
  });

  // ------------------------------------------------------------------ nháp DB thay kho RAM
  test("đề xuất «phút chờ 120» sống qua khởi động lại: xóa RAM + dựng lại phiên, «đồng ý» vẫn lưu (đường cũ: mất)", async () => {
    const restart = () => clearPendingAlertChanges();
    const old = await runScript("legacy", "ceo", ["phút chờ 120", "đồng ý"], { between: () => undefined });
    assert.equal(old.saved.length, 1, "không khởi động lại thì đường cũ lưu được");
    // đường cũ: khởi động lại giữa hai tin → mất
    await seed();
    const asker = (await askerOf("ceo"))!;
    const legacyCtx: ChatCommandContext = { db, alertTools: deps, asker, inGroup: false, now: NOW, access: async () => accessOf("ceo", false) };
    assert.match(String(await runAlertChatCommandLegacy(legacyCtx, parseChatCommand("phút chờ 120")!, asker, deps)), /120 phút/);
    restart();
    assert.equal(await runPlainConfirmCancel(legacyCtx, "confirm", [alertPendingProviderLegacy]), null);
    assert.equal(saved.length, 0);
    // đường mới: nháp nằm trong DB
    await seed();
    const first = await accessOf("ceo");
    const ctxOf = (access: AskerAccess): ChatCommandContext => { let turn: AssistantMcpTurn | undefined; return { db, alertTools: deps, asker, inGroup: false, now: NOW, access: async () => access, mcp: async () => (turn ??= openTurn(access)) }; };
    assert.match(String(await runAlertChatCommand(ctxOf(first), parseChatCommand("phút chờ 120")!, asker, deps)), /Tin chờ trả lời chưa ai trả lời sau 120 phút/);
    restart();
    const reply = await runPlainConfirmCancel(ctxOf(await accessOf("ceo")), "confirm", [alertPendingProvider]);
    assert.match(String(reply), /Đã đổi: Tin chờ trả lời chưa ai trả lời sau 120 phút/);
    assert.deepEqual(saved, [{ alert_reply_wait_minutes: 120 }]);
    const [draft] = await rows("SELECT tool, source, contact_id, user_id, TIMESTAMPDIFF(MINUTE, created_at, expires_at) AS ttl, used_at FROM mcp_write_draft");
    assert.equal(draft.tool, "alert_config_change");
    assert.equal(draft.source, 2);
    assert.equal(draft.ttl, 15);
    assert.notEqual(draft.used_at, null);
    assert.equal(draft.user_id, null, "người nhận không có tài khoản web vẫn xác nhận được");
  });

  test("nháp hết hạn sau 15 phút; nháp của người này không xác nhận / hủy hộ được cho người kia", async () => {
    const asker = (await askerOf("ceo"))!;
    const access = await accessOf("ceo");
    let turn: AssistantMcpTurn | undefined;
    const ctx: ChatCommandContext = { db, alertTools: deps, asker, inGroup: false, now: NOW, access: async () => access, mcp: async () => (turn ??= openTurn(access)) };
    assert.match(String(await runAlertChatCommand(ctx, parseChatCommand("thêm từ khẩn abc")!, asker, deps)), /đồng ý/);
    // người khác (trưởng phòng) nhắn «đồng ý»: không có nháp của họ
    const tpAsker = (await askerOf("tp"))!;
    const tpAccess = await accessOf("tp");
    let tpTurn: AssistantMcpTurn | undefined;
    const tpCtx: ChatCommandContext = { db, alertTools: deps, asker: tpAsker, inGroup: false, now: NOW, access: async () => tpAccess, mcp: async () => (tpTurn ??= openTurn(tpAccess)) };
    assert.equal(await runPlainConfirmCancel(tpCtx, "confirm", [alertPendingProvider]), null);
    assert.equal(await runPlainConfirmCancel(tpCtx, "cancel", [alertPendingProvider]), null);
    assert.equal(saved.length, 0);
    // 16 phút sau: hết hạn
    const later = await accessOf("ceo", true, new Date(NOW.getTime() + 16 * 60_000));
    let laterTurn: AssistantMcpTurn | undefined;
    const laterCtx: ChatCommandContext = { db, alertTools: deps, asker, inGroup: false, now: later.now, access: async () => later, mcp: async () => (laterTurn ??= openTurn(later)) };
    assert.equal(await runPlainConfirmCancel(laterCtx, "confirm", [alertPendingProvider]), null);
    assert.equal(saved.length, 0);
  });

  test("hai đường cùng chờ: kho mới nhất thắng (RAM cũ vs nháp DB), «hủy» bỏ cả hai", async () => {
    const asker = (await askerOf("ceo"))!;
    const access = await accessOf("ceo");
    let turn: AssistantMcpTurn | undefined;
    const ctx: ChatCommandContext = { db, alertTools: deps, asker, inGroup: false, now: NOW, access: async () => access, mcp: async () => (turn ??= openTurn(access)) };
    // đề xuất cũ trong RAM (đường cũ) tạo TRƯỚC, nháp DB (lệnh mới) tạo SAU với giờ app trong quá khứ xa ⇒ RAM (Date.now) mới hơn
    await runAlertChatCommandLegacy(ctx, parseChatCommand("phút chờ 77")!, asker, deps);
    await runAlertChatCommand(ctx, parseChatCommand("phút chờ 88")!, asker, deps);
    assert.match(String(await runPlainConfirmCancel(ctx, "cancel", [alertPendingProvider])), /đã bỏ/);
    assert.equal(await runPlainConfirmCancel(ctx, "confirm", [alertPendingProvider]), null, "hủy bỏ cả RAM lẫn nháp DB");
    assert.equal(saved.length, 0);
  });

  // ------------------------------------------------------------------ mô hình
  async function modelTurn(who: Who, question: string, script: Parts[]) {
    const model = new ScriptedModel(script);
    const service = new AssistantService(db, model, "gia-lap", { maxPerHour: 100, dailyTokenCap: 10_000_000 }, () => NOW, { alertTools: deps, mcpBridge: bridge });
    const contact = (await findContactByUid(db, uids[who]))!;
    // Tin hỏi được lưu như thật: chốt chặn D-A đọc chữ CỦA CHÍNH người hỏi từ đây
    const questionMessageId = await insertId("INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text) VALUES (?, ?, 0, ?, ?, ?, ?)",
      [dmThread, `q-${Date.now()}-${Math.random()}`, uids[who], uids[who], NOW, question]);
    const reply = await service.answer({ botAccountId: 1, contact, threadId: dmThread, questionMessageId, question, access: await accessOf(who) });
    const responses = (model.requests.at(-1)?.contents ?? []).flatMap((content) => content.parts).flatMap((part) => (part.functionResponse ? [part.functionResponse.response] : []));
    return { reply, responses, model };
  }

  test("mô hình: propose_alert_change chỉ tạo NHÁP (DB không đổi) + câu xem trước do máy chủ gửi; «đồng ý» ở tin sau mới lưu; mô hình không xác nhận được", async () => {
    const first = await modelTurn("ceo", "anh muốn bot coi chữ bể bao là khẩn nhé", [[call("propose_alert_change", { action: "add_urgent_keyword", keyword: "Bể Bao" })]]);
    assert.equal(first.reply.text, "Em sẽ đổi: Thêm từ khóa KHẨN «bể bao».\nAnh/chị nhắn «đồng ý» để lưu (trong 15 phút), «hủy» để bỏ.");
    assert.equal(saved.length, 0);
    const drafts = await rows("SELECT tool, source, JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.args.keyword')) AS keyword FROM mcp_write_draft WHERE used_at IS NULL");
    assert.deepEqual(json(drafts), [{ tool: "alert_config_change", source: 2, keyword: "bể bao" }]);
    // mô hình thử tự xác nhận bằng công cụ cũ ở lượt khác: không đổi gì
    const tryConfirm = await modelTurn("ceo", "em nhớ xác nhận đề xuất vừa rồi giúp anh nhé", [[call("confirm_alert_change", { change_id: "abc" })], [{ text: "xong" }]]);
    assert.equal(saved.length, 0);
    assert.ok(tryConfirm.responses.some((response) => typeof (response as { error?: unknown }).error === "string"));
    // người dùng nhắn «đồng ý» (lệnh gõ chạy trước mô hình)
    const confirm = await modelTurn("ceo", "đồng ý", []);
    assert.match(String(confirm.reply.text), /Đã đổi: Thêm từ khóa KHẨN «bể bao»/);
    assert.deepEqual(saved, [{ alert_urgent_keywords: "gấp, khẩn, bể bao" }]);
  });

  test("mô hình: list_pending_items + mark_item_handled giữ tên, mark ghi NGAY khi người hỏi nêu mã tin (D-A), người lạ nhận câu từ chối cũ", async () => {
    const run = await modelTurn("tp", `hôm nay có tin nào gấp chưa ai trả lời không em, xong tin số ${msg.urgentB} giúp anh`, [[call("list_pending_items", { limit: 5 })], [call("mark_item_handled", { message_id: msg.urgentB })], [{ text: "đã xong" }]]);
    const [listing, marked] = run.responses as any[];
    assert.ok(listing.items.length > 0 && listing.items.every((item: { message_id: number }) => item.message_id > 0));
    assert.deepEqual(marked, { ok: true, message: "Đã đánh dấu xong — em thôi nhắc tin này." });
    assert.equal((await rows("SELECT reply_state FROM message_flag WHERE message_id = ?", [msg.urgentB]))[0].reply_state, ReplyState.Handled);
    assert.equal((await rows("SELECT COUNT(*) AS n FROM mcp_write_draft"))[0].n, 0);
    const names = new Set(run.model.requests[0].tools.map((tool) => tool.name));
    for (const name of ["list_pending_items", "mark_item_handled", "propose_alert_change"]) assert.ok(names.has(name), name);
    assert.ok(![...names].some((name) => name.startsWith("alert_")), "công cụ lệnh gõ không lộ cho mô hình");
    // khai báo công cụ cho mô hình khi họ bật: không còn confirm_alert_change (nơi dựng danh sách khai báo dùng alertToolDeclarations(true))
    assert.ok(!alertToolDeclarations(true).some((tool) => tool.name === "confirm_alert_change"));
  });

  test("máy chủ của mô hình không có công cụ lệnh / xác nhận; cổng /mcp ngoài không thấy công cụ cảnh báo nào (mọi vai)", async () => {
    const access = await accessOf("ceo");
    const turn = openTurn(access);
    const modelTools = (await turn.model())!.toolNames;
    assert.deepEqual([...modelTools].filter((name) => /alert|confirm|propose_alert|list_pending|mark_item/.test(name)).sort(), ["list_pending_items", "mark_item_handled", "propose_alert_change"]);
    const blocked = await turn.callTool("assistant_model", "alert_config_confirm", { draft_id: 1 }).then((result) => Boolean(result.isError), () => true);
    assert.equal(blocked, true);
    const names = new Set(["list_pending_items", "mark_item_handled", "propose_alert_change", "alert_pending_list", "alert_item_mark_handled", "alert_config_view",
      "alert_config_propose", "alert_config_pending", "alert_config_confirm", "alert_config_cancel"]);
    for (const who of Object.keys(uids) as Who[]) {
      const ctx = await accessOf(who);
      for (const external of [{ ...ctx, contactActor: undefined }, { ...ctx, allowWrite: true, contactActor: undefined }]) {
        const listed = toolsFor(external, "mcp_http", ALL_TOOLS).map((tool) => tool.name);
        assert.ok(!listed.some((name) => names.has(name)), `${who}: cổng ngoài lộ công cụ cảnh báo`);
      }
    }
    // ghi nhật ký: lệnh gõ nguồn 3, mô hình nguồn 2, cùng contact_id, không khóa
    await structured(turn, "assistant_command", "alert_pending_list", {});
    await structured(turn, "assistant_model", "list_pending_items", {});
    await turn.close();
    // Nhật ký ghi bất đồng bộ sau lời gọi: chờ đủ hai dòng
    let logs = await rows("SELECT tool, source, contact_id, key_id FROM mcp_call_log ORDER BY id");
    for (let attempt = 0; attempt < 40 && logs.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      logs = await rows("SELECT tool, source, contact_id, key_id FROM mcp_call_log ORDER BY id");
    }
    const contactId = (await findContactByUid(db, uids.ceo))!.id;
    assert.deepEqual(json(logs.filter((row) => row.tool === "alert_pending_list" || row.tool === "list_pending_items")),
      [{ tool: "alert_pending_list", source: 3, contact_id: contactId, key_id: null }, { tool: "list_pending_items", source: 2, contact_id: contactId, key_id: null }]);
  });

  test("công cụ cấu hình: quyền theo vai (từ khóa chung cần Quản lý / Trưởng phòng; VIP cần là người nhận) và tên VIP mơ hồ → ambiguous có danh sách", async () => {
    const nv = openTurn(await accessOf("nv"));
    const denied = await structured(nv, "assistant_model", "propose_alert_change", { action: "add_urgent_keyword", keyword: "x" });
    assert.equal(denied.isError, true);
    assert.match(denied.error!.message, /Quản lý \/ Trưởng phòng/);
    const web = openTurn(await accessOf("web"));
    const noVip = await structured(web, "assistant_model", "propose_alert_change", { action: "add_vip", person_uid: "u-vip" });
    assert.match(noVip.error!.message, /chưa là người nhận báo/);
    const tp = openTurn(await accessOf("tp"));
    const ambiguous = await structured(tp, "assistant_command", "alert_config_propose", { action: "add_vip", person_name: "phat" });
    assert.equal(ambiguous.error?.code, "ambiguous");
    assert.match(ambiguous.error!.message, /^Có 2 người khớp «phat»:/);
    const unknownUid = await structured(tp, "assistant_model", "propose_alert_change", { action: "add_vip", person_uid: "u-khong-co" });
    assert.match(unknownUid.error!.message, /dùng find_people lấy đúng person_uid/);
    assert.equal((await rows("SELECT COUNT(*) AS n FROM mcp_write_draft"))[0].n, 0);
  });
});
