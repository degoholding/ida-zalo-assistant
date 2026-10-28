import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod/v4";
import { McpCallSource } from "../constants.js";
import { admin, makeCtx } from "./data-access-test-support.js";
import { DataAccessError } from "./data-access-errors.js";
import type { AnyToolDefinition } from "./tool-definition.js";
import { runTool } from "./tool-runner.js";

// Soát 13.6 (28/10/2026): trước đây chỉ đường THÀNH CÔNG qua bộ che — lỗi `ambiguous` trả nguyên tên trong `choices` (tên Zalo / danh bạ hay kèm SĐT),
// `allowed` (nhãn chỉ tiêu do nguồn nhập đặt) và câu lỗi, nên SĐT lọt ra AI ngoài dù bật «Che dữ liệu cá nhân».

const PHONE = "0912345678";
const failing = (error: DataAccessError): AnyToolDefinition => ({
  name: "thu_loi", title: "Thử", description: "Công cụ thử", input: () => z.object({}) as z.ZodType<unknown>, output: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false }, available: () => true,
  handler: async () => { throw error; },
});

for (const source of [McpCallSource.Http, McpCallSource.Assistant]) {
  test(`lỗi nghiệp vụ qua bộ che khi bật che (nguồn ${source}): choices / allowed / câu lỗi không còn SĐT`, async () => {
    const error = new DataAccessError("ambiguous", `Có nhiều người tên Ba ${PHONE}`, [`Doanh số ${PHONE}`], {
      choices: [{ id: 1, name: `Anh Ba ${PHONE}` }, { id: 2, name: "Chị Tư" }],
    });
    const masked = await runTool(failing(error), makeCtx(admin(), { maskPersonal: true, source }), {});
    assert.equal(masked.isError, true);
    assert.ok(!masked.text.includes(PHONE), masked.text);
    assert.ok(!JSON.stringify(masked.structured).includes(PHONE));
    const choices = (masked.structured as { error: { choices: { id: number; name: string }[] } }).error.choices;
    assert.deepEqual(choices.map((choice) => choice.id), [1, 2], "id vẫn nguyên để chọn");
    assert.match(choices[0].name, /\[SĐT \*\*\*678\]/);

    const plain = await runTool(failing(error), makeCtx(admin(), { maskPersonal: false, source }), {});
    assert.ok(JSON.stringify(plain.structured).includes(PHONE), "tắt che thì giữ nguyên");
  });
}
