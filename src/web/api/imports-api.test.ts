import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSentAtMs } from "./imports-api.js";

// Giờ xuất tệp thật của lượt nhập 02/10/2026
const EXPORTED_MS = Date.parse("2026-10-02T06:53:00.000Z");

test("prefers the IndexedDB send time when present", () => {
  assert.equal(resolveSentAtMs({ sendDttm: "1790000000000", cliMsgId: "1790391868086" }, EXPORTED_MS), 1790000000000);
  assert.equal(resolveSentAtMs({ sendDttm: 1790000000000, cliMsgId: "" }, EXPORTED_MS), 1790000000000);
});

// Lỗi gặp thật 02/10/2026: tệp xuất trên Edge không có sendDttm nào, mọi tin bị ghi giờ xuất tệp
test("falls back to cliMsgId, which Zalo sets to the sender clock in ms", () => {
  assert.equal(resolveSentAtMs({ sendDttm: null, cliMsgId: "1790391868086" }, EXPORTED_MS), 1790391868086);
  assert.equal(new Date(resolveSentAtMs({ sendDttm: null, cliMsgId: "1790391868086" }, EXPORTED_MS)).toISOString().slice(0, 10), "2026-09-26");
});

test("treats zero, negative and garbage send times as missing", () => {
  for (const sendDttm of [0, "0", -5, "abc", "", undefined, null]) {
    assert.equal(resolveSentAtMs({ sendDttm, cliMsgId: "1790391868086" }, EXPORTED_MS), 1790391868086);
  }
});

test("rejects cliMsgId values that cannot be a timestamp and uses the export time", () => {
  // Mã tuần tự nhỏ, mốc trước 2012, mốc ở tương lai xa, chữ, rỗng
  for (const cliMsgId of ["123", "1000000000000", String(EXPORTED_MS + 2 * 86_400_000), "abc", "", undefined]) {
    assert.equal(resolveSentAtMs({ sendDttm: null, cliMsgId }, EXPORTED_MS), EXPORTED_MS, `cliMsgId=${cliMsgId}`);
  }
});

test("tolerates a sender clock running up to a day ahead", () => {
  const ahead = EXPORTED_MS + 3 * 60 * 60 * 1000;
  assert.equal(resolveSentAtMs({ sendDttm: null, cliMsgId: String(ahead) }, EXPORTED_MS), ahead);
});

// Phase 14.6: trạng thái ghế đồng bộ Zalo PC đọc qua bot
import { fetchSeatInfo } from "./imports-api.js";

const fakeDb = (rows: Record<string, unknown>[]) => ({ query: async () => [rows, []] }) as unknown as Parameters<typeof fetchSeatInfo>[0];
const fetcherWith = (body: unknown, ok = true) => (async () => ({ ok, status: ok ? 200 : 503, json: async () => body })) as unknown as typeof fetch;

test("seat: không cấu hình thì không hỏi cổng", async () => {
  let called = false;
  const info = await fetchSeatInfo(fakeDb([]), "", (async () => { called = true; return new Response(); }) as typeof fetch);
  assert.deepEqual(info, { configured: false, reachable: false });
  assert.equal(called, false);
});

test("seat: cổng tắt → reachable=false kèm lý do", async () => {
  const info = await fetchSeatInfo(fakeDb([]), "http://127.0.0.1:8099", (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch);
  assert.equal(info.configured, true);
  assert.equal(info.reachable, false);
  assert.match(info.error ?? "", /ECONNREFUSED/);
});

test("seat: đã đăng nhập → rút gọn trạng thái, tiến độ gộp hai giai đoạn, tài khoản gắn bot", async () => {
  const gateway = {
    phase: "main", user: { userId: "627015259726895663", displayName: "Bảo Huỳnh" }, lastQrAt: 0, conversations: 12,
    sync: { ready: true, running: true, progress: { previewAndRecent: 90, other: 10 }, lastResult: null, startedAt: 1000, finishedAt: null },
  };
  const info = await fetchSeatInfo(fakeDb([{ id: 1, label: "bot-chinh" }]), "http://127.0.0.1:8099", fetcherWith(gateway));
  assert.equal(info.reachable, true);
  assert.deepEqual(info.status, {
    phase: "main", user: { userId: "627015259726895663", displayName: "Bảo Huỳnh" }, linked_account: "bot-chinh", conversations: 12, last_qr_at: 0,
    sync: { ready: true, running: true, progress: 50, last_result: null, started_at: 1000, finished_at: null },
    job: null,
  });
});

test("seat: tiến độ việc từ sync-once (POST /job ở cổng) được rút gọn, stage lạ về login", async () => {
  const gateway = {
    phase: "main", user: { userId: "1", displayName: "A" }, lastQrAt: 0, conversations: 5, sync: null,
    job: { account: "bot1", stage: "import", percent: 87, note: null, conversations: { done: 5, total: 5 }, files: { done: 2, total: 4 }, media: 31,
      messages: { imported: 120, duplicates: 7 }, startedAt: 10, updatedAt: 20 },
  };
  const info = await fetchSeatInfo(fakeDb([]), "http://127.0.0.1:8099", fetcherWith(gateway));
  assert.deepEqual(info.status?.job, {
    stage: "import", percent: 87, note: null, error: null, conversations: { done: 5, total: 5 }, files: { done: 2, total: 4 }, media: 31,
    messages: { imported: 120, duplicates: 7 }, started_at: 10, finished_at: null, updated_at: 20,
  });
  const odd = await fetchSeatInfo(fakeDb([]), "http://127.0.0.1:8099", fetcherWith({ ...gateway, job: { stage: "weird", percent: 250 } }));
  assert.equal(odd.status?.job?.stage, "login");
  assert.equal(odd.status?.job?.percent, 100);
});

test("seat: chờ QR → user null, không tra tài khoản", async () => {
  const info = await fetchSeatInfo(fakeDb([]), "http://127.0.0.1:8099", fetcherWith({ phase: "login: chờ quét QR", user: null, lastQrAt: 1794209738903 }));
  assert.equal(info.status?.phase, "login: chờ quét QR");
  assert.equal(info.status?.user, null);
  assert.equal(info.status?.linked_account, null);
  assert.equal(info.status?.last_qr_at, 1794209738903);
  assert.equal(info.status?.sync, null);
});

// Phase 14.9: dịch vụ bật / tắt ghế trên máy chủ nhìn từ bot
import { fetchSeatLauncherInfo, startSeat, stopSeat } from "./imports-api.js";

const launcherFetch = (reply: (url: string, init: RequestInit | undefined) => { status: number; body: unknown }) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    const r = reply(String(url), init);
    return { ok: r.status < 400, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  }) as unknown as typeof fetch;
const LAUNCHER = { url: "http://host:8098", token: "t".repeat(20) };

test("launcher: chưa cấu hình → configured=false, không gọi; can_control theo vai", async () => {
  let called = false;
  const info = await fetchSeatLauncherInfo({ url: "", token: "" }, true, (async () => { called = true; return new Response(); }) as typeof fetch);
  assert.equal(info.configured, false);
  assert.equal(info.can_control, true);
  assert.equal(called, false);
});

test("launcher: gửi token ở header, rút gọn trạng thái; tắt → reachable=false kèm lý do", async () => {
  let seenToken = "";
  const info = await fetchSeatLauncherInfo(LAUNCHER, false, launcherFetch((url, init) => {
    seenToken = String((init?.headers as Record<string, string>)["X-Seat-Token"]);
    assert.match(url, /\/status$/);
    return { status: 200, body: { running: true, account: "ida1", pid: 5, started_at: 10, finished_at: null, exit_code: null, log_tail: ["a", "b"] } };
  }));
  assert.equal(seenToken, LAUNCHER.token);
  assert.deepEqual(info, { configured: true, reachable: true, can_control: false, running: true, account: "ida1", started_at: 10, finished_at: null, exit_code: null, log_tail: ["a", "b"] });
  const down = await fetchSeatLauncherInfo(LAUNCHER, true, (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch);
  assert.equal(down.configured, true);
  assert.equal(down.reachable, false);
  assert.match(down.error ?? "", /Không nối được/);
});

test("startSeat: tên sai bị chặn trước khi gọi; 409 của dịch vụ thành lỗi 409; stopSeat gọi /stop", async () => {
  await assert.rejects(() => startSeat(LAUNCHER, "a b/c", (async () => { throw new Error("không được gọi"); }) as typeof fetch), /Tên tài khoản/);
  await assert.rejects(() => startSeat(LAUNCHER, "ida2", launcherFetch(() => ({ status: 409, body: { error: "Ghế ida1 đang chạy" } }))),
    (error: unknown) => (error as { status: number; message: string }).status === 409 && /đang chạy/.test((error as Error).message));
  const started = await startSeat(LAUNCHER, "ida2", launcherFetch((url, init) => {
    assert.match(url, /\/start$/);
    assert.deepEqual(JSON.parse(String(init?.body)), { account: "ida2" });
    return { status: 200, body: { running: true, account: "ida2", started_at: 1, finished_at: null, exit_code: null, log_tail: [] } };
  }));
  assert.equal(started.account, "ida2");
  const stopped = await stopSeat(LAUNCHER, launcherFetch((url) => { assert.match(url, /\/stop$/); return { status: 200, body: { running: false, account: "ida2", finished_at: 2, exit_code: null, log_tail: [] } }; }));
  assert.equal(stopped.running, false);
});
