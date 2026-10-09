import assert from "node:assert/strict";
import { test } from "node:test";
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
