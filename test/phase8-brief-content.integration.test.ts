// Phase 8 — NỘI DUNG bản tin / báo cáo trên MySQL THẬT: phạm vi từng người nhận (nhóm Mật chỉ vào bản tin người CHỌN
// nhóm đó, việc của chính người nhận vẫn hiện), tin khẩn đã xử lý / thu hồi / chờ AI / quá 7 ngày, tin chờ dành riêng
// người khác, việc / ticket tạo trong tin riêng hoặc trên web, điểm tin AI (không đọc nhóm Mật, che dữ liệu cá nhân, bỏ ý
// có link / dãy số), Excel báo cáo tuần theo phạm vi, lệnh gọi tay + trần 6 lần / giờ + câu từ chối. Đối chiếu
// doc/08-kich-ban-test-phase-8.md (mã N-xx / E-xx ghi ở tên bài). Zalo, AI là bản giả.
// Khác doc: «Ngày 1» dời sang T3 13/10 (T2 còn báo cáo tuần) và thêm ca biên mục 4 (khẩn tồn 6 ngày, việc G2 quá hạn,
// ticket web / ticket của chính anh Phong) nên số đếm trong bài lớn hơn số mẫu của doc — luật thì giống hệt.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import * as XLSX from "xlsx";
import { resolveAlertAsker } from "../src/assistant/alert-tools.js";
import { parseChatCommand, runChatCommand } from "../src/assistant/chat-commands.js";
import type { ModelClient } from "../src/assistant/gemini-client.js";
import { HighlightCache } from "../src/briefs/brief-ai-highlights.js";
import type { BriefChatDeps } from "../src/briefs/brief-commands.js";
import { produceBrief } from "../src/briefs/brief-delivery.js";
import { runSendBriefTool } from "../src/briefs/brief-tool.js";
import type { AppConfig } from "../src/config.js";
import { BriefKind, BriefTrigger, MessagePriority, ReplyState, TaskStatus } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { findRecipient } from "../src/recipients/recipient-repository.js";
import { PeriodicStatsCache } from "../src/reports/periodic-report-stats-cache.js";
import { LocalFileStorage } from "../src/storage/file-storage.js";
import {
  briefLogs, createPinnedPool, createTask, createTicket, databaseUrl, flagMessage, makeCalendar, makeConfig, postMessage, recipientJobs, resetTables,
  seedWorld, vn, type Phase8World,
} from "./phase8-brief-fixtures.js";

const NOT_RECIPIENT = "Bản tin dành cho người nhận cảnh báo — quản trị thêm anh/chị ở màn Người nhận.";
const RATE_LIMITED = "Anh/chị vừa gọi bản tin / báo cáo khá nhiều trong một giờ qua — thử lại sau giúp em nhé.";
const NO_CALENDAR = "Lịch làm việc đang cấu hình sai — báo quản trị kiểm tra ở màn Cài đặt rồi thử lại giúp em.";

/** Id các tin / việc / ticket dựng cho ngày T3 13/10 — tên theo kịch bản doc 08. */
interface DayIds {
  vonCuc: number; flowertop: number; hoaBinh: number; forPhong: number; personal: number;
  vm: number; vp: number; vx: number; tk: number; tg1: number;
}

describe("phase 8 — nội dung bản tin / báo cáo theo phạm vi", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let config: AppConfig;
  let world: Phase8World;
  let ids: DayIds;
  let storageDir: string;
  let storage: LocalFileStorage;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    storageDir = await mkdtemp(path.join(tmpdir(), "phase8-content-"));
    storage = new LocalFileStorage(storageDir);
  });
  after(async () => {
    await db?.end();
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetTables(db);
    config = makeConfig();
    world = await seedWorld(db);
    ids = await seedTuesday();
  });

  const tue = (time: string) => vn(`2026-10-13 ${time}`);

  /** Một ngày làm việc T3 13/10 theo kịch bản Ngày 1 (doc 08 mục 3), cộng vài ca biên mục 4. */
  async function seedTuesday(): Promise<DayIds> {
    const vonCuc = await postMessage(db, "g2", "u-sau", "Anh Sáu", "Anh Huy ơi lô Blaze giao hôm thứ 7 bị vón cục hết rồi, khách đòi trả hàng", tue("08:40"));
    await flagMessage(db, vonCuc, { priority: MessagePriority.Urgent });
    const flowertop = await postMessage(db, "g2", "u-sau", "Anh Sáu", "Giá Flowertop đợt này bao nhiêu vậy em?", tue("09:15"));
    await flagMessage(db, flowertop, { replyState: ReplyState.Waiting, dueAt: tue("11:15") });
    const hoaBinh = await postMessage(db, "g3", "u-phong", "Anh Phong", "Chị Hằng ơi ĐL Hòa Bình khất nợ 3 tỷ, yêu cầu ngừng lấy hàng ngay", tue("10:30"));
    await flagMessage(db, hoaBinh, { priority: MessagePriority.Urgent });
    // Khẩn đã xử lý trong ngày (N-18) — chỉ còn trong số đếm «đã xử lý»
    const handled = await postMessage(db, "g1", "u-tam", "Tâm", "ĐL Tân Phú đòi trả hàng gấp lô Flowertop", tue("09:00"));
    await flagMessage(db, handled, { priority: MessagePriority.Urgent, replyState: ReplyState.Handled, handledAt: tue("09:30") });
    // N-56: khẩn đã thu hồi · khẩn còn chờ AI xác nhận · E-15: khẩn quá 7 ngày — cả ba không vào mục 1
    const recalled = await postMessage(db, "g1", "u-huy", "Huy", "Khách Long An khiếu nại gấp lô hàng lỗi", tue("09:10"));
    await flagMessage(db, recalled, { priority: MessagePriority.Urgent });
    await db.query("UPDATE message SET recalled_at = ? WHERE id = ?", [tue("09:11"), recalled]);
    const pendingAi = await postMessage(db, "g1", "u-huy", "Huy", "Khách la quá trời luôn, xử lý giùm em", tue("09:20"));
    await flagMessage(db, pendingAi, { priority: MessagePriority.Urgent, pendingAi: true });
    const old = await postMessage(db, "g1", "u-tuan", "Anh Tuấn", "ĐL Sóc Trăng báo mất hàng trên xe", vn("2026-10-05 09:00"));
    await flagMessage(db, old, { priority: MessagePriority.Urgent });
    // N-24: khẩn chưa xử lý từ 6 ngày trước vẫn hiện tiếp
    const carry = await postMessage(db, "g1", "u-tuan", "Anh Tuấn", "ĐL Cần Thơ báo giao trễ 3 ngày", vn("2026-10-07 09:00"));
    await flagMessage(db, carry, { priority: MessagePriority.Urgent });
    // E-14: tin chờ dành riêng anh Phong
    const forPhong = await postMessage(db, "g1", "u-tuan", "Anh Tuấn", "@Phong anh duyệt giúp em đơn chiết khấu ĐL Tân Phú", tue("09:30"));
    await flagMessage(db, forPhong, { replyState: ReplyState.Waiting, dueAt: tue("11:30"), forUid: "u-phong" });
    // N-54: tin có SĐT / STK — không bao giờ tới mô hình nguyên văn
    const personal = await postMessage(db, "g1", "u-tam", "Tâm", "Anh chuyển giúp em 12 triệu vào STK 0123456789 Vietcombank, sdt em 0909123456", tue("11:00"));

    const vm = await createTask(db, { title: "Gửi báo giá ĐL Thành Công", assigneeUid: "u-tam", assigneeName: "Tâm", threadId: world.g1,
      dueAt: tue("11:00"), dueHasTime: true, createdAt: tue("09:40") });
    const vp = await createTask(db, { title: "Làm biên bản đối chiếu công nợ ĐL Hòa Bình", assigneeUid: "u-hang", assigneeName: "Chị Hằng",
      assignerUid: "u-phong", threadId: world.g3, dueAt: vn("2026-10-14 00:00"), createdAt: tue("10:35") });
    await createTask(db, { title: "Đối chiếu công nợ ĐL Thành Công", assigneeUid: "u-huy", assigneeName: "Huy", threadId: world.g1,
      dueAt: tue("17:00"), dueHasTime: true, status: TaskStatus.Done, closedAt: tue("16:30"), createdAt: tue("09:30") });
    const vx = await createTask(db, { title: "Gọi lại anh Sáu về đơn tháng 10", assigneeUid: "u-huy", assigneeName: "Huy", threadId: world.g2,
      dueAt: vn("2026-10-12 00:00"), createdAt: vn("2026-10-12 09:00") });

    const tg1 = await createTicket(db, { title: "Máy in kho Cần Thơ hỏng", requesterUid: "u-tuan", requesterName: "Anh Tuấn", threadId: world.g1, createdAt: tue("14:00") });
    // E-19: ticket tạo trên web (không gắn cuộc) · ticket của chính anh Phong trong G2 (anh không chọn G2)
    await createTicket(db, { title: "Cập nhật bảng giá trên web", requesterUid: "u-tuan", requesterName: "Anh Tuấn", threadId: null, createdAt: tue("15:00") });
    await createTicket(db, { title: "Xin cấp mẫu thử cho ĐL", requesterUid: "u-phong", requesterName: "Anh Phong", threadId: world.g2, createdAt: tue("15:30") });
    // N-13: Huy «báo lỗi: …» trong tin riêng với bot
    const tk = await createTicket(db, { title: "ĐL Thành Công báo lô Blaze vón cục", requesterUid: "u-huy", requesterName: "Huy", threadId: world.huyDirect, createdAt: tue("16:00") });
    return { vonCuc, flowertop, hoaBinh, forPhong, personal, vm, vp, vx, tk, tg1 };
  }

  /** Soạn như nút «Gửi thử bản tin» (không chống trùng) tại mốc giờ VN; `client` = bản giả mô hình AI. */
  async function compose(recipientId: number, kind: BriefKind, at: Date, client: ModelClient | null = null, variant?: "current") {
    const recipient = (await findRecipient(db, recipientId))!;
    const deps = {
      db, config, calendar: makeCalendar(), storage, client: async () => client,
      highlightCache: new HighlightCache(), messageStatsCache: new PeriodicStatsCache(),
    };
    const result = (await produceBrief(deps, recipient, kind, BriefTrigger.WebTest, at, { variant }))!;
    const row = (await briefLogs(db)).find((item) => item.id === result.logId)!;
    return { ...result, aiNote: row.ai_note };
  }

  test("N-21: evening brief for «all groups» — no confidential group, handled / recalled / AI-pending / >7-day urgent left out", async () => {
    const { text, aiNote } = await compose(world.mi, BriefKind.Evening, tue("17:30"));
    assert.match(text, /^BẢN TIN CUỐI NGÀY T3 13\/10 — Chị Mi\n/);
    assert.match(text, /\n1\. KHẨN hôm nay: 3 \(đã xử lý 1, còn 2\)\n {3}- \[TEST Sales Miền Tây\] Anh Tuấn 09:00: ĐL Cần Thơ báo giao trễ 3 ngày\n {3}- \[TEST ĐL Thành Công\] Anh Sáu 08:40: Anh Huy ơi lô Blaze/);
    assert.match(text, /\n2\. Tin còn chờ trả lời: 1 \(1 quá giờ\)\n {3}- \[TEST ĐL Thành Công\] Anh Sáu 09:15: Giá Flowertop/);
    assert.match(text, new RegExp(`\\n3\\. Việc: 1 xong hôm nay · 2 còn quá hạn · 0 hạn mai\\n {3}- V-${ids.vx} Huy · Gọi lại anh Sáu về đơn tháng 10 · quá 1 ngày\\n {3}- V-${ids.vm} Tâm · Gửi báo giá ĐL Thành Công · quá hạn\\n`));
    // 4 ticket mới (tin riêng của Huy + web + G1 + G2) — mục chỉ 3 dòng, dư «… và 1 nữa» (N-57)
    assert.match(text, new RegExp(`\\n4\\. Ticket: 4 mới · 0 đóng · 4 còn mở\\n {3}- T-${ids.tk} ĐL Thành Công báo lô Blaze vón cục · Huy\\n`));
    assert.match(text, /\n {3}… và 1 nữa\n/);
    for (const hidden of ["Hòa Bình", "Long An", "la quá trời", "Sóc Trăng", "chiết khấu", "5. Điểm tin"]) {
      assert.ok(!text.includes(hidden), `bản tin chị Mi không được có «${hidden}»`);
    }
    assert.equal(aiNote, "chưa có khóa AI");
  });

  test("N-20/E-14: selected groups incl. confidential — sees G3 and own pending, never G2; tomorrow's G3 task listed", async () => {
    const { text } = await compose(world.phong, BriefKind.Evening, tue("17:15"));
    assert.match(text, /^BẢN TIN CUỐI NGÀY T3 13\/10 — Anh Phong\n/);
    assert.match(text, /\n1\. KHẨN hôm nay: 3 \(đã xử lý 1, còn 2\)\n/);
    assert.match(text, /\[TEST BGĐ Công nợ\] Anh Phong 10:30: Chị Hằng ơi ĐL Hòa Bình khất nợ 3 tỷ/);
    assert.match(text, /\n2\. Tin còn chờ trả lời: 1 \(1 quá giờ\)\n {3}- \[TEST Sales Miền Tây\] Anh Tuấn 09:30: @Phong anh duyệt giúp em đơn chiết khấu/);
    assert.match(text, new RegExp(`\\n3\\. Việc: 1 xong hôm nay · 1 còn quá hạn · 1 hạn mai\\n {3}- V-${ids.vm} Tâm · .* · quá hạn\\n {3}- V-${ids.vp} Chị Hằng · Làm biên bản đối chiếu công nợ ĐL Hòa B… · hạn mai\\n`));
    // Ticket G1 + ticket của chính anh ở G2; KHÔNG ticket tin riêng của Huy / ticket web
    assert.match(text, /\n4\. Ticket: 2 mới · 0 đóng · 2 còn mở\n/);
    assert.match(text, /Xin cấp mẫu thử cho ĐL · Anh Phong/);
    for (const hidden of ["vón cục", "Flowertop", "Gọi lại anh Sáu", "Cập nhật bảng giá"]) {
      assert.ok(!text.includes(hidden), `bản tin anh Phong không được có «${hidden}»`);
    }
  });

  test("N-28 rule: a recipient sees her own task in a confidential group she did not select — but not its messages", async () => {
    const { text } = await compose(world.hang, BriefKind.Evening, tue("17:30"));
    assert.match(text, new RegExp(`- V-${ids.vp} Chị Hằng · Làm biên bản đối chiếu công nợ ĐL Hòa B… · hạn mai`));
    assert.match(text, /\n2\. Tin còn chờ trả lời: 0 \(0 quá giờ\)\n {3}không có\n/);
    for (const hidden of ["khất nợ 3 tỷ", "vón cục", "chiết khấu"]) assert.ok(!text.includes(hidden), `bản tin chị Hằng không được có «${hidden}»`);
  });

  test("N-23/N-25: next morning — yesterday's open urgent / overdue task carry over; yesterday's tickets count as new", async () => {
    const mi = await compose(world.mi, BriefKind.Morning, vn("2026-10-14 07:30"));
    assert.match(mi.text, /^BẢN TIN SÁNG T4 14\/10 — Chị Mi\n1\. KHẨN\/quan trọng chưa xử lý: 2\n/);
    assert.match(mi.text, /\n2\. Tin chờ trả lời quá giờ: 1\n {3}- \[TEST ĐL Thành Công\] Anh Sáu 09:15: Giá Flowertop/);
    assert.match(mi.text, new RegExp(`\\n3\\. Việc: 2 quá hạn, 0 hạn hôm nay\\n {3}- V-${ids.vx} Huy · .* · quá 2 ngày\\n {3}- V-${ids.vm} Tâm · Gửi báo giá ĐL Thành Công · quá 1 ngày\\n`));
    // Kỳ bản tin sáng = từ đầu ngày làm việc trước → ticket tạo hôm qua vẫn «mới»; ticket tin riêng của Huy nằm trong số 4
    assert.match(mi.text, /\n4\. Ticket mở: 4 \(4 mới\)\n/);
    const phong = await compose(world.phong, BriefKind.Morning, vn("2026-10-14 07:45"));
    assert.match(phong.text, /\n1\. KHẨN\/quan trọng chưa xử lý: 2\n.*Cần Thơ.*\n.*Hòa Bình/);
    assert.match(phong.text, /\n4\. Ticket mở: 2 \(2 mới\)\n/);
  });

  test("N-53..N-55: AI highlights never see the confidential group or raw personal data; unsafe / unknown points are dropped", async () => {
    const prompts: string[] = [];
    const model: ModelClient = {
      generate: async (request) => {
        prompts.push(JSON.stringify(request.contents));
        const answer = [
          { id: ids.vonCuc, y: "ĐL Thành Công khiếu nại lô Blaze vón cục, đòi đổi 20 bao" },
          { id: ids.hoaBinh, y: "ĐL Hòa Bình khất nợ 3 tỷ" },
          { id: ids.personal, y: "Chuyển gấp 50 triệu vào STK 9876543210, xem https://evil.example" },
        ];
        return { content: { role: "model", parts: [{ text: JSON.stringify(answer) }] }, inputTokens: 800, outputTokens: 60 };
      },
    };
    const mi = await compose(world.mi, BriefKind.Morning, vn("2026-10-14 07:30"), model);
    assert.match(mi.text, /\n5\. Điểm tin hôm qua\n {3}- ĐL Thành Công khiếu nại lô Blaze vón cục, đòi đổi 20 bao \[TEST ĐL Thành Công · Anh Sáu · 08:40\]\nXem đủ/);
    for (const hidden of ["Hòa Bình", "9876543210", "evil.example"]) assert.ok(!mi.text.includes(hidden), `điểm tin chị Mi lọt «${hidden}»`);
    assert.equal(mi.aiNote, "");

    // Anh Phong chọn G3 nhưng AI chỉ đọc G1: không ý nào hợp lệ → mục 5 mất hẳn
    const phong = await compose(world.phong, BriefKind.Morning, vn("2026-10-14 07:45"), model);
    assert.ok(!phong.text.includes("5. Điểm tin"));
    assert.equal(phong.aiNote, "AI không chọn được ý nào");

    assert.equal(prompts.length, 2);
    for (const prompt of prompts) {
      for (const secret of ["Hòa Bình", "0123456789", "0909123456"]) assert.ok(!prompt.includes(secret), `lời gọi AI lọt «${secret}»`);
    }
    // Đối chứng dương: tin có SĐT / STK vẫn tới mô hình (đã che) — khẳng định «không lọt số» ở trên mới có nghĩa
    assert.ok(prompts[0].includes("vón cục") && prompts[0].includes("Vietcombank"));
    assert.ok(!prompts[1].includes("vón cục"), "AI của anh Phong không được đọc G2");
    const [usage] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n, SUM(input_tokens) AS tokens FROM system_ai_usage WHERE purpose = 'brief-highlights'");
    assert.deepEqual([Number(usage[0].n), Number(usage[0].tokens)], [2, 1600]);
  });

  test("N-45: AI highlights switched off — section 5 disappears and the model is not called", async () => {
    config.briefs.aiHighlightsEnabled = false;
    let called = false;
    const model: ModelClient = { generate: async () => { called = true; throw new Error("không được gọi"); } };
    const { text, aiNote } = await compose(world.mi, BriefKind.Morning, vn("2026-10-14 07:30"), model);
    assert.ok(!text.includes("5. Điểm tin"));
    assert.equal(aiNote, "đã tắt trong cài đặt");
    assert.equal(called, false);
  });

  test("N-28/N-29: weekly report Excel follows each recipient's scope", async () => {
    const sheetsOf = async (recipientId: number) => {
      const { files } = await compose(recipientId, BriefKind.Weekly, vn("2026-10-14 09:00"), null, "current");
      assert.equal(files.length, 2);
      const workbook = XLSX.read(await readFile(path.join(storageDir, files[1].storageKey)));
      return Object.fromEntries(workbook.SheetNames.map((name) => [name, XLSX.utils.sheet_to_csv(workbook.Sheets[name])]));
    };
    const hang = await sheetsOf(world.hang);
    assert.ok(hang["Việc"].includes("Làm biên bản đối chiếu công nợ ĐL Hòa Bình"), "sheet Việc của chị Hằng phải có V-p");
    assert.ok(!hang["Việc"].includes("Gọi lại anh Sáu"), "chị Hằng không thấy việc G2");

    const mi = await sheetsOf(world.mi);
    assert.ok(!mi["Việc"].includes("Hòa Bình"), "sheet Việc của chị Mi không được có V-p (nhóm Mật)");
    assert.ok(mi["Việc"].includes("Gọi lại anh Sáu"));
    assert.ok(!Object.values(mi).join("\n").includes("TEST BGĐ Công nợ"), "báo cáo chị Mi không được nhắc nhóm Mật");

    // Anh Phong: tab chính (theo nhóm) có G3, không G2; G2 chỉ hiện ở ticket CHÍNH anh báo (luật «việc của chính mình»)
    const phong = await sheetsOf(world.phong);
    const phongGroups = phong[Object.keys(phong)[0]];
    assert.ok(phongGroups.includes("TEST BGĐ Công nợ"));
    assert.ok(!phongGroups.includes("TEST ĐL Thành Công"), "tab theo nhóm của anh Phong không được có G2");
    assert.ok(!phong["Việc"].includes("Gọi lại anh Sáu"), "anh Phong không thấy việc G2 của người khác");
    assert.ok(phong["Ticket"].includes("Xin cấp mẫu thử cho ĐL"));
    const [row] = (await briefLogs(db)).filter((item) => item.recipient_id === world.phong);
    assert.deepEqual([row.period_key, row.period_label], ["2026-W42", "Tuần 42/2026 (12/10–18/10)"]);
  });

  // --- Gọi tay bằng câu chat (phase 4 của plan) ---

  let wakes = 0;
  const chatDeps = (pool: Db, calendarOk = true): BriefChatDeps => ({
    db: pool, config, storage, calendar: () => (calendarOk ? makeCalendar() : null), buildClient: async () => null, wakeJobs: () => { wakes += 1; },
  });

  async function askerOf(uid: string) {
    const [contacts] = await db.query<RowDataPacket[]>("SELECT zalo_uid, display_name, zalo_name, role FROM contact WHERE zalo_uid = ?", [uid]);
    return resolveAlertAsker(db, contacts[0] as { zalo_uid: string; display_name: string; zalo_name: string; role: number });
  }

  /** Gõ một câu nhắn riêng tại mốc `now` — đồng hồ MySQL ghim cùng mốc vì trần 6 lần / giờ đếm theo `created_at`. */
  async function ask(uid: string, text: string, now: Date, opts: { inGroup?: boolean; calendarOk?: boolean } = {}) {
    const asker = await askerOf(uid);
    const command = parseChatCommand(text);
    assert.ok(command, `«${text}» phải khớp lệnh`);
    const pinned = createPinnedPool(now);
    try {
      return await runChatCommand({ db: pinned, asker, inGroup: opts.inGroup ?? false, now, brief: chatDeps(pinned, opts.calendarOk ?? true) }, command);
    } finally {
      await pinned.end();
    }
  }

  test("N-16/N-17/N-30..N-33: phrases map to the right brief / period; success answers nothing and wakes the sender", async () => {
    wakes = 0;
    // Theo thứ tự giờ, không quá 6 lần trong một giờ bất kỳ (trần N-35)
    const cases: [string, Date, BriefKind, string][] = [
      ["cho chị xem bản tin tối nha", tue("09:00"), BriefKind.Evening, "2026-10-13"],
      ["báo cáo tuần này", tue("09:05"), BriefKind.Weekly, "2026-W42"],
      ["bc tuần", tue("09:10"), BriefKind.Weekly, "2026-W41"],
      ["báo cáo tháng", tue("09:15"), BriefKind.Monthly, "2026-09"],
      ["xem báo cáo tháng này", tue("09:20"), BriefKind.Monthly, "2026-10"],
      ["bản tin", tue("11:55"), BriefKind.Morning, "2026-10-13"],
      ["bản tin", tue("12:05"), BriefKind.Evening, "2026-10-13"],
    ];
    for (const [text, at] of cases) assert.equal(await ask("u-mi", text, at), "", `«${text}» phải im lặng (bản tin đi qua hàng đợi)`);
    const rows = await briefLogs(db);
    assert.deepEqual(rows.map((row) => [row.kind, row.period_key]), cases.map(([, , kind, key]) => [kind, key]));
    assert.ok(rows.every((row) => row.trigger_source === BriefTrigger.Chat && row.recipient_id === world.mi));
    assert.equal((await recipientJobs(db)).length, cases.length);
    assert.equal(wakes, cases.length);
  });

  test("N-29..N-35/N-42: the 7th manual call within an hour is refused (all kinds count); the cap frees up an hour later", async () => {
    const calls = ["báo cáo tuần này", "báo cáo tuần trước", "báo cáo tháng", "xem báo cáo tháng này", "bc tuần", "bản tin cuối ngày"];
    for (const [index, text] of calls.entries()) {
      assert.equal(await ask("u-mi", text, vn(`2026-10-14 09:${String(5 + index * 5).padStart(2, "0")}`)), "", `«${text}»`);
    }
    assert.equal(await ask("u-mi", "bản tin sáng", vn("2026-10-14 09:35")), RATE_LIMITED);
    assert.equal((await briefLogs(db)).length, 6);
    assert.equal(await ask("u-mi", "bản tin sáng", vn("2026-10-14 10:45")), "");
    assert.equal((await briefLogs(db)).length, 7);
  });

  test("N-36..N-39/E-18: refusals — non-recipient, staff without a role, in a group, inactive, broken calendar", async () => {
    const at = tue("09:45");
    assert.equal(await ask("u-tuan", "bản tin sáng", at), NOT_RECIPIENT);
    // Tuấn có vai trò: báo cáo tuần để trợ lý AI làm (export_report) — lệnh trả null, không từ chối
    assert.equal(await ask("u-tuan", "báo cáo tuần", at), null);
    assert.equal(await ask("u-huy", "bản tin sáng", at), NOT_RECIPIENT);
    assert.equal(await ask("u-huy", "báo cáo tuần", at), NOT_RECIPIENT);
    assert.equal(await ask("u-phong", "bản tin sáng", at, { inGroup: true }), null);
    assert.equal(await ask("u-mi", "bản tin sáng", at, { calendarOk: false }), NO_CALENDAR);
    await db.query("UPDATE recipient SET is_active = 0 WHERE id = ?", [world.mi]);
    assert.equal(await ask("u-mi", "bản tin sáng", at), NOT_RECIPIENT);
    assert.deepEqual(await briefLogs(db), []);
  });

  test("N-42: the AI tool send_brief runs the same rules", async () => {
    const [mi, tuan] = await Promise.all([askerOf("u-mi"), askerOf("u-tuan")]);
    const now = vn("2026-10-14 10:45");
    assert.deepEqual(await runSendBriefTool(chatDeps(db), mi!, { kind: "weekly", period: "current" }, now), { queued: true, label: "báo cáo tuần" });
    assert.deepEqual(await runSendBriefTool(chatDeps(db), mi!, { kind: "daily" }, now), { error: "kind phải là morning / evening / weekly / monthly." });
    assert.ok("error" in await runSendBriefTool(chatDeps(db), tuan!, { kind: "morning" }, now));
    const rows = await briefLogs(db);
    assert.deepEqual(rows.map((row) => [row.kind, row.period_key, row.trigger_source]), [[BriefKind.Weekly, "2026-W42", BriefTrigger.Chat]]);
  });
});
