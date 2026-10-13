import { ReplyTemplateStatus, ReplyTone } from "../constants.js";
import type { ReplyTemplate } from "./reply-suggestion-types.js";

// Dựng mẫu tin cho bài kiểm (chỉ test import).
export function makeTemplate(patch: Partial<ReplyTemplate>): ReplyTemplate {
  return {
    id: 1, tenantId: 1, name: "Mẫu", situation: "", keywords: [], body: "Nội dung mẫu", tone: ReplyTone.Formal, status: ReplyTemplateStatus.Approved,
    authorUserId: null, authorName: "", reviewerUserId: null, reviewerName: "", reviewNote: "", submittedAt: null, reviewedAt: null,
    createdAt: new Date(0), updatedAt: new Date(0), ...patch,
  };
}
