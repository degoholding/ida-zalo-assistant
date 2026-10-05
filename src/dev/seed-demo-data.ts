// Đổ dữ liệu mẫu vào DB máy dev: `npm run seed:demo`. Đi qua đúng các hàm đồng bộ thật (ensureGroup,
// syncGroupMembers, ingestGroupMessage…) để bộ đếm, danh bạ, nhóm khớp như khi bot chạy thật.
// Chạy lại bao nhiêu lần cũng được — tin trùng mã thì bỏ qua. KHÔNG chạy trên máy thật (chặn NODE_ENV=production).

import type { ResultSetHeader } from "mysql2";
import { loadConfig } from "../config.js";
import { ContactRole } from "../constants.js";
import { runMigrations } from "../db/migrate.js";
import { createPool, type Db } from "../db/pool.js";
import { createCompany, findCompanyByCode } from "../sync/company-repository.js";
import { findContactByUid, updateContact, upsertMemberContact } from "../sync/contact-repository.js";
import { ensureGroup, markBotInGroup, updateGroupSettings } from "../sync/group-repository.js";
import { syncGroupMembers, type GroupInfoSource } from "../sync/member-sync.js";
import { ingestDirectMessage, ingestGroupMessage, type IngestDeps, type IncomingGroupMessage } from "../sync/message-ingest.js";
import { DEMO_BOT, DEMO_COMPANIES, DEMO_GROUPS, DEMO_MANAGER, DEMO_PEOPLE, type DemoGroup, type DemoMessage } from "./demo-conversations.js";

const HOUR_MS = 60 * 60 * 1000;
const READ_NO_FILES = { readMessages: true, captureFiles: false };

/** Tài khoản bot demo: tắt sẵn, không có phiên — dịch vụ không cố đăng nhập nó. */
async function ensureDemoBotAccount(db: Db): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO bot_account (label, zalo_uid, display_name, is_active) VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [DEMO_BOT.label, DEMO_BOT.uid, DEMO_BOT.name],
  );
  await upsertMemberContact(db, DEMO_BOT.uid, DEMO_BOT.name, "", "", "");
  return result.insertId;
}

function fakeGroupSource(group: DemoGroup): GroupInfoSource {
  const members = group.members.map((key) => DEMO_PEOPLE[key]);
  return {
    getGroupInfo: async () => ({
      gridInfoMap: {
        [group.zaloId]: {
          name: group.name,
          totalMember: members.length + 1,
          memberIds: [...members.map((person) => person.uid), DEMO_BOT.uid],
          adminIds: [DEMO_PEOPLE.duy.uid],
          currentMems: members.map((person) => ({ id: person.uid, dName: person.name, zaloName: person.name })),
        },
      },
    }),
    getGroupMembersInfo: async (ids) => ({
      profiles: Object.fromEntries(ids.map((id) => {
        const name = Object.values(DEMO_PEOPLE).find((person) => person.uid === id)?.name ?? DEMO_BOT.name;
        return [id, { displayName: name, zaloName: name }];
      })),
    }),
  };
}

function toIncoming(zaloThreadId: string, msgId: string, message: DemoMessage, now: number): IncomingGroupMessage {
  const sender = DEMO_PEOPLE[message.from];
  const ext = message.file?.name.split(".").pop() ?? "";
  return {
    zaloGroupId: zaloThreadId,
    msgId,
    cliMsgId: "",
    msgType: message.file ? "share.file" : "webchat",
    senderUid: sender.uid,
    senderName: sender.name,
    sentAtMs: now - message.hoursAgo * HOUR_MS,
    content: message.file
      ? { title: message.file.name, href: `https://example.invalid/demo/${message.file.name}`, params: JSON.stringify({ fileSize: message.file.bytes, fileExt: ext }) }
      : message.text,
    quote: null,
    mentions: null,
  };
}

async function seed(db: Db): Promise<void> {
  const botId = await ensureDemoBotAccount(db);
  const deps: IngestDeps = { db, defaults: READ_NO_FILES, directDefaults: READ_NO_FILES };
  const now = Date.now();
  const companyIds = new Map<string, number>();
  for (const company of DEMO_COMPANIES) {
    const existing = await findCompanyByCode(db, company.code);
    companyIds.set(company.code, existing?.id ?? await createCompany(db, company.code, company.name));
  }
  let stored = 0;
  for (const group of DEMO_GROUPS) {
    const { group: row } = await ensureGroup(db, group.zaloId, READ_NO_FILES);
    await markBotInGroup(db, botId, row.id);
    await updateGroupSettings(db, row.id, { readMessages: true, captureFiles: false, companyId: companyIds.get(group.companyCode) ?? null });
    await syncGroupMembers(db, fakeGroupSource(group), row.id, group.zaloId);
    for (const [index, message] of group.messages.entries()) {
      const outcome = await ingestGroupMessage(deps, botId, toIncoming(group.zaloId, `${group.zaloId}-${index}`, message, now));
      if (outcome === "stored") stored += 1;
    }
  }
  // Cuộc riêng của quản lý với bot + cấp vai trò Quản lý để bot trả lời người này
  const greeting: DemoMessage = { hoursAgo: 12, from: "duy", text: "Chào em, từ giờ anh hỏi việc các nhóm qua đây nhé." };
  const direct = await ingestDirectMessage(deps, botId, toIncoming(DEMO_MANAGER.uid, "demo-dm-duy-0", greeting, now));
  if (direct.outcome === "stored") stored += 1;
  const manager = await findContactByUid(db, DEMO_MANAGER.uid);
  if (manager) {
    await updateContact(db, manager.id, {
      kind: "auto", role: ContactRole.Manager, companyId: companyIds.get("DEMO-XD") ?? null,
      note: "Người dùng demo — hỏi bot bằng: npm run ask -- \"câu hỏi\"",
    });
  }
  console.log(`Xong: ${DEMO_COMPANIES.length} công ty, ${DEMO_GROUPS.length} nhóm, ${Object.keys(DEMO_PEOPLE).length} người, ${stored} tin mới` +
    (stored ? "" : " (đã seed từ trước — tin trùng bỏ qua)"));
  console.log(`Hỏi trợ lý dưới tên «${DEMO_MANAGER.name}» (Quản lý): npm run ask -- "tóm tắt nhóm K52 hôm nay"`);
}

if (process.env.NODE_ENV === "production") {
  console.error("Không seed dữ liệu demo trên máy chạy thật (NODE_ENV=production).");
  process.exit(1);
}
const config = loadConfig();
await runMigrations(config.databaseUrl);
const db = createPool(config.databaseUrl);
try {
  await seed(db);
} finally {
  await db.end();
}
