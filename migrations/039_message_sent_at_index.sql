-- 17/10/2026 (review phase 2 lõi truy cập dữ liệu, H3): công cụ MCP / trợ lý lọc `message` chỉ theo khoảng sent_at (không thread_id,
-- vd entity «messages» với khoảng ≤ 92 ngày, người quản trị / «mọi nhóm» không bị ép group_id IN) — chỉ có chỉ mục (group_id, sent_at)
-- và (sender_uid, sent_at) nên MySQL quét CẢ bảng rồi sắp xếp, giữ kết nối tới 5 giây (trần MAX_EXECUTION_TIME) và làm nghẹt pool
-- dùng chung với đồng bộ Zalo. Chỉ mục (sent_at) cho phép quét theo khoảng + đọc ngược theo thứ tự thời gian.
--
-- AN TOÀN trên bảng lớn: thêm chỉ mục phụ là DDL trực tuyến của InnoDB (không dựng lại bảng, không chặn ghi). Ghi rõ
-- ALGORITHM=INPLACE, LOCK=NONE để nếu máy chủ KHÔNG làm được trực tuyến thì câu lệnh LỖI ngay thay vì lặng lẽ khóa bảng (khác với
-- thêm FULLTEXT — xem 023). Tốn I/O trong lúc dựng (~vài giây / triệu dòng); nên chạy giờ thấp điểm.
-- Số 038 dành cho nháp ghi (phase 8 của plans/261017-0904-mcp-data-access-server) — runner chạy theo TÊN tệp nên lệch số không sao.

ALTER TABLE message
  ADD KEY ix_message_sent_at (sent_at), ALGORITHM=INPLACE, LOCK=NONE;
