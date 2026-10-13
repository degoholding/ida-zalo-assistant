import assert from "node:assert/strict";
import { test } from "node:test";
import { ReplyTemplateStatus } from "../constants.js";
import { makeTemplate } from "./reply-template-fixture.js";
import { pickTemplates } from "./reply-template-picker.js";

const price = makeTemplate({ id: 1, name: "Báo giá sản phẩm", situation: "Khách hỏi giá", keywords: ["giá", "báo giá"] });
const late = makeTemplate({ id: 2, name: "Giao hàng trễ", situation: "Khách phàn nàn giao chậm", keywords: ["giao trễ", "chưa nhận"] });
const debt = makeTemplate({ id: 3, name: "Nhắc công nợ", keywords: ["công nợ"] });

test("khớp từ khóa không dấu với tin có dấu và ngược lại", () => {
  assert.equal(pickTemplates([price, late], "Flowertop gia sao em")[0].template.id, 1);
  assert.equal(pickTemplates([price, late], "Đơn này giao TRỄ rồi")[0].template.id, 2);
});

test("từ khóa khớp +3, token tên / tình huống +1", () => {
  const [hit] = pickTemplates([price], "khách hỏi giá flowertop");
  // «giá» +3; tên/tình huống có token «gia», «san», «pham», «hoi» → «gia» + «hoi» khớp (+2); «khach» là từ rỗng
  assert.ok(hit.score >= 4);
});

test("từ khóa khớp nguyên cụm, không khớp giữa từ", () => {
  assert.equal(pickTemplates([price], "bảng giá").length, 1);
  assert.equal(pickTemplates([makeTemplate({ keywords: ["gia"] })], "giang hồ").length, 0);
});

test("không có điểm > 0 → rỗng", () => {
  assert.deepEqual(pickTemplates([price, late, debt], "chào buổi sáng"), []);
});

test("mẫu Nháp / Chờ duyệt / Trả lại / Ngừng dùng không bao giờ vào lô", () => {
  for (const status of [ReplyTemplateStatus.Draft, ReplyTemplateStatus.PendingReview, ReplyTemplateStatus.Returned, ReplyTemplateStatus.Archived]) {
    assert.deepEqual(pickTemplates([{ ...price, status }], "báo giá giúp anh"), []);
  }
});

test("tối đa 3 ứng viên, điểm cao trước", () => {
  const many = [1, 2, 3, 4].map((id) => makeTemplate({ id, name: `Mẫu ${id}`, keywords: ["giá"].concat(id === 4 ? ["báo giá"] : []) }));
  const picked = pickTemplates(many, "báo giá nhé");
  assert.equal(picked.length, 3);
  assert.equal(picked[0].template.id, 4);
});

test("từ rỗng «anh chị em giúp trả lời tin» không tạo điểm", () => {
  const generic = makeTemplate({ name: "Anh chị em giúp trả lời tin", situation: "" });
  assert.deepEqual(pickTemplates([generic], "anh chị em giúp trả lời tin"), []);
});
