import assert from "node:assert/strict";
import { test } from "node:test";
import { McpCallStatus } from "../constants.js";
import { admin, fakeDb, staff } from "../data-access/data-access-test-support.js";
import { connectTestClient } from "./mcp-test-support.js";

// Client SDK trong tiến trình gọi handler SDK thật qua `handler.fetch` — không DB, không cổng mạng.

const textOf = (result: { content?: unknown }) => ((result.content as { text: string }[])[0]).text;

test("tools/list theo vai trò: Nhân viên không có metrics_summary, Quản trị đủ 7, không công cụ ghi", async () => {
  const staffRig = await connectTestClient(staff());
  const adminRig = await connectTestClient(admin());
  try {
    const staffTools = (await staffRig.client.listTools()).tools.map((tool) => tool.name);
    const adminTools = (await adminRig.client.listTools()).tools.map((tool) => tool.name);
    for (const name of ["whoami", "describe_entities", "query_records", "search_messages", "get_thread_messages", "get_file_text", "metrics_summary", "find_people", "get_conversation_with_person", "search_files"]) {
      assert.ok(adminTools.includes(name), `thiếu ${name}`);
    }
    assert.ok(adminTools.includes("metrics_summary"));
    assert.ok(!staffTools.includes("metrics_summary"));
    assert.ok(staffTools.includes("search_files") && staffTools.includes("find_people"));
    assert.ok(adminTools.every((name) => !/write|confirm|draft/.test(name)));
    const queryTool = (await adminRig.client.listTools()).tools.find((tool) => tool.name === "query_records");
    assert.equal(queryTool?.annotations?.readOnlyHint, true);
    assert.equal(queryTool?.annotations?.openWorldHint, false);
    assert.equal(adminRig.logs.length, 0, "tools/list không ghi nhật ký gọi");
  } finally {
    await staffRig.close();
    await adminRig.close();
  }
});

test("tools/call whoami: thành công, có structuredContent, ghi đúng 1 dòng nhật ký (Ok)", async () => {
  const rig = await connectTestClient(staff());
  try {
    const result = await rig.client.callTool({ name: "whoami", arguments: {} });
    assert.ok(!result.isError);
    assert.match(textOf(result), /Người thử/);
    assert.equal((result.structuredContent as { access_level: string }).access_level, "read");
    assert.equal(rig.logs.length, 1);
    assert.deepEqual([rig.logs[0].tool, rig.logs[0].status, rig.logs[0].keyId, rig.logs[0].userId, rig.logs[0].clientIp], ["whoami", McpCallStatus.Ok, 5, 7, "203.0.113.9"]);
  } finally {
    await rig.close();
  }
});

test("sai DSL (trường lạ) → isError kèm mã lỗi, nhật ký Invalid", async () => {
  const rig = await connectTestClient(admin());
  try {
    const result = await rig.client.callTool({ name: "query_records", arguments: { entity: "tasks", filters: [{ field: "khong_co", op: "eq", value: 1 }] } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /invalid_field/);
    assert.equal(rig.logs.length, 1);
    assert.equal(rig.logs[0].status, McpCallStatus.Invalid);
    assert.equal(rig.logs[0].errorCode, "invalid_field");
  } finally {
    await rig.close();
  }
});

test("đầu vào sai sơ đồ (SDK không tự chặn) → isError invalid_value VÀ vẫn có dòng nhật ký", async () => {
  const rig = await connectTestClient(admin());
  try {
    const result = await rig.client.callTool({ name: "query_records", arguments: { entity: "khong_co" } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /invalid_value/);
    assert.deepEqual(rig.logs.map((entry) => [entry.status, entry.errorCode]), [[McpCallStatus.Invalid, "invalid_value"]]);
  } finally {
    await rig.close();
  }
});

test("công cụ khóa này không có → lỗi, không chạy (Nhân viên gọi metrics_summary)", async () => {
  const rig = await connectTestClient(staff());
  try {
    const outcome = await rig.client.callTool({ name: "metrics_summary", arguments: {} }).then((result) => ({ result }), (error: unknown) => ({ error }));
    const failed = "error" in outcome || outcome.result.isError === true;
    assert.ok(failed, "gọi công cụ không đăng ký phải lỗi");
    assert.ok(!rig.logs.some((entry) => entry.status === McpCallStatus.Ok));
  } finally {
    await rig.close();
  }
});

test("vượt nhịp: lượt thứ 3 khi giới hạn 2/phút → isError rate_limited, nhật ký RateLimited", async () => {
  const rig = await connectTestClient(staff(), { perMinute: 2 });
  try {
    await rig.client.callTool({ name: "whoami", arguments: {} });
    await rig.client.callTool({ name: "whoami", arguments: {} });
    const third = await rig.client.callTool({ name: "whoami", arguments: {} });
    assert.equal(third.isError, true);
    assert.match(textOf(third), /rate_limited/);
    assert.deepEqual(rig.logs.map((entry) => entry.status), [McpCallStatus.Ok, McpCallStatus.Ok, McpCallStatus.RateLimited]);
  } finally {
    await rig.close();
  }
});

test("nhật ký ghi tên công cụ, số ký tự trả về và thời gian chạy", async () => {
  const rig = await connectTestClient(admin());
  try {
    await rig.client.callTool({ name: "describe_entities", arguments: {} });
    assert.equal(rig.logs.length, 1);
    assert.equal(rig.logs[0].tool, "describe_entities");
    assert.ok(rig.logs[0].resultChars > 0 && rig.logs[0].durationMs >= 0);
  } finally {
    await rig.close();
  }
});

test("quản trị «mọi nhóm» qua MCP chỉ đọc cuộc nhắn riêng CỦA MÌNH — câu bot trả lời có thể chứa nội dung nhóm Mật", async () => {
  const { db, queries } = fakeDb();
  const rig = await connectTestClient(admin(), { db, ownDirectUid: "uid-cua-toi" });
  try {
    await rig.client.callTool({ name: "query_records", arguments: { entity: "conversations", fields: ["id"] } });
    const select = queries.find((query) => /FROM zalo_group/i.test(query.sql));
    assert.ok(select, "phải có truy vấn cuộc trò chuyện");
    assert.match(select.sql, /zalo_group_id = \?/);
    assert.ok(select.params.includes("uid-cua-toi"));
  } finally {
    await rig.close();
  }
});

test("chủ khóa chưa gắn danh bạ: không thấy cuộc nhắn riêng nào", async () => {
  const { db, queries } = fakeDb();
  const rig = await connectTestClient(admin(), { db, ownDirectUid: null });
  try {
    await rig.client.callTool({ name: "query_records", arguments: { entity: "conversations", fields: ["id"] } });
    const select = queries.find((query) => /FROM zalo_group/i.test(query.sql));
    assert.ok(select);
    assert.match(select.sql, /1 = 0/);
  } finally {
    await rig.close();
  }
});
