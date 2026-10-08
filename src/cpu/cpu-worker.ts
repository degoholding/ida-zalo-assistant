import { parentPort } from "node:worker_threads";
import { extractDocx, extractSheet } from "../assistant/file-reader.js";

// Luồng phụ bóc chữ tệp nặng (xlsx, docx) — chạy ngoài luồng chính để tệp Excel hàng triệu ô không làm đứng việc
// nghe tin Zalo. Nhận { id, task, data }, trả { id, ok, result | error }. Xem src/cpu/cpu-pool.ts.

export type CpuTask = "sheet" | "docx";

export interface CpuRequest {
  id: number;
  task: CpuTask;
  data: Uint8Array;
}

export type CpuResponse =
  | { id: number; ok: true; result: { text: string; summary: string } }
  | { id: number; ok: false; error: string };

function run(task: CpuTask, data: Buffer): { text: string; summary: string } {
  if (task === "sheet") return extractSheet(data);
  return { text: extractDocx(data), summary: "docx" };
}

parentPort?.on("message", (request: CpuRequest) => {
  let response: CpuResponse;
  try {
    const data = Buffer.from(request.data.buffer, request.data.byteOffset, request.data.byteLength);
    response = { id: request.id, ok: true, result: run(request.task, data) };
  } catch (error) {
    response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  parentPort?.postMessage(response);
});
