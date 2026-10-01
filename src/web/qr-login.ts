import crypto from "node:crypto";
import { LoginQRCallbackEventType, Zalo } from "zca-js";
import { encryptJson } from "../crypto/session-cipher.js";
import { createLogger, describeError } from "../logger.js";
import type { SyncService } from "../sync-service.js";
import { recordSessionEvent, saveLoggedInAccount } from "../zalo/bot-account-repository.js";
import { SessionEvent } from "../constants.js";

// Đăng nhập QR từ trình duyệt: máy chủ gọi zca-js, ảnh QR đưa lên trang, trang hỏi trạng thái
// vài giây một lần. Quét xong thì lưu phiên (mã hóa) và chạy bot ngay, không phải khởi động lại.

export type QrLoginPhase = "starting" | "waiting_scan" | "scanned" | "success" | "failed";

export interface QrLoginState {
  id: string;
  label: string;
  phase: QrLoginPhase;
  qrImage: string; // data URL
  scannedBy: string;
  message: string;
  startedAt: number;
}

// zca-js tự hết hạn mã QR sau ~100 giây; sinh lại tối đa ngần này lần rồi thôi
const MAX_QR_ROUNDS = 3;
// Trạng thái giữ lại để trang kịp đọc kết quả cuối, sau đó dọn
const STATE_TTL_MS = 10 * 60 * 1000;

const log = createLogger("qr-login");

export class QrLoginManager {
  private readonly attempts = new Map<string, QrLoginState>();

  constructor(private readonly service: SyncService) {}

  get(id: string): QrLoginState | null {
    return this.attempts.get(id) ?? null;
  }

  /** Mỗi nhãn chỉ một lượt quét cùng lúc — bấm hai lần không đẻ hai phiên đăng nhập. */
  start(label: string): QrLoginState {
    for (const state of this.attempts.values()) {
      if (state.label === label && (state.phase === "starting" || state.phase === "waiting_scan" || state.phase === "scanned")) {
        return state;
      }
    }
    const state: QrLoginState = {
      id: crypto.randomBytes(12).toString("hex"),
      label,
      phase: "starting",
      qrImage: "",
      scannedBy: "",
      message: "Đang lấy mã QR từ Zalo…",
      startedAt: Date.now(),
    };
    this.attempts.set(state.id, state);
    setTimeout(() => this.attempts.delete(state.id), STATE_TTL_MS).unref();
    this.run(state).catch((error) => this.fail(state, describeError(error)));
    return state;
  }

  private fail(state: QrLoginState, message: string): void {
    // Đã báo lỗi dễ hiểu (từ chối, hết hạn) thì đừng để lỗi "aborted" của zca-js ghi đè
    if (state.phase === "success" || state.phase === "failed") return;
    state.phase = "failed";
    state.qrImage = "";
    state.message = message;
    log.warn(`đăng nhập «${state.label}» không thành: ${message}`);
  }

  private async run(state: QrLoginState): Promise<void> {
    const { db, config } = this.service;
    let rounds = 0;
    let loginInfo: unknown = null;

    const api = await new Zalo({ selfListen: false, checkUpdate: false, logging: false }).loginQR({}, (event) => {
      switch (event.type) {
        case LoginQRCallbackEventType.QRCodeGenerated:
          rounds += 1;
          state.phase = "waiting_scan";
          state.qrImage = `data:image/png;base64,${event.data.image}`;
          state.message = "Mở app Zalo của tài khoản bot → biểu tượng QR → quét mã này.";
          break;
        case LoginQRCallbackEventType.QRCodeExpired:
          // Không gọi retry/abort thì zca-js treo mãi
          if (rounds < MAX_QR_ROUNDS) event.actions.retry();
          else {
            this.fail(state, "Mã QR hết hạn nhiều lần — bấm đăng nhập lại khi sẵn sàng.");
            event.actions.abort();
          }
          break;
        case LoginQRCallbackEventType.QRCodeScanned:
          state.phase = "scanned";
          state.scannedBy = event.data.display_name;
          state.qrImage = "";
          state.message = `«${event.data.display_name}» đã quét — bấm Đăng nhập trên điện thoại.`;
          break;
        case LoginQRCallbackEventType.QRCodeDeclined:
          // zca-js bỏ lửng promise ở nhánh này — phải tự hủy
          this.fail(state, "Điện thoại đã từ chối đăng nhập.");
          event.actions.abort();
          break;
        case LoginQRCallbackEventType.GotLoginInfo:
          loginInfo = event.data;
          break;
      }
    });

    if (!loginInfo) throw new Error("Đăng nhập xong nhưng Zalo không trả phiên");
    const ownUid = api.getOwnId();
    const profile = await api.fetchAccountInfo().catch(() => null);
    const displayName =
      (profile as { profile?: { displayName?: string } } | null)?.profile?.displayName || state.scannedBy;
    const accountId = await saveLoggedInAccount(db, state.label, ownUid, displayName,
      encryptJson(loginInfo, config.sessionEncryptionKey));
    await recordSessionEvent(db, accountId, SessionEvent.LoginQrOk);
    // Phiên QR này chỉ dùng để lấy cookie; bot chạy bằng phiên mới nạp từ DB
    api.listener.stop();

    const started = await this.service.restartAccount(accountId);
    state.phase = started ? "success" : "failed";
    state.message = started
      ? `Đã đăng nhập «${displayName}» và bắt đầu nghe các nhóm.`
      : "Đã lưu phiên nhưng không khởi động được bot — xem log máy chủ.";
    log.info(`«${state.label}» đăng nhập QR xong (uid ${ownUid})`);
  }
}
