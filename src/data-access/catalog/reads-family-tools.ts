import { conversationWithPersonExternalTool, conversationWithPersonTool } from "../operations/conversation-with-person-operation.js";
import { findPeopleExternalTool, findPeopleTool } from "../operations/find-people-operation.js";
import { contactDirectoryPresenterTool } from "../reads/contact-directory-presenter.js";
import { groupContextCommandTool } from "../reads/group-context-presenter.js";
import { groupListPresenterTool } from "../reads/group-list-presenter.js";
import { groupMessagesPresenterTool } from "../reads/group-messages-presenter.js";
import { searchMessagesModelTool } from "../reads/search-messages-model-tool.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import type { FamilyCatalog } from "./family-catalog.js";

// Họ `reads` (phase 6 plan «trợ lý qua MCP»): đọc nhóm / tin / người / Danh bạ / ngữ cảnh nhóm.
// - Mặt `assistant_model` (6 công cụ, tên + khai báo GIỮ NGUYÊN công cụ cũ): search_messages (bản riêng của trợ lý, cùng lõi tìm với bản của cổng ngoài),
//   list_groups, get_group_messages, list_contacts (trình bày CHỮ như cũ, trên cùng chốt chặn phạm vi) + find_people, get_conversation_with_person.
// - Mặt `mcp_http`: find_people, get_conversation_with_person là năng lực MỚI mở cho MCP ngoài (cổng /mcp) — định nghĩa RIÊNG có UNTRUSTED_NOTICE + untrusted_fields (bản mô hình giữ chữ cũ).
// - Mặt `assistant_command`: group_context (ngữ cảnh nhóm đang hỏi — lệnh của máy chủ, mô hình không thấy).
// Họ chưa có lời nhắc riêng: lời nhắc dùng các công cụ này nằm trong lời nhắc hệ thống chung (không thuộc họ nào) nên `instructions` để trống.

const erase = <I, O>(tool: ToolDefinition<I, O>): AnyToolDefinition => eraseTool(tool);

export const readsFamilyCatalog: FamilyCatalog = {
  family: "reads",
  tools: [
    erase(searchMessagesModelTool),
    erase(groupListPresenterTool),
    erase(groupMessagesPresenterTool),
    // Bản cổng ngoài (có dặn dữ liệu không đáng tin) đứng TRƯỚC bản mô hình cùng tên: tra theo tên (họ / dạng lỗi) lấy bản đứng sau = bản mô hình
    erase(findPeopleExternalTool),
    erase(conversationWithPersonExternalTool),
    erase(findPeopleTool),
    erase(conversationWithPersonTool),
    erase(contactDirectoryPresenterTool),
    erase(groupContextCommandTool),
  ],
  actions: [],
  instructions: "",
};
