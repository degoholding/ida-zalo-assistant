import assert from "node:assert/strict";
import { test } from "node:test";
import type { AlertAsker } from "../assistant/alert-tools.js";
import { ContactRole } from "../constants.js";
import type { Db } from "../db/pool.js";
import { runBriefCommand, type BriefChatDeps } from "./brief-commands.js";

// runBriefCommand: nhánh «không phải người nhận» (review phase 8, M7) — PHẢI trả lời / bỏ qua TRƯỚC khi chạm DB
// (findRecipient), nên deps.db ở đây ném lỗi nếu bị gọi — chứng minh các nhánh dưới không lỡ tay chạm DB.
const dbThrowsIfTouched = { query: () => { throw new Error("không được chạm DB ở nhánh từ chối sớm"); } } as unknown as Db;

function fakeDeps(): BriefChatDeps {
  return {
    db: dbThrowsIfTouched, config: {} as BriefChatDeps["config"], storage: {} as BriefChatDeps["storage"],
    calendar: () => { throw new Error("không được tới nhánh cần lịch"); },
    buildClient: async () => { throw new Error("không được dựng client AI ở nhánh từ chối"); },
  };
}

const asker = (patch: Partial<AlertAsker>): AlertAsker => ({ uid: "u1", name: "Minh", role: ContactRole.None, recipientId: null, ...patch });

test("asker null (không ai, không vai trò) → từ chối thẳng, không chạm DB", async () => {
  const reply = await runBriefCommand(fakeDeps(), null, { kind: "brief_request", request: "weekly", variant: "standard" }, new Date());
  assert.match(reply ?? "", /người nhận cảnh báo/);
});

test("có vai trò nhưng KHÔNG phải người nhận, hỏi «báo cáo tuần» → null (để AI export_report lo), không chạm DB", async () => {
  const reply = await runBriefCommand(
    fakeDeps(), asker({ role: ContactRole.DepartmentHead, recipientId: null }),
    { kind: "brief_request", request: "weekly", variant: "standard" }, new Date(),
  );
  assert.equal(reply, null);
});

test("có vai trò nhưng KHÔNG phải người nhận, hỏi «báo cáo tháng» → cũng null", async () => {
  const reply = await runBriefCommand(
    fakeDeps(), asker({ role: ContactRole.Manager, recipientId: null }),
    { kind: "brief_request", request: "monthly", variant: "standard" }, new Date(),
  );
  assert.equal(reply, null);
});

test("có vai trò nhưng KHÔNG phải người nhận, hỏi «bản tin sáng» (riêng tư, không có export_report tương đương) → vẫn từ chối", () => {
  return runBriefCommand(
    fakeDeps(), asker({ role: ContactRole.DepartmentHead, recipientId: null }),
    { kind: "brief_request", request: "morning", variant: "standard" }, new Date(),
  ).then((reply) => assert.match(reply ?? "", /người nhận cảnh báo/));
});

test("không có vai trò gì (ContactRole.None) VÀ không phải người nhận, hỏi «báo cáo tuần» → vẫn từ chối (export_report cũng không dùng được)", async () => {
  const reply = await runBriefCommand(
    fakeDeps(), asker({ role: ContactRole.None, recipientId: null }),
    { kind: "brief_request", request: "weekly", variant: "standard" }, new Date(),
  );
  assert.match(reply ?? "", /người nhận cảnh báo/);
});
