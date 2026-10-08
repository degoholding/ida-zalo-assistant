import assert from "node:assert/strict";
import { test } from "node:test";
import { isAgroTechnicalQuestion } from "./agro-technical.js";

test("dosage, mixing and pest questions are recognised with or without diacritics", () => {
  for (const question of [
    "Thuốc X pha với thuốc Y được không?",
    "liều lượng Abamectin cho 1 ha lúa là bao nhiêu",
    "lieu luong abamectin cho lua",
    "Lúa bị đạo ôn thì phun gì",
    "rầy nâu phá ruộng, xử lý sao em",
    "Thời gian cách ly của hoạt chất này?",
    "cây bị vàng lá thối rễ",
    "BVTV",
  ]) {
    assert.equal(isAgroTechnicalQuestion(question), true, question);
  }
});

test("everyday questions with look-alike words are not treated as technical", () => {
  for (const question of [
    "tóm tắt nhóm K52 hôm nay",
    "pha cà phê cho khách giúp em",
    "báo cáo doanh số tuần này",
    "đơn hàng thuốc của đại lý A giao chưa",
    "phun sương ở kho có hư không",
    "",
  ]) {
    assert.equal(isAgroTechnicalQuestion(question), false, question);
  }
});
