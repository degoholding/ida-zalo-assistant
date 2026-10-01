# Bot trợ lý — hướng dẫn cho người viết mã

Đọc `README.md` trước. Hai nửa của kho:

- `src/` — máy chủ Node 22 + TypeScript: đồng bộ Zalo (`sync/`, `zalo/`), trợ lý Gemini (`assistant/`),
  API JSON cho giao diện (`web/api/`). Chạy `npm run typecheck` và `npm test` (bài kiểm không cần DB
  nằm cạnh tệp: `src/**/*.test.ts`).
- `web/` — giao diện quản trị, nhân bản khung ERP v2. **Luật viết mã nằm ở `web/.claude/rules/`** (đặt
  tên, TypeScript, component, style, icon, test) — đọc trước khi sửa bất kỳ tệp nào trong `web/`.

## Luật chung

- Tên hàm / biến / hằng tiếng Anh; chuỗi hiển thị, chú thích, tài liệu tiếng Việt. Không emoji.
- Màn danh sách = một `CrudConfig` + `CrudListPage`; màn chi tiết = `CrudDetailPage`. Không vẽ bảng /
  biểu mẫu tay khi khung làm được. Thứ dùng chung giữa nhiều phân hệ (ảnh đại diện, thẻ nổi, nhãn
  loại người) nằm ở `web/src/shared/`, phân hệ không import chéo nhau.
- Mỗi phân hệ phía máy chủ một tệp `src/web/api/<tên>-api.ts`: `ListSpec` (trường lọc, cột sắp xếp,
  cột tìm) + `runList` + mảng `ApiRoute`. Trường không khai trong `ListSpec` thì bộ lọc bỏ qua im lặng
  — thêm cột lọc / sắp xếp ở giao diện là phải khai bên này.
- Sửa dữ liệu qua API thì `recordAudit` (bảng `audit_log`) để mục «Lịch sử thao tác» có dòng.
- Mã số trạng thái lưu SMALLINT, định nghĩa một chỗ ở `src/constants.ts`; giao diện chép sang
  `web/src/shared/contact-card/contact-constants.ts` và các `types/` — đổi bên này thì sửa bên kia.
- Không tự commit; chỉ commit khi được bảo rõ. Nhánh: `dev1` (local) → `dev` → `main` (prod).

## Kiểm trước khi báo xong

```
npm run typecheck && npm test
cd web && npm run typecheck && npm run lint && npx vitest run src/modules/<phân hệ vừa sửa>
docker compose up -d --build app      # rồi mở http://localhost:8090/app/
```
