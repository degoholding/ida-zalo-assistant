import { GroupMessage, type API } from "zca-js";
import { createLogger } from "../logger.js";

const log = createLogger("zalo:history");

// Lịch sử nhóm qua đường Zalo Web ĐANG dùng: `/api/cm/getrecentv2` (phân trang bằng lastMsgId, 50 tin/trang).
// Đường cũ `/api/group/history` của zca-js 2.2.0 trả 404 từ ~06/2026 (issue #356/#367/#374); bản vá PR #370
// chưa được gộp nên tự gọi qua cửa `api.custom` — cùng phiên, cùng mã hóa với thư viện.

export const HISTORY_PAGE_SIZE = 50;
const CUSTOM_NAME = "fetchGroupHistoryPage";

export interface HistoryPage {
  messages: GroupMessage[];
  /** Mốc cho trang kế (tin cũ hơn); "" khi hết. */
  lastMsgId: string;
  /** Mã tin mới nhất Zalo đang giữ — mốc 0 không trả tin, phải bắt đầu từ đây. */
  maxMsgId: string;
  hasMore: boolean;
}

interface HistoryPageProps {
  groupId: string;
  /** 0 = trang mới nhất; sau đó là `lastMsgId` của trang trước. */
  globalMsgId: number;
}

interface RawHistoryPage {
  groupMsgs?: Record<string, unknown>[];
  lastMsgId?: string | number;
  maxMsgId?: string | number;
  hasMore?: boolean | number;
}

type HistoryFetcher = (props: HistoryPageProps) => Promise<HistoryPage>;

/** Đăng ký (một lần cho mỗi phiên) rồi trả về hàm lấy một trang lịch sử của nhóm. */
export function registerGroupHistoryApi(api: API): (groupId: string, globalMsgId: number) => Promise<HistoryPage> {
  const registry = api as unknown as Record<string, HistoryFetcher | undefined>;
  if (!registry[CUSTOM_NAME]) {
    api.custom<HistoryPage, HistoryPageProps>(CUSTOM_NAME, async ({ ctx, utils, props }) => {
      // Bảng dịch vụ nằm trên `api` (zca-js gắn lúc đăng nhập), KHÔNG nằm trong ctx của custom
      const base = api.zpwServiceMap?.group_cloud_message?.[0];
      if (!base) throw new Error("phiên chưa có địa chỉ dịch vụ group_cloud_message");
      // Zalo Web: trang mới nhất = getrecentv2, các trang CŨ HƠN = getoldv2 (cùng tham số, globalMsgId = mốc)
      const path = props.globalMsgId ? "getoldv2" : "getrecentv2";
      const serviceURL = utils.makeURL(`${base}/api/cm/${path}`);
      const params: Record<string, unknown> = {
        // Zalo Web gửi mã nhóm KHÔNG có tiền tố «g»
        groupId: props.groupId.replace(/^g/, ""),
        // Zalo Web gửi globalMsgId dạng CHUỖI ("0" cho trang mới nhất) và src = -1
        globalMsgId: String(props.globalMsgId),
        count: HISTORY_PAGE_SIZE,
        msgIds: [],
        imei: ctx.imei,
        src: -1,
      };
      const encrypted = utils.encodeAES(JSON.stringify(params));
      if (!encrypted) throw new Error("không mã hóa được tham số");
      const response = await utils.request(utils.makeURL(serviceURL, { params: encrypted, nretry: 0 }), { method: "GET" });
      return utils.resolve(response, (result) => {
        let data = result.data as RawHistoryPage | string;
        if (typeof data === "string") data = JSON.parse(data) as RawHistoryPage;
        // Ghi các cờ Zalo trả (không ghi nội dung tin) — để biết vì sao trang rỗng (lọc theo ngày vào nhóm?)
        const { groupMsgs, ...flags } = data;
        log.info(`${path} nhóm ${props.groupId} mốc ${props.globalMsgId}: ${groupMsgs?.length ?? 0} tin, cờ ${JSON.stringify(flags)}`);
        return {
          messages: (data.groupMsgs ?? []).map((raw) => new GroupMessage(ctx.uid, raw as ConstructorParameters<typeof GroupMessage>[1])),
          lastMsgId: data.lastMsgId === undefined || data.lastMsgId === null ? "" : String(data.lastMsgId),
          maxMsgId: data.maxMsgId === undefined || data.maxMsgId === null ? "" : String(data.maxMsgId),
          hasMore: Boolean(Number(data.hasMore)),
        };
      });
    });
  }
  const fetcher = registry[CUSTOM_NAME]!;
  return (groupId, globalMsgId) => fetcher({ groupId, globalMsgId });
}
