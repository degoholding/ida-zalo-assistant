import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod/v4";
import { SchemaSanitizeError, sanitizeForGemini } from "./gemini-schema-sanitizer.js";

// Bộ làm sạch sơ đồ cho Gemini: khóa lạ bị bỏ, anyOf / const / nullable được làm phẳng, sơ đồ không đưa được thì báo lỗi.

const toSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "openapi-3.0", io: "input", unrepresentable: "any" });
const ALLOWED = new Set(["type", "description", "enum", "items", "properties", "required", "nullable", "format"]);

/** Duyệt mọi nút; trả khóa không nằm trong danh sách Gemini nhận. Khóa trong `properties` là TÊN trường nên không tính. */
function foreignKeys(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((item) => foreignKeys(item, found));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties") Object.values(value as object).forEach((child) => foreignKeys(child, found));
      else {
        if (!ALLOWED.has(key)) found.push(key);
        if (key === "items") foreignKeys(value, found);
      }
    }
  }
  return found;
}

test("drops length / range / additionalProperties constraints but keeps type, enum, description, required", () => {
  const result = sanitizeForGemini(toSchema(z.object({
    name: z.string().min(1).max(60).describe("Tên"),
    size: z.number().int().min(1).max(100).optional(),
    mode: z.enum(["a", "b"]),
    tags: z.array(z.string()).max(3).optional(),
  }).strict()));
  assert.deepEqual(result, {
    type: "object",
    properties: {
      name: { type: "string", description: "Tên" },
      size: { type: "integer" },
      mode: { type: "string", enum: ["a", "b"] },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["name", "mode"],
  });
  assert.deepEqual(foreignKeys(result), []);
});

test("flattens a scalar / array union into the string branch (the generic fallback)", () => {
  const result = sanitizeForGemini(toSchema(z.object({ value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).describe("Giá trị") })));
  assert.deepEqual((result.properties as Record<string, unknown>).value, { type: "string", description: "Giá trị" });
});

test("same-type union merges enums; null branch becomes nullable", () => {
  const merged = sanitizeForGemini({ type: "object", properties: { x: { anyOf: [{ type: "string", enum: ["a"] }, { type: "string", enum: ["b"] }] } } });
  assert.deepEqual((merged.properties as Record<string, unknown>).x, { type: "string", enum: ["a", "b"] });
  const nullable = sanitizeForGemini({ type: "object", properties: { x: { anyOf: [{ type: "integer" }, { type: "null" }] }, y: { type: ["string", "null"] } } });
  assert.deepEqual(nullable.properties, { x: { type: "integer", nullable: true }, y: { type: "string", nullable: true } });
});

test("const becomes a one-value enum; required names not in properties are pruned", () => {
  const result = sanitizeForGemini({ type: "object", properties: { kind: { const: "alpha" } }, required: ["kind", "ghost"] });
  assert.deepEqual(result, { type: "object", properties: { kind: { enum: ["alpha"], type: "string" } }, required: ["kind"] });
});

test("rejects schemas Gemini cannot take: $ref, allOf, root object without properties, array without items, root not object", () => {
  for (const bad of [
    { type: "object", properties: { a: { $ref: "#/$defs/x" } } },
    { type: "object", properties: { a: { allOf: [{ type: "string" }] } } },
    { type: "object" },
    { type: "object", properties: { a: { type: "array" } } },
    { type: "string" },
    { type: "object", properties: { a: { type: "weird" } } },
  ]) assert.throws(() => sanitizeForGemini(bad), SchemaSanitizeError, JSON.stringify(bad));
  assert.throws(() => sanitizeForGemini(null), SchemaSanitizeError);
});

test("root object with EMPTY properties (parameterless tool) is kept as the legacy declaration shape", () => {
  assert.deepEqual(sanitizeForGemini({ type: "object", properties: {}, additionalProperties: false, $schema: "x" }), { type: "object", properties: {} });
});
