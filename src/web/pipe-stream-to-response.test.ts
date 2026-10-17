import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Readable } from "node:stream";
import { pipeStreamToResponse } from "./pipe-stream-to-response.js";

// Dựng máy chủ thật, mỗi yêu cầu chạy một luồng do test cấp
async function withServer(makeStream: () => Readable, run: (port: number, done: Promise<void>) => Promise<void>): Promise<void> {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const server = http.createServer((_request, response) => {
    pipeStreamToResponse(makeStream(), response, { "Content-Type": "text/plain" }).then(finish);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run((server.address() as AddressInfo).port, done);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("luồng bình thường: 200 + đủ nội dung", async () => {
  await withServer(() => Readable.from([Buffer.from("xin "), Buffer.from("chào")]), async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "xin chào");
  });
});

test("luồng rỗng vẫn trả 200", async () => {
  await withServer(() => Readable.from([]), async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "");
  });
});

test("lỗi trước khi có dữ liệu: 500 JSON, không ném lỗi không bắt", async () => {
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown) => uncaught.push(error);
  process.on("uncaughtException", onUncaught);
  try {
    await withServer(
      () => new Readable({ read() { this.destroy(new Error("R2 đứt")); } }),
      async (port, done) => {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        await done;
        assert.equal(res.status, 500);
        const body = await res.json() as { success: boolean; error: { code: string } };
        assert.equal(body.success, false);
        assert.equal(body.error.code, "storage_error");
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(uncaught, []);
  } finally {
    process.off("uncaughtException", onUncaught);
  }
});

test("lỗi giữa chừng: hủy kết nối, không ném lỗi không bắt", async () => {
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown) => uncaught.push(error);
  process.on("uncaughtException", onUncaught);
  try {
    let sent = false;
    await withServer(
      () => new Readable({
        read() {
          if (!sent) { sent = true; this.push(Buffer.from("dở dang")); return; }
          setImmediate(() => this.destroy(new Error("đứt giữa chừng")));
        },
      }),
      async (port, done) => {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal(res.status, 200); // đầu đã gửi cùng chunk đầu
        await assert.rejects(res.text()); // kết nối bị hủy → trình duyệt thấy tệp dở
        await done;
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(uncaught, []);
  } finally {
    process.off("uncaughtException", onUncaught);
  }
});
