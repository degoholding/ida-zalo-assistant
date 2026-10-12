import assert from "node:assert/strict";
import { test } from "node:test";
import { ContactKind, ContactRole, ConversationType, FriendRequestStatus, GroupKind, JobKind } from "../constants.js";
import { BotHaltedError } from "../messaging/bot-halted-error.js";
import { JobSkippedError } from "../jobs/job-skipped-error.js";
import {
  canHaltBot, canIssueSendCommand, canResumeBot, isAllowedGroupTarget, isAllowedPersonTarget,
  type SendGroupCandidate, type SendPersonCandidate,
} from "./send-command-permissions.js";
import type { SendRequester } from "./send-command-types.js";

const asker = (role: ContactRole, recipientId: number | null): SendRequester => ({ uid: "u1", name: "A", role, recipientId });

test("mã job mới không đụng giá trị cũ", () => {
  assert.equal(JobKind.SendCommandTarget, 6);
  assert.equal(JobKind.ContactMessage, 5);
});

test("BotHaltedError là JobSkippedError", () => {
  const error = new BotHaltedError();
  assert.ok(error instanceof JobSkippedError);
  assert.ok(error instanceof Error);
  assert.equal(error.name, "BotHaltedError");
});

test("ra lệnh: vai trò HOẶC người nhận, một trong hai đủ", () => {
  assert.equal(canIssueSendCommand(asker(ContactRole.Manager, null)), true);
  assert.equal(canIssueSendCommand(asker(ContactRole.None, 3)), true);
  assert.equal(canIssueSendCommand(asker(ContactRole.DepartmentHead, 3)), true);
  assert.equal(canIssueSendCommand(asker(ContactRole.None, null)), false);
});

test("tắt bot như ra lệnh; bật lại chỉ người nhận", () => {
  for (const [role, recipientId] of [[ContactRole.Manager, null], [ContactRole.None, 3], [ContactRole.None, null]] as const) {
    assert.equal(canHaltBot(asker(role, recipientId)), canIssueSendCommand(asker(role, recipientId)));
  }
  assert.equal(canResumeBot(asker(ContactRole.Manager, null)), false);
  assert.equal(canResumeBot(asker(ContactRole.None, 3)), true);
});

const group = (patch: Partial<SendGroupCandidate> = {}): SendGroupCandidate => ({
  id: 10, threadType: ConversationType.Group, groupKind: GroupKind.Internal, isConfidential: false,
  botStillInGroup: true, zaloGroupId: "1234", ...patch,
});

test("nhóm: nội bộ thường được; khách / cuộc riêng / bot đã rời / mã giả bị từ chối", () => {
  const scope = { selectedGroupIds: [] };
  assert.equal(isAllowedGroupTarget(group(), scope), true);
  assert.equal(isAllowedGroupTarget(group({ groupKind: GroupKind.Customer }), scope), false);
  assert.equal(isAllowedGroupTarget(group({ threadType: ConversationType.Direct }), scope), false);
  assert.equal(isAllowedGroupTarget(group({ botStillInGroup: false }), scope), false);
  assert.equal(isAllowedGroupTarget(group({ zaloGroupId: "demo-1" }), scope), false);
  assert.equal(isAllowedGroupTarget(group({ zaloGroupId: "web-1" }), scope), false);
});

test("nhóm Mật: chỉ khi đã CHỌN đúng nhóm đó", () => {
  const secret = group({ isConfidential: true });
  assert.equal(isAllowedGroupTarget(secret, { selectedGroupIds: [] }), false);
  assert.equal(isAllowedGroupTarget(secret, { selectedGroupIds: [99] }), false);
  assert.equal(isAllowedGroupTarget(secret, { selectedGroupIds: [10] }), true);
});

const person = (patch: Partial<SendPersonCandidate> = {}): SendPersonCandidate => ({
  kind: ContactKind.Staff, zaloUid: "555", isBotAccount: false, hasDirectThread: true, friendStatus: null, ...patch,
});

test("người: chỉ nhân sự, không phải bot, có cuộc riêng hoặc là bạn Zalo", () => {
  assert.equal(isAllowedPersonTarget(person()), true);
  assert.equal(isAllowedPersonTarget(person({ hasDirectThread: false, friendStatus: FriendRequestStatus.Accepted })), true);
  assert.equal(isAllowedPersonTarget(person({ hasDirectThread: false, friendStatus: FriendRequestStatus.Pending })), false);
  assert.equal(isAllowedPersonTarget(person({ hasDirectThread: false })), false);
  assert.equal(isAllowedPersonTarget(person({ kind: ContactKind.Customer })), false);
  assert.equal(isAllowedPersonTarget(person({ kind: ContactKind.Unclassified })), false);
  assert.equal(isAllowedPersonTarget(person({ isBotAccount: true })), false);
  assert.equal(isAllowedPersonTarget(person({ zaloUid: "demo-9" })), false);
});
