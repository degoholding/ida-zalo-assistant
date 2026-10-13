import assert from "node:assert/strict";
import { test } from "node:test";
import { ReplyTone } from "../constants.js";
import { guardDraft, NEED_FILL, NEED_TECH } from "./reply-fact-guard.js";

const guard = (text: string, sources: string[] = [], options: { agro?: boolean; templateBody?: string } = {}) =>
  guardDraft({ tone: ReplyTone.Formal, text }, sources, { agro: options.agro ?? false, templateBody: options.templateBody ?? "" });

test("số tiền có trong câu hỏi giữ nguyên (450k)", () => {
  const out = guard("Dạ giá 450k một bao ạ", ["Flowertop giá 450k"]);
  assert.equal(out.text, "Dạ giá 450k một bao ạ");
  assert.equal(out.replaced, 0);
});

test("số tiền bịa → [cần bổ sung]", () => {
  const out = guard("Dạ giá 1.250.000đ một bao ạ", ["Flowertop giá sao em"]);
  assert.equal(out.text, `Dạ giá ${NEED_FILL} một bao ạ`);
  assert.equal(out.replaced, 1);
});

test("dấu phân cách khác nhau vẫn khớp (1.250.000 = 1250000)", () => {
  assert.equal(guard("giá 1.250.000đ", ["đã chốt 1250000 đ"]).replaced, 0);
});

test("ngày bịa → thay; ngày có nguồn giữ (05/10 = 5/10)", () => {
  assert.equal(guard("Hàng tới ngày 15/10 ạ", ["khi nào giao"]).text, `Hàng tới ${NEED_FILL} ạ`);
  assert.equal(guard("Hàng tới 05/10 ạ", ["hẹn 5/10 giao"]).replaced, 0);
});

test("«ngày 15» bịa → thay; có nguồn dạng ngày đầy đủ → giữ", () => {
  assert.equal(guard("giao ngày 15 nhé", []).replaced, 1);
  assert.equal(guard("giao ngày 15 nhé", ["đơn ngày 15/10"]).replaced, 0);
});

test("ngày kèm năm bịa", () => {
  assert.equal(guard("đến 31/12/2026", []).text, `đến ${NEED_FILL}`);
});

test("giờ: 9h = 9h00 = 9:00; giờ bịa bị thay", () => {
  assert.equal(guard("em gọi lúc 9h30", []).replaced, 1);
  assert.equal(guard("em gọi lúc 9h", ["hẹn 9:00"]).replaced, 0);
  assert.equal(guard("em gọi lúc 9h30", ["hẹn 9h30"]).replaced, 0);
});

test("thứ: bịa → thay; thứ 6 = thứ sáu", () => {
  assert.equal(guard("giao thứ 6 nhé", []).replaced, 1);
  assert.equal(guard("giao thứ 6 nhé", ["thứ sáu giao được không"]).replaced, 0);
  assert.equal(guard("giao chủ nhật nhé", []).replaced, 1);
  assert.equal(guard("giao chủ nhật nhé", ["chủ nhật rảnh"]).replaced, 0);
});

test("số + đơn vị: bao / kg / thùng", () => {
  assert.equal(guard("em giao 20 bao", []).text, `em giao ${NEED_FILL}`);
  assert.equal(guard("em giao 20 bao", ["cần 20 bao"]).replaced, 0);
  assert.equal(guard("tổng 500kg", ["khoảng 500 kg"]).replaced, 0);
});

test("phần trăm bịa → thay", () => {
  assert.equal(guard("ưu đãi 10%", []).text, `ưu đãi ${NEED_FILL}`);
  assert.equal(guard("ưu đãi 10%", ["mẫu ghi 10%"]).replaced, 0);
});

test("số lô bịa → thay; có nguồn giữ", () => {
  assert.equal(guard("lô A1234 bị lỗi", []).replaced, 1);
  assert.equal(guard("lô A1234 bị lỗi", ["lô A1234 vón cục"]).replaced, 0);
});

test("số trần ≥ 2 chữ số bịa → thay; 1 chữ số không đụng", () => {
  assert.equal(guard("đơn 5678 đang xử lý", []).replaced, 1);
  assert.equal(guard("em xin 1 phút", []).replaced, 0);
});

test("số có trong mẫu được giữ", () => {
  assert.equal(guard("em phản hồi trong 24h", ["Mẫu: trong 24h em phản hồi"]).replaced, 0);
});

test("chữ thường không đụng", () => {
  const text = "Dạ em chào anh/chị, em đã ghi nhận ạ.";
  assert.deepEqual(guard(text, []), { tone: ReplyTone.Formal, text, replaced: 0, technical: 0, warnings: [] });
});

test("chỗ trống mẫu chưa điền → [cần bổ sung: ...]", () => {
  const out = guard("Dạ em gửi giá [tên sản phẩm] ạ", []);
  assert.equal(out.text, "Dạ em gửi giá [cần bổ sung: tên sản phẩm] ạ");
  assert.equal(out.replaced, 1);
});

test("giữ nguyên [cần bổ sung] mô hình đã ghi, không đếm thêm", () => {
  const out = guard(`Giá ${NEED_FILL} ạ`, []);
  assert.equal(out.text, `Giá ${NEED_FILL} ạ`);
  assert.equal(out.replaced, 0);
});

test("thẻ che dữ liệu cá nhân [SĐT ***678] lọt vào nháp → [cần bổ sung]", () => {
  assert.equal(guard("gọi [SĐT ***678] nhé", []).text, `gọi ${NEED_FILL} nhé`);
});

test("liều pha BVTV khi agro → [cần kỹ thuật xác nhận], dù có trong nguồn", () => {
  const out = guard("Pha 20ml/bình 16 lít nhé", ["pha 20ml/bình 16 lít"], { agro: true });
  assert.ok(out.text.startsWith(`Pha ${NEED_TECH}`));
  assert.equal(out.technical, 1);
});

test("không agro: liều không bị đánh dấu kỹ thuật (đi theo luật số thường)", () => {
  assert.equal(guard("20ml/bình", ["20ml/bình"]).technical, 0);
});

test("cụm hứa hẹn mẫu không có → cảnh báo; mẫu có sẵn → không", () => {
  const out = guard("Em sẽ chiết khấu và hoàn tiền cho anh", [], { templateBody: "Em cảm ơn anh" });
  assert.deepEqual(out.warnings, ["hoàn tiền", "chiết khấu"]);
  assert.deepEqual(guard("Em hoàn tiền cho anh", [], { templateBody: "Chúng tôi hoàn tiền trong 3 ngày" }).warnings, []);
});

test("nhiều chỗ bịa trong một câu đều được thay, vị trí không lệch", () => {
  const out = guard("Giá 450k, giao 15/10 lúc 8h, 30 bao", ["giá 450k"]);
  assert.equal(out.text, `Giá 450k, giao ${NEED_FILL} lúc ${NEED_FILL}, ${NEED_FILL}`);
  assert.equal(out.replaced, 3);
});

test("review phase 10: ngày khác tháng không ăn theo ngày của nguồn; thời hạn / giờ có cách / mã đơn bịa → thay", () => {
  assert.equal(guard("em giao ngày 12/11", ["tin hôm 12/10"]).replaced, 1);
  assert.equal(guard("em giao ngày 12", ["tin hôm 12/10"]).replaced, 0);
  assert.equal(guard("trong 3 ngày em phản hồi", []).replaced, 1);
  assert.equal(guard("9 giờ sáng mai em gọi", []).replaced, 1);
  assert.equal(guard("mã đơn DH123 đã giao", []).replaced, 1);
  assert.equal(guard("mã đơn DH123 đã giao", ["đơn DH123 của anh"]).replaced, 0);
});

test("review phase 10: số lượng ở nguồn không cho phép cùng số thành GIÁ; giá ở nguồn cho phép số trần", () => {
  assert.equal(guard("giá 200k một bao", ["lấy 200 bao"]).replaced, 1);
  assert.equal(guard("giá 250 một bao", ["giá 250k"]).replaced, 0);
});
