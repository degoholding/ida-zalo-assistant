import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { currentPrincipal, SYSTEM_PRINCIPAL } from "../../auth/principal.js";
import { ReplyState } from "../../constants.js";
import { parseKeywordList } from "../../alerts/keyword-matcher.js";
import { recordAudit } from "../../web/api/audit-log.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { threadVisibilitySql } from "../visibility-guards.js";
import type { WriteAction } from "../write/write-action.js";
import { alertRuntimeOf, askerGroupIds, canChangeGlobal, globalChangeDeniedMessage, requireAlertAsker, type AlertAsker } from "./alert-asker-facts.js";

// Hai thao tác ghi của họ `alerts`, đều theo QUAN HỆ của người đang nhắn (`permission: "relationship"`):
// - `alert_item_handled`: «xong tin số N» — GHI NGAY (BC1 bỏ), phạm vi như danh sách «cần xử lý».
// - `alert_config_change`: đổi cấu hình cảnh báo / VIP / giờ bản tin — ghi CHUNG nên đi qua NHÁP (`mcp_write_draft`, hạn 15 phút) → «đồng ý»;
//   thay cho kho đề xuất trong RAM (mất khi khởi động lại). Chép đúng luật + câu xem trước của `proposeChange` / `confirmChange` cũ.

export const ALERT_ITEM_HANDLED_TOOL = "alert_item_handled";
export const ALERT_CONFIG_CHANGE_TOOL = "alert_config_change";
/** Hạn nháp đổi cấu hình: 15 phút như kho RAM cũ. */
export const ALERT_CONFIG_TTL_MS = 15 * 60_000;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const NO_VIP_LIST_MESSAGE = "Anh/chị chưa là người nhận báo nên chưa có danh sách VIP — quản trị thêm ở màn Người nhận.";
const NOT_IN_LIST = "Không có tin này trong danh sách của anh/chị.";

// ---------------------------------------------------------------- Đánh dấu xong

const handledSchema = z.object({ message_id: z.number().int().positive() }).strict();

export const alertItemHandledAction: WriteAction<z.infer<typeof handledSchema>> = {
  tool: ALERT_ITEM_HANDLED_TOOL,
  title: "Đánh dấu tin cần xử lý đã xong",
  description: "Người nhận / quản lý đánh dấu một tin trong danh sách «cần xử lý» của mình đã xong (bot thôi nhắc). Ghi ngay.",
  entity: "recipient",
  permission: "relationship",
  confirmMode: "immediate",
  schema: handledSchema,
  async prepare(ctx, input) {
    const asker = await requireAlertAsker(ctx);
    const groups = await askerGroupIds(ctx, asker);
    const visible = threadVisibilitySql(ctx, "g");
    const [rows] = await ctx.db.query<RowDataPacket[]>(
      `SELECT f.message_id, m.group_id, m.text FROM message_flag f JOIN message m ON m.id = f.message_id JOIN zalo_group g ON g.id = m.group_id
       WHERE f.message_id = ? AND ${visible.sql} AND (f.for_uid IS NULL OR f.for_uid = ?) AND f.pending_ai = 0`, [input.message_id, ...visible.params, asker.uid]);
    if (!rows[0] || (groups && !groups.includes(Number(rows[0].group_id)))) throw new DataAccessError("not_found", NOT_IN_LIST);
    // Trích đầu tin (dữ liệu Zalo, đặt trong «…») để người duyệt nháp biết mình đang đánh dấu tin nào
    const excerpt = String(rows[0].text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
    return { preview: `Đánh dấu xong tin #${input.message_id}${excerpt ? ` «${excerpt}»` : ""}`, targetEntity: "message", targetId: input.message_id, stateToken: "" };
  },
  async execute(ctx, input) {
    const asker = await requireAlertAsker(ctx);
    // Điều kiện «của người này» lặp lại ở UPDATE (như danh sách «cần xử lý»): tin gắn riêng cho người khác / còn chờ AI duyệt không bị đánh dấu xong nhầm
    await ctx.db.query(
      `UPDATE message_flag SET reply_state = ?, handled_at = ?, handled_by_uid = ?, handled_message_id = NULL
       WHERE message_id = ? AND (for_uid IS NULL OR for_uid = ?) AND pending_ai = 0`,
      [ReplyState.Handled, ctx.now, asker.uid, input.message_id, asker.uid]);
    return { entity: "message", id: input.message_id, changed: ["Đã xử lý"], message: "Đã đánh dấu xong — em thôi nhắc tin này." };
  },
};

// ---------------------------------------------------------------- Đổi cấu hình

export const CONFIG_ACTIONS = ["add_vip", "remove_vip", "add_urgent_keyword", "remove_urgent_keyword", "add_important_keyword", "remove_important_keyword",
  "set_brief_times", "set_reply_wait_minutes", "set_vip_wait_minutes"] as const;
export type ConfigAction = (typeof CONFIG_ACTIONS)[number];

const configSchema = z.object({
  action: z.enum(CONFIG_ACTIONS),
  /** add_vip / remove_vip: id Danh bạ — do máy chủ phân giải từ person_uid / tên, không phải tham số của mô hình. */
  contact_id: z.number().int().positive().optional(),
  keyword: z.string().optional(),
  morning: z.string().optional(),
  evening: z.string().optional(),
  minutes: z.number().optional(),
}).strict();
export type ConfigChange = z.infer<typeof configSchema>;

export const isVipAction = (action: ConfigAction) => action === "add_vip" || action === "remove_vip";

interface Planned {
  preview: string;
  /** Người nhận bị đổi (VIP / giờ bản tin); null = cài đặt chung. */
  recipientId: number | null;
}

const invalid = (message: string) => new DataAccessError("invalid_value", message);

/** Kiểm luật + dựng câu xem trước (chép `proposeChange` cũ). */
async function plan(ctx: DataAccessContext, asker: AlertAsker, input: ConfigChange): Promise<Planned> {
  const { action } = input;
  switch (action) {
    case "add_vip":
    case "remove_vip": {
      if (!asker.recipientId) throw new DataAccessError("forbidden", NO_VIP_LIST_MESSAGE);
      const [rows] = await ctx.db.query<RowDataPacket[]>("SELECT COALESCE(NULLIF(display_name, ''), zalo_name) AS name FROM contact WHERE id = ?", [input.contact_id ?? 0]);
      if (!rows[0]) throw new DataAccessError("not_found", "Không tìm thấy người này — dùng find_people lấy đúng person_uid.");
      return { recipientId: asker.recipientId, preview: `${action === "add_vip" ? "Thêm" : "Bỏ"} «${rows[0].name}» ${action === "add_vip" ? "vào" : "khỏi"} danh sách VIP của anh/chị` };
    }
    case "add_urgent_keyword": case "remove_urgent_keyword": case "add_important_keyword": case "remove_important_keyword": {
      if (!canChangeGlobal(asker)) throw new DataAccessError("forbidden", globalChangeDeniedMessage(asker, "từ khóa"));
      const keyword = (input.keyword ?? "").trim().toLowerCase();
      if (!keyword || keyword.length > 60 || /[,;\n]/.test(keyword)) throw invalid("Mỗi lần một từ khóa (tối đa 60 ký tự, không dấu phẩy).");
      return { recipientId: null, preview: `${action.startsWith("add") ? "Thêm" : "Bỏ"} từ khóa ${action.includes("urgent") ? "KHẨN" : "QUAN TRỌNG"} «${keyword}»` };
    }
    case "set_brief_times": {
      if (!asker.recipientId) throw new DataAccessError("forbidden", "Anh/chị chưa là người nhận báo — quản trị thêm ở màn Người nhận.");
      const morning = (input.morning ?? "").trim();
      const evening = (input.evening ?? "").trim();
      if ((morning && !TIME_PATTERN.test(morning)) || (evening && !TIME_PATTERN.test(evening))) throw invalid("Giờ phải dạng HH:MM (vd 07:30).");
      return { recipientId: asker.recipientId, preview: `Giờ bản tin của anh/chị: sáng ${morning || "tắt"}, cuối ngày ${evening || "tắt"}` };
    }
    case "set_reply_wait_minutes": case "set_vip_wait_minutes": {
      if (!canChangeGlobal(asker)) throw new DataAccessError("forbidden", globalChangeDeniedMessage(asker, "thời gian chờ"));
      const minutes = Number(input.minutes);
      const [min, max] = action === "set_vip_wait_minutes" ? [5, 1440] : [10, 2880];
      if (!Number.isInteger(minutes) || minutes < min || minutes > max) throw invalid(`Số phút từ ${min} đến ${max}.`);
      return { recipientId: null, preview: `${action === "set_vip_wait_minutes" ? "Tin VIP" : "Tin chờ trả lời"} chưa ai trả lời sau ${minutes} phút giờ làm việc thì nhắc` };
    }
  }
}

/** Dựng nháp (dùng ở công cụ propose): kiểm luật + câu xem trước + đích của nháp. */
export async function prepareConfigChange(ctx: DataAccessContext, input: ConfigChange) {
  const asker = await requireAlertAsker(ctx);
  const planned = await plan(ctx, asker, input);
  return {
    preview: planned.preview, targetEntity: planned.recipientId ? "recipient" : "setting", targetId: planned.recipientId,
    // Không có trạng thái đích để «lạc hậu»: cài đặt / VIP ghi theo kiểu gộp (thêm / bỏ một phần tử, đặt một giá trị)
    stateToken: "",
  };
}

async function applyChange(ctx: DataAccessContext, asker: AlertAsker, input: ConfigChange, preview: string): Promise<void> {
  const runtime = alertRuntimeOf(ctx);
  if (!ctx.saveSettings || !runtime) throw new DataAccessError("invalid_state", "Bot chưa bật lưu cấu hình cảnh báo qua trợ lý.");
  const { db } = ctx;
  const actor = `${asker.name} (qua Zalo)`;
  const audit = () => recordAudit(db, { entity: "recipient", entityId: Number(asker.recipientId), action: "update", message: preview });
  await currentPrincipal.run({ ...SYSTEM_PRINCIPAL, fullName: actor }, async () => {
    switch (input.action) {
      case "add_vip":
        await db.query("INSERT IGNORE INTO recipient_vip (recipient_id, contact_id) VALUES (?, ?)", [asker.recipientId, input.contact_id]);
        await audit();
        break;
      case "remove_vip":
        await db.query("DELETE FROM recipient_vip WHERE recipient_id = ? AND contact_id = ?", [asker.recipientId, input.contact_id]);
        await audit();
        break;
      case "set_brief_times": {
        const sets: string[] = [];
        const values: unknown[] = [];
        if (input.morning !== undefined) { sets.push("morning_brief_at = ?"); values.push(input.morning.trim()); }
        if (input.evening !== undefined) { sets.push("evening_brief_at = ?"); values.push(input.evening.trim()); }
        if (sets.length) await db.query(`UPDATE recipient SET ${sets.join(", ")} WHERE id = ?`, [...values, asker.recipientId]);
        await audit();
        break;
      }
      case "set_reply_wait_minutes":
        await ctx.saveSettings!({ alert_reply_wait_minutes: input.minutes }, actor);
        break;
      case "set_vip_wait_minutes":
        await ctx.saveSettings!({ alert_vip_wait_minutes: input.minutes }, actor);
        break;
      default: {
        const urgent = input.action.includes("urgent");
        const snapshot = runtime.settings();
        const current = parseKeywordList(urgent ? snapshot.urgentKeywords : snapshot.importantKeywords);
        const word = (input.keyword ?? "").trim().toLowerCase();
        const next = input.action.startsWith("add") ? [...new Set([...current, word])] : current.filter((item) => item !== word);
        await ctx.saveSettings!({ [urgent ? "alert_urgent_keywords" : "alert_important_keywords"]: next.join(", ") }, actor);
      }
    }
  });
  runtime.invalidate();
}

export const alertConfigChangeAction: WriteAction<ConfigChange> = {
  tool: ALERT_CONFIG_CHANGE_TOOL,
  title: "Đổi cấu hình cảnh báo / VIP",
  description: "Người nhận / quản lý đổi VIP của mình, từ khóa KHẨN / QUAN TRỌNG, giờ bản tin, số phút chờ nhắc. Ghi chung nên qua nháp + «đồng ý».",
  entity: "recipient",
  permission: "relationship",
  ttlMs: ALERT_CONFIG_TTL_MS,
  schema: configSchema,
  prepare: prepareConfigChange,
  async execute(ctx, input) {
    const asker = await requireAlertAsker(ctx);
    const { preview } = await prepareConfigChange(ctx, input);
    await applyChange(ctx, asker, input, preview);
    return { entity: isVipAction(input.action) || input.action === "set_brief_times" ? "recipient" : "setting", id: asker.recipientId, changed: [preview], message: `Đã đổi: ${preview}.` };
  },
};
