-- Chỉ số phản hồi (phase 15, 10/11/2026): mỗi ngày × cuộc (nhóm / chat riêng) × người trả lời một dòng, tính sẵn từ bảng message
-- để sếp hỏi qua MCP (reply_metrics) không phải kéo tin thô. Dòng responder_uid = '' là tổng của cuộc trong ngày; dòng có
-- responder_uid là phần của một nhân viên (số lượt họ trả lời, chờ bao lâu).
-- «Lượt chờ» (episode): tin KHÁCH đầu tiên mở lượt, tin NHÂN VIÊN đầu tiên sau đó đóng lượt — nhân viên = Danh bạ loại Nhân viên
-- hoặc tài khoản bot; trong chat riêng chủ tài khoản là nhân viên. Thời gian chờ đo cả giờ thường (wait_*) lẫn giờ làm việc theo lịch
-- Cài đặt (work_wait_*); trễ = quá ngưỡng «chờ trả lời» của cảnh báo (alerts.replyWaitMinutes, phút làm việc).
-- Việc nền tính lại hôm qua + hôm nay mỗi 30 phút (xóa rồi ghi lại theo ngày); `npm run cli -- reply-metrics --days N` tính bù.
CREATE TABLE IF NOT EXISTS reply_metric_daily (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id           INT UNSIGNED    NOT NULL,
  metric_date        DATE            NOT NULL,
  responder_uid      VARCHAR(40)     NOT NULL DEFAULT '',
  responder_name     VARCHAR(255)    NOT NULL DEFAULT '',
  -- Tin của khách trong ngày (mọi tin, kể cả tin nối tiếp trong cùng lượt chờ)
  customer_messages  INT UNSIGNED    NOT NULL DEFAULT 0,
  -- Lượt chờ mở trong ngày; answered = đã có nhân viên trả lời; answered_late = trả lời quá ngưỡng; open = chưa ai trả lời tới lúc tính;
  -- open_overdue = chưa trả lời và đã quá ngưỡng
  episodes           INT UNSIGNED    NOT NULL DEFAULT 0,
  answered           INT UNSIGNED    NOT NULL DEFAULT 0,
  answered_late      INT UNSIGNED    NOT NULL DEFAULT 0,
  open_episodes      INT UNSIGNED    NOT NULL DEFAULT 0,
  open_overdue       INT UNSIGNED    NOT NULL DEFAULT 0,
  wait_sum_sec       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  wait_max_sec       INT UNSIGNED    NOT NULL DEFAULT 0,
  work_wait_sum_sec  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  work_wait_max_sec  INT UNSIGNED    NOT NULL DEFAULT 0,
  -- Tin nhân viên gửi trong ngày (kể cả tin chủ động, không thuộc lượt chờ nào)
  staff_messages     INT UNSIGNED    NOT NULL DEFAULT 0,
  -- Lượt trợ lý AI của bot tự trả lời trong cuộc (assistant_turn, chỉ dòng tổng)
  assistant_replies  INT UNSIGNED    NOT NULL DEFAULT 0,
  sla_minutes        INT UNSIGNED    NOT NULL DEFAULT 0,
  computed_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_reply_metric_day (group_id, metric_date, responder_uid),
  KEY ix_reply_metric_date (metric_date),
  KEY ix_reply_metric_responder (responder_uid, metric_date),
  CONSTRAINT fk_reply_metric_group FOREIGN KEY (group_id) REFERENCES zalo_group (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
