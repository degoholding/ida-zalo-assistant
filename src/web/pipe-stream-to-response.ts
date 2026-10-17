import type http from "node:http";
import type { Readable } from "node:stream";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { createLogger, describeError } from "../logger.js";

const log = createLogger("web");

/** Chờ bộ đệm ghi thông; máy khách ngắt thì dừng chờ (vòng lặp sau sẽ thấy response.destroyed). */
async function waitDrainOrClose(response: http.ServerResponse): Promise<void> {
  const abort = new AbortController();
  try {
    await Promise.race([once(response, "drain", { signal: abort.signal }), once(response, "close", { signal: abort.signal })]);
  } finally {
    abort.abort();
  }
}

/**
 * Đẩy luồng (đĩa / R2) ra phản hồi HTTP mà không bao giờ ném lỗi 'error' không bắt.
 * Đầu phản hồi (status + headers) chỉ gửi khi có dữ liệu đầu tiên → lỗi trước đó trả được JSON 500 đúng kiểu API;
 * lỗi giữa chừng (đã gửi đầu) thì hủy kết nối để trình duyệt biết tệp dở. Chỉ log một lần.
 */
export async function pipeStreamToResponse(
  source: Readable,
  response: http.ServerResponse,
  headers: http.OutgoingHttpHeaders,
  label = "tệp",
): Promise<void> {
  let headSent = false;
  const sendHead = (): void => {
    if (headSent) return;
    headSent = true;
    response.writeHead(200, headers);
  };
  try {
    // Không đưa response làm đích pipeline: pipeline hủy mọi luồng khi lỗi → không còn ghi nổi JSON 500
    await pipeline(source, async (chunks: AsyncIterable<Buffer | string>) => {
      for await (const chunk of chunks) {
        if (response.destroyed) throw Object.assign(new Error("máy khách đã ngắt"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
        sendHead();
        if (!response.write(chunk)) await waitDrainOrClose(response);
      }
      sendHead(); // luồng rỗng vẫn phải trả 200
      response.end();
    });
  } catch (error) {
    // Máy khách tự ngắt giữa chừng không phải lỗi máy chủ
    const code = (error as NodeJS.ErrnoException)?.code;
    const aborted = code === "ERR_STREAM_PREMATURE_CLOSE" || code === "EPIPE" || code === "ECONNRESET";
    if (!aborted) log.error(`truyền ${label} lỗi: ${describeError(error)}`);
    source.destroy();
    if (!response.headersSent && !response.destroyed) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ success: false, error: { code: "storage_error", message: "Không đọc được tệp từ kho" } }));
    } else if (!response.destroyed) {
      response.destroy();
    }
  }
}
