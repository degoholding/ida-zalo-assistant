-- 09/10/2026 (phase 8 review, M11): báo cáo tuần / tháng quét message_flag theo (group_id, handled_at) khi tính phút
-- phản hồi trung vị / trung bình và tin còn chờ quá giờ còn mở TẠI MỘT MỐC trong quá khứ (xem
-- reports/periodic-report-message-stats.ts) — chỉ mục cũ (group_id, reply_state) không giúp được câu lọc theo
-- handled_at, mỗi tháng quét toàn bảng theo từng nhóm. Plan: plans/261009-1555-phase-08-briefs-reports/.

ALTER TABLE message_flag
  ADD KEY ix_message_flag_group_handled (group_id, handled_at);
