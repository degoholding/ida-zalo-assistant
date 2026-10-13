import type { SendActionKind } from "../constants.js";
import { assertNamesInQuestion, SendCommandInputError } from "./send-command-content-guard.js";
import type { SendCommandDeps } from "./send-command-deps.js";
import type { CreateDraftInput, CreateDraftResult } from "./send-command-draft-service.js";
import { MAX_DRAFTS_PER_HOUR, MAX_TARGETS } from "./send-command-limits.js";
import { canIssueSendCommand } from "./send-command-permissions.js";
import { countRecent } from "./send-command-repository.js";
import type { SendRequester } from "./send-command-types.js";
import { groupActionWords } from "./send-group-action-words.js";
import { foldName, type TargetCandidate } from "./send-target-matcher.js";
import { loadGroupScope, resolveGroupName, resolveTargetNames } from "./send-target-resolver.js";

// Khâu chung của NHÁP «việc làm trên nhóm từ tin riêng» (nhắc hẹn, ghim): kiểm quyền + trần → danh sách tên nhóm → tên phải có trong tin
// người hỏi; rồi phân giải nhóm (CHỈ nhóm nội bộ, Mật theo lựa chọn người nhận). Phần riêng (tiêu đề / giờ / nội dung) nằm ở từng dịch vụ.

export type GroupActionDraftInput = Pick<CreateDraftInput, "requester" | "requesterContactId" | "question" | "sourceThreadId" | "sourceMessageId" | "botAccountId">;

export const refuse = (reply: string): CreateDraftResult => ({ reply });

/** Tên nhóm đã gom (bỏ trùng) khi hợp lệ, hoặc câu từ chối cho người dùng. */
export async function precheckGroupAction(
  deps: SendCommandDeps, action: SendActionKind, requester: SendRequester, question: string, groupNames: string[], now: Date,
): Promise<{ names: string[] } | { refusal: CreateDraftResult }> {
  const words = groupActionWords(action)!;
  if (!canIssueSendCommand(requester)) return { refusal: refuse(`${words.commandName} chỉ dành cho người nhận cảnh báo hoặc Quản lý / Trưởng phòng ạ.`) };
  if (await countRecent(deps.db, requester.uid, "draft", new Date(now.getTime() - 3_600_000)) >= MAX_DRAFTS_PER_HOUR) {
    return { refusal: refuse("Anh/chị ra lệnh khá nhiều trong một giờ qua — thử lại sau giúp em nhé.") };
  }
  const names = [...new Map(groupNames.map((name) => [foldName(name), name.trim()] as const)).values()].filter(Boolean);
  if (!names.length) return { refusal: refuse(words.askWhich) };
  if (names.length > MAX_TARGETS) return { refusal: refuse(`Mỗi lệnh tối đa ${MAX_TARGETS} nhóm (anh/chị nêu ${names.length}). Anh/chị chia làm hai lệnh giúp em.`) };
  try {
    assertNamesInQuestion(question, names, words.nameHint);
  } catch (error) {
    if (error instanceof SendCommandInputError) return { refusal: refuse(error.message) };
    throw error;
  }
  return { names };
}

/** Tên → nhóm đích; có tên không hợp lệ thì KHÔNG dựng nháp nào (gom mọi lỗi vào một câu). */
export async function resolveGroupActionTargets(
  deps: SendCommandDeps, action: SendActionKind, requester: SendRequester, names: string[],
): Promise<{ targets: TargetCandidate[] } | { refusal: CreateDraftResult }> {
  const resolveOne: typeof resolveGroupName = (db, name, scope) => resolveGroupName(db, name, scope, action);
  const { targets, problems } = await resolveTargetNames(deps.db, names, await loadGroupScope(deps.db, requester.recipientId), resolveOne);
  if (problems.length) return { refusal: refuse([...problems, "Em chưa tạo lệnh nào. Anh/chị nhắn lại giúp em."].join("\n\n")) };
  return { targets };
}
