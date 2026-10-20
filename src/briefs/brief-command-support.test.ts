import assert from "node:assert/strict";
import { test } from "node:test";
import type { AlertAsker } from "../assistant/alert-tools.js";
import { BriefKind, ContactRole } from "../constants.js";
import { isPeriodicBrief, NOT_RECIPIENT, refuseNonRecipient, resolveBriefKind } from "./brief-command-support.js";

const asker = (role: ContactRole): AlertAsker => ({ uid: "u", name: "n", role, recipientId: null });

test("refuseNonRecipient: báo cáo tuần / tháng cho người có vai trò đi tiếp (null), còn lại bị từ chối", () => {
  assert.equal(refuseNonRecipient(asker(ContactRole.Manager), "weekly"), null);
  assert.equal(refuseNonRecipient(asker(ContactRole.DepartmentHead), "monthly"), null);
  assert.equal(refuseNonRecipient(asker(ContactRole.Manager), "morning"), NOT_RECIPIENT);
  assert.equal(refuseNonRecipient(asker(ContactRole.None), "weekly"), NOT_RECIPIENT);
  assert.equal(refuseNonRecipient(null, "monthly"), NOT_RECIPIENT);
});

test("resolveBriefKind: «bản tin» trần trước 12:00 giờ Việt Nam là bản sáng, sau đó là cuối ngày", () => {
  assert.equal(resolveBriefKind("auto", new Date("2026-10-13T04:55:00Z")), BriefKind.Morning); // 11:55 VN
  assert.equal(resolveBriefKind("auto", new Date("2026-10-13T05:05:00Z")), BriefKind.Evening); // 12:05 VN
  assert.equal(resolveBriefKind("weekly", new Date()), BriefKind.Weekly);
  assert.equal(resolveBriefKind("monthly", new Date()), BriefKind.Monthly);
  assert.equal(isPeriodicBrief("weekly") && isPeriodicBrief("monthly") && !isPeriodicBrief("auto"), true);
});
