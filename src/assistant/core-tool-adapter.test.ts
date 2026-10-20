import assert from "node:assert/strict";
import { test } from "node:test";
import { McpCallSource } from "../constants.js";
import { z } from "zod/v4";
import { buildDataAccessContext } from "../data-access/data-access-context.js";
import { fakeDb, manager, staff, NOW } from "../data-access/data-access-test-support.js";
import type { AskerAccess } from "./infra/asker-access.js";
import { ASSISTANT_CORE_TOOL_NAMES, coreToolDeclarations, coreToolOptions, findAssistantCoreTool, toFunctionDeclaration } from "./core-tool-adapter.js";
import { buildCoreQueryTools } from "./core-tools-wiring.js";
import { GROUP_SCOPE_ENTITIES, normalizeCoreToolArgs } from "./core-tool-arg-compat.js";
import { findExecutor } from "./tool-registry.js";
import { runTool, type ToolContext } from "./tools.js";
import type { Principal } from "../auth/principal.js";

// Bộ chuyển công cụ lõi → khai báo hàm của trợ lý + chạy trong lượt (không DB thật): ẩn theo quyền, hỏi trong nhóm, ép kiểu `value`.

function access(principal: Principal, db = fakeDb().db, overrides: Partial<AskerAccess> = {}): AskerAccess {
  return {
    ...buildDataAccessContext({ db, principal, maskPersonal: false, source: McpCallSource.Assistant, now: NOW, ownDirectThreadsOnly: true, ownDirectUid: "u-1" }),
    origin: "web_user", ...overrides,
  };
}

const entityEnum = (decl: { parameters: Record<string, unknown> }) =>
  ((decl.parameters.properties as Record<string, { enum?: string[] }>).entity.enum) ?? [];

test("manager gets both core tools; declarations carry no anyOf and flatten filters[].value", () => {
  const decls = coreToolDeclarations(access(manager()));
  assert.deepEqual(decls.map((d) => d.name).sort(), [...ASSISTANT_CORE_TOOL_NAMES].sort());
  const query = decls.find((d) => d.name === "query_records")!;
  assert.ok(!JSON.stringify(query.parameters).includes("anyOf"));
  const filterProps = (((query.parameters.properties as any).filters.items.properties) as Record<string, any>);
  assert.equal(filterProps.value.type, "string");
  assert.deepEqual(filterProps.values, { type: "array", items: { type: "string" }, description: filterProps.values.description });
  assert.deepEqual((query.parameters as any).required, ["entity"]);
});

test("entities the asker cannot read are hidden from the entity enum (staff: no metrics / catalog)", () => {
  const staffDecl = coreToolDeclarations(access(staff())).find((d) => d.name === "query_records")!;
  assert.ok(entityEnum(staffDecl).includes("messages"));
  assert.ok(!entityEnum(staffDecl).includes("metrics") && !entityEnum(staffDecl).includes("catalog"));
  const managerDecl = coreToolDeclarations(access(manager())).find((d) => d.name === "query_records")!;
  assert.ok(entityEnum(managerDecl).includes("metrics"));
});

test("asking inside a group narrows entities to group-bound ones and makes describe_entities require `entity`", () => {
  const decls = coreToolDeclarations(access(manager()), coreToolOptions(11));
  const query = decls.find((d) => d.name === "query_records")!;
  const describe = decls.find((d) => d.name === "describe_entities")!;
  assert.deepEqual(entityEnum(query), GROUP_SCOPE_ENTITIES.filter((name) => entityEnum(query).includes(name)));
  assert.ok(!entityEnum(query).includes("metrics") && !entityEnum(query).includes("contacts"));
  assert.deepEqual((describe.parameters as any).required, ["entity"]);
});

test("a tool unavailable to the asker, or whose schema Gemini cannot take, is hidden instead of breaking the turn", () => {
  const def = findAssistantCoreTool("query_records")!;
  assert.equal(toFunctionDeclaration({ ...def, available: () => false }, access(manager())), null);
  // Sơ đồ đệ quy → zod sinh $ref → bộ làm sạch từ chối → công cụ bị bỏ (log), không ném
  const node: z.ZodType = z.object({ name: z.string(), child: z.lazy(() => node).optional() });
  assert.equal(toFunctionDeclaration({ ...def, input: () => node as never }, access(manager())), null);
});

test("buildCoreQueryTools: switch off = nothing and no prompt; on = declarations + one prompt block explaining <du_lieu>", () => {
  assert.deepEqual(buildCoreQueryTools(access(manager()), false, undefined), { declarations: [], prompt: "" });
  const on = buildCoreQueryTools(access(manager()), true, undefined);
  // Phase 8: người có tài khoản web ở tin riêng còn có công cụ ghi (3 propose, không có công cụ xác nhận) — kiểm riêng ở write-tool-adapter.test.ts
  assert.equal(on.declarations.filter((d) => (ASSISTANT_CORE_TOOL_NAMES as readonly string[]).includes(d.name)).length, 2);
  assert.equal(on.declarations.length, 2 + 3);
  assert.match(on.prompt, /<du_lieu>/);
  assert.match(on.prompt, /untrusted_fields/);
});

test("declaration size stays small for flash-lite (measured, upper bound)", () => {
  const chars = JSON.stringify(coreToolDeclarations(access(manager()))).length;
  console.log(`core tool declarations: ${chars} chars`);
  assert.ok(chars < 6000, `quá lớn: ${chars}`);
});

test("normalizeCoreToolArgs merges `values` into `value` and turns isnull text into boolean; other args untouched", () => {
  const out = normalizeCoreToolArgs("query_records", {
    entity: "messages",
    filters: [
      { field: "thread_id", op: "in", values: ["1", "2"] },
      { field: "text", op: "isnull", value: "true" },
      { field: "sent_at", op: "gte", value: "2026-10-12" },
    ],
  });
  assert.deepEqual(out.filters, [
    { field: "thread_id", op: "in", value: ["1", "2"] },
    { field: "text", op: "isnull", value: true },
    { field: "sent_at", op: "gte", value: "2026-10-12" },
  ]);
  assert.deepEqual(normalizeCoreToolArgs("describe_entities", { entity: "x" }), { entity: "x" });
});

test("only the two core tools are reachable by name; prototype names and other core tools are not", () => {
  assert.ok(findAssistantCoreTool("query_records"));
  for (const name of ["constructor", "__proto__", "whoami", "get_thread_messages", "metrics_summary", "toString"]) assert.equal(findAssistantCoreTool(name), undefined, name);
  assert.equal(findExecutor("__proto__"), undefined);
  assert.equal(findExecutor("constructor"), undefined);
  assert.ok(findExecutor("query_records"));
});

function turn(asker: AskerAccess, overrides: Partial<ToolContext> = {}): ToolContext {
  return { db: asker.db, askerUid: "u-1", access: asker, filesToSend: [], now: NOW, coreQueryTools: true, ...overrides };
}

test("runTool dispatches query_records through the core: scope + confidential guard in SQL, call logged with source Assistant", async () => {
  const { db, queries } = fakeDb((sql) => (/FROM zalo_group g/.test(sql) ? [{ id: 11, name: "K52" }] : []));
  const asker = access(manager({ groupIds: [11, 12] }), db);
  const result = await runTool(turn(asker), "query_records", { entity: "groups", fields: ["id", "name"] });
  assert.equal((result as any).entity, "groups");
  assert.deepEqual((result as any).items, [{ id: 11, name: "K52" }]);
  const select = queries.find((q) => /SELECT .*FROM zalo_group g/.test(q.sql))!;
  assert.match(select.sql, /is_confidential = 0/);
  assert.deepEqual(select.params.flat().filter((value) => value === 11 || value === 12), [11, 12], "phạm vi nhóm phải nằm trong tham số");
  await new Promise((resolve) => setImmediate(resolve));
  const log = queries.find((q) => /INSERT INTO mcp_call_log/.test(q.sql))!;
  assert.ok(log, "phải ghi mcp_call_log");
  assert.equal(log.params[1], 7); // user_id của principal
  assert.equal(log.params[2], null); // contact_id (ngữ cảnh thử không có chủ thể liên hệ)
  assert.equal(log.params[3], null); // key_id
  assert.equal(log.params[4], McpCallSource.Assistant);
  assert.equal(log.params[5], "query_records");
});

test("core tool errors come back as { error: { code, message } } for the model to fix, not thrown", async () => {
  const asker = access(manager());
  const bad = await runTool(turn(asker), "query_records", { entity: "groups", filters: [{ field: "nope", op: "eq", value: "1" }] });
  assert.equal((bad as any).error.code, "invalid_field");
  const invalid = await runTool(turn(asker), "query_records", { entity: 5 });
  assert.equal((invalid as any).error.code, "invalid_value");
});

test("switch off (ToolContext.coreQueryTools falsy) = tool does not exist for the turn", async () => {
  const asker = access(manager());
  assert.deepEqual(await runTool(turn(asker, { coreQueryTools: false }), "query_records", { entity: "groups" }), { error: "Không có công cụ query_records" });
});

test("group call: non group-bound entity is refused before any SQL; group-bound entity runs with the narrowed principal", async () => {
  const { db, queries } = fakeDb();
  const asker = access(manager({ groupIds: [11] }), db);
  const ctx = turn(asker, { scopeGroupId: 11 });
  for (const entity of ["metrics", "contacts", "tickets", "audit_log"]) {
    const refused = await runTool(ctx, "query_records", { entity });
    assert.equal((refused as any).error.code, "forbidden", entity);
  }
  const noEntity = await runTool(ctx, "describe_entities", {});
  assert.equal((noEntity as any).error.code, "forbidden");
  assert.equal(queries.filter((q) => !/mcp_call_log/.test(q.sql)).length, 0, "không được chạm DB nghiệp vụ");
  const ok = await runTool(ctx, "describe_entities", { entity: "messages" });
  assert.ok(!("error" in ok));
});
