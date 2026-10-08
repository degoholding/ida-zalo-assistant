import type http from "node:http";
import type { Principal } from "../../auth/principal.js";
import type { SessionStore } from "../../auth/session-store.js";
import type { SyncService } from "../../sync-service.js";
import type { QrLoginManager } from "../qr-login.js";

// Kiểu dùng chung của các tệp `*-api.ts`. Mỗi phân hệ khai một mảng tuyến; `api-router.ts` gom lại.

export interface ApiContext {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  url: URL;
  match: RegExpExecArray;
  service: SyncService;
  qrLogins: QrLoginManager;
  /** Người đang thao tác (phase 4) — quyền + phạm vi nhóm. */
  principal: Principal;
  sessions: SessionStore;
}

export type ApiHandler = (ctx: ApiContext) => Promise<void>;

/** [phương thức, mẫu đường dẫn, xử lý] — thêm màn mới = thêm dòng ở tệp của phân hệ đó. */
export type ApiRoute = [method: "GET" | "POST" | "PATCH" | "DELETE", pattern: RegExp, handler: ApiHandler];
