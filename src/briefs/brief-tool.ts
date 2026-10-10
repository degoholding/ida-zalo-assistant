import type { AlertAsker } from "../assistant/alert-tools.js";
import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import type { BriefRequestKind } from "./brief-command-parser.js";
import { runBriefCommand, type BriefChatDeps } from "./brief-commands.js";

// Công cụ AI `send_brief` (phase 4) — cho câu gọi bản tin / báo cáo mà `brief-command-parser.ts` không khớp (câu dài
// hơn, cách nói khác «bản tin sáng» / «báo cáo tuần»…). Chạy lại ĐÚNG `runBriefCommand` nên luật (chỉ người nhận, trần
// gọi / giờ, không trả nguyên chữ bản tin cho mô hình) giống hệt lệnh gõ — chỉ đổi câu trả lời cho mô hình đọc lại.

const KINDS = new Set<BriefRequestKind>(["morning", "evening", "weekly", "monthly"]);
const KIND_LABELS: Record<string, string> = { morning: "bản tin sáng", evening: "bản tin cuối ngày", weekly: "báo cáo tuần", monthly: "báo cáo tháng" };

/** Luật hướng dẫn thêm vào system prompt khi người hỏi có công cụ này (người hỏi là người nhận, tin riêng). */
export const BRIEF_TOOL_PROMPT = `

BẢN TIN, BÁO CÁO (người hỏi là người nhận bản tin): câu đã khớp sẵn bot tự trả lời, không tới lượt bạn. Câu hỏi
tương tự nhưng diễn đạt khác («cho anh bản tin của hôm nay», «anh muốn xem báo cáo tháng trước») → send_brief NGAY, rồi
báo ngắn gọn 1 câu là đang gửi — KHÔNG đọc lại nội dung bản tin (bạn không có nội dung đó).`;

export const SEND_BRIEF_DECLARATION: FunctionDeclaration = {
  name: "send_brief",
  description:
    "Gửi NGAY bản tin sáng / cuối ngày hoặc báo cáo tuần / tháng cho CHÍNH người đang hỏi — chỉ dùng khi câu hỏi " +
    "KHÔNG khớp các cụm ngắn «bản tin sáng», «báo cáo tuần»… (những câu đó bot đã tự trả lời, không tới lượt công cụ " +
    "này). Nội dung (chữ bản tin, hoặc tóm tắt + tệp PDF/Excel) gửi qua tin nhắn riêng ngay sau — KHÔNG đọc lại nội " +
    "dung cho người hỏi, chỉ xác nhận ngắn gọn là đang gửi.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...KINDS], description: "morning = sáng, evening = cuối ngày, weekly = báo cáo tuần, monthly = báo cáo tháng" },
      period: { type: "string", enum: ["current", "previous"], description: "Chỉ weekly/monthly: current = kỳ này (tới hiện tại), previous = kỳ trước đã xong (mặc định, bỏ trống cũng được)" },
    },
    required: ["kind"],
  },
};

/** `asker` không phải người nhận (hoặc hỏi trong nhóm — context.brief/briefAsker chỉ gắn khi tin riêng) → báo lỗi. */
export async function runSendBriefTool(
  deps: BriefChatDeps | undefined, asker: AlertAsker | undefined, args: Record<string, unknown>, now: Date,
): Promise<Record<string, unknown>> {
  if (!deps || !asker?.recipientId) return { error: "Công cụ này chỉ dùng được khi người hỏi là người nhận bản tin, trong tin riêng." };
  const kind = String(args.kind ?? "");
  if (!KINDS.has(kind as BriefRequestKind)) return { error: "kind phải là morning / evening / weekly / monthly." };
  const variant = args.period === "current" ? "current" as const : "standard" as const;
  const reply = await runBriefCommand(deps, asker, { kind: "brief_request", request: kind as BriefRequestKind, variant }, now);
  // reply rỗng = đã xếp hàng gửi; khác rỗng = câu từ chối / báo lỗi — trả cho mô hình đọc lại nguyên văn
  if (reply) return { error: reply };
  return { queued: true, label: KIND_LABELS[kind] };
}
