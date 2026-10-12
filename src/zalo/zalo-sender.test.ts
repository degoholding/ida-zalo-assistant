import assert from "node:assert/strict";
import { test } from "node:test";
import { BotHaltedError } from "../messaging/bot-halted-error.js";
import { ZaloSender } from "./zalo-sender.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// Giả lập 09/10/2026: 100 nhóm cùng gọi bot, tin «chờ em xíu» chen trước câu trả lời → nhóm cuối chờ ~5 phút
test("câu trả lời (tin thường) đi trước tin phụ «chờ em xíu» đang chờ, cùng mức thì theo thứ tự đến", async () => {
  const sender = new ZaloSender(0);
  const order: string[] = [];
  const sent = (name: string) => async () => { order.push(name); };
  const first = sender.send(sent("trả lời 1"));
  const acks = [sender.send(sent("chờ A"), "low"), sender.send(sent("chờ B"), "low")];
  const answers = [sender.send(sent("trả lời 2")), sender.send(sent("trả lời 3"))];
  await Promise.all([first, ...acks, ...answers]);
  assert.deepEqual(order, ["trả lời 1", "trả lời 2", "trả lời 3", "chờ A", "chờ B"]);
});

test("sendIfQuiet: hàng gửi đang đông (quá 2 tin) thì bỏ tin phụ, trả null, không xếp hàng", async () => {
  const sender = new ZaloSender(0);
  let release: () => void = () => {};
  const blocker = sender.send(() => new Promise<void>((resolve) => { release = resolve; }));
  const queued = [sender.send(async () => {}), sender.send(async () => {})];
  await tick();
  assert.equal(sender.pending, 3);
  let ran = false;
  assert.equal(await sender.sendIfQuiet(async () => { ran = true; return "đã nhắn"; }), null);
  release();
  await Promise.all([blocker, ...queued]);
  assert.equal(ran, false);
  // Hàng rảnh thì tin phụ vẫn gửi như cũ (ngày thường vẫn nhắn «chờ em xíu»)
  assert.equal(await sender.sendIfQuiet(async () => "đã nhắn"), "đã nhắn");
});

test("lỗi của một tin (kể cả ném ngay khi gọi) chỉ về nơi gọi, các tin sau vẫn gửi", async () => {
  const sender = new ZaloSender(0);
  const failsAsync = sender.send(async () => { throw new Error("Zalo từ chối"); });
  const failsSync = sender.send((() => { throw new Error("ném ngay"); }) as () => Promise<void>);
  const after = sender.send(async () => "vẫn gửi");
  await assert.rejects(failsAsync, /Zalo từ chối/);
  await assert.rejects(failsSync, /ném ngay/);
  assert.equal(await after, "vẫn gửi");
  assert.equal(sender.pending, 0);
});

test("giữ khoảng cách tối thiểu giữa hai tin", async () => {
  const sender = new ZaloSender(40);
  const times: number[] = [];
  await Promise.all([1, 2, 3].map(() => sender.send(async () => { times.push(Date.now()); })));
  assert.ok(times[1] - times[0] >= 35 && times[2] - times[1] >= 35, `khoảng cách ${times[1] - times[0]}, ${times[2] - times[1]} ms`);
});

test("việc tự bỏ (trả null — vd «chờ em xíu» mà đã trả lời rồi) không chiếm khoảng giãn cách của hàng gửi", async () => {
  const sender = new ZaloSender(60);
  const started = Date.now();
  await sender.send(async () => "tin 1");
  await Promise.all([sender.send(async () => null, "low"), sender.send(async () => null, "low")]);
  const sentAt: number[] = [];
  await sender.send(async () => { sentAt.push(Date.now()); return "tin 2"; });
  // Tin 2 chỉ chờ đúng 1 khoảng giãn cách sau tin 1, không cộng thêm 2 lượt bỏ
  assert.ok(sentAt[0] - started < 110, `tin 2 gửi sau ${sentAt[0] - started} ms`);
});

// Tắt bot khẩn (phase 9)
test("bot đang tắt: tin đã xếp sẵn bị từ chối BotHaltedError ngay, không gọi Zalo, không tốn giãn cách", async () => {
  let halted = false;
  const sender = new ZaloSender(200, () => halted);
  const calls: string[] = [];
  const first = sender.send(async () => { calls.push("tin 1"); });
  const queued = [sender.send(async () => { calls.push("tin 2"); }), sender.send(async () => { calls.push("tin 3"); }, "low")];
  await first;
  halted = true;
  const started = Date.now();
  const results = await Promise.allSettled(queued);
  assert.ok(results.every((result) => result.status === "rejected" && result.reason instanceof BotHaltedError));
  assert.deepEqual(calls, ["tin 1"]);
  // Từ chối ngay, không chờ khoảng giãn cách 200 ms của từng tin
  assert.ok(Date.now() - started < 260, `từ chối sau ${Date.now() - started} ms`);
  assert.equal(sender.pending, 0);
});

test("bot đang tắt: tin gửi mới bị từ chối, tin mức control vẫn đi và chen đầu hàng", async () => {
  let halted = true;
  const sender = new ZaloSender(0, () => halted);
  await assert.rejects(sender.send(async () => "x"), BotHaltedError);
  await assert.rejects(sender.send(async () => "x", "low"), BotHaltedError);
  assert.equal(await sender.send(async () => "đã tắt", "control"), "đã tắt");
  // Bật lại thì tin thường đi bình thường
  halted = false;
  assert.equal(await sender.send(async () => "ok"), "ok");
});

test("mức control chen trước tin thường và tin phụ đang chờ", async () => {
  const sender = new ZaloSender(0);
  const order: string[] = [];
  const sent = (name: string) => async () => { order.push(name); };
  const first = sender.send(sent("đang gửi"));
  const rest = [sender.send(sent("thường"), "normal"), sender.send(sent("phụ"), "low"), sender.send(sent("control"), "control")];
  await Promise.all([first, ...rest]);
  assert.deepEqual(order, ["đang gửi", "control", "thường", "phụ"]);
});
