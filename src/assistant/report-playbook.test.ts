import assert from "node:assert/strict";
import { test } from "node:test";
import { isReportRequest } from "./report-playbook.js";

test("isReportRequest: nhận yêu cầu báo cáo / tổng hợp / xuất file, có dấu hay không dấu", () => {
  for (const question of [
    "bot làm báo cáo tình hình nhóm K52 tuần này", "bao cao cong no thang 10", "tổng hợp việc còn treo",
    "thống kê số tin theo người", "xuất excel cho anh", "xuất ra file giúp anh", "ghi vào Google Sheets", "gửi bản PDF",
    "recap cuộc họp sáng nay", "lập bảng doanh số",
  ]) assert.equal(isReportRequest(question), true, question);
});

test("isReportRequest: câu hỏi thường không bị coi là báo cáo (không tốn bản nặng)", () => {
  for (const question of ["hey bot", "hôm nay thứ mấy", "nhóm K52 có ai nhắc tới anh không", "tạo cuộc họp 9h mai", "xuất phát lúc mấy giờ"]) {
    assert.equal(isReportRequest(question), false, question);
  }
});
