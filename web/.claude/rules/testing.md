---
name: testing
description: Vitest + Testing Library setup, what to test, and the three gates that must stay green.
metadata:
  tags: testing, vitest, testing-library, lint
---

# Testing

Runner: **Vitest 4** (`vitest.config.ts`), DOM: **jsdom**, component queries:
**@testing-library/react**. Linter: **ESLint 10** flat config (`eslint.config.js`) —
`@eslint/js` + `typescript-eslint` + `react-hooks` v7 + `react-refresh`, với
`eslint-config-prettier` đặt cuối. Định dạng: **Prettier** (`.prettierrc.json`,
kèm `prettier-plugin-tailwindcss` tự sắp xếp class Tailwind).

`typescript` đang ghim ở **5.9.3** (không phải 7.x) vì `typescript-eslint@8` chưa
chạy được trên TS 7. Đừng nâng lên 7 nếu chưa kiểm tra ESLint còn dựng được.

Mọi thứ chạy trong Docker service `erp`:

```bash
docker compose exec -T erp npm run typecheck                      # tsc --noEmit — cả cây
docker compose exec -T erp npm run lint                           # eslint . — cả cây
docker compose exec -T erp npx vitest run src/modules/<phân hệ>   # CHỈ thư mục vừa sửa
docker compose exec -T erp npx vitest run src/shared/<khu>        # đụng lớp dùng chung thì thêm khu đó
docker compose exec erp npm run lint:fix                          # eslint . --fix
docker compose exec erp npm run test:watch                        # vitest ở chế độ theo dõi
docker compose exec erp npm run format                            # prettier --write . (đọc ghi chú bên dưới)
# npm run check / npm run test = quét hết ~3200 bài: chỉ khi được bảo rõ, hoặc ngay trước deploy
```

Ba cổng, cả ba phải xanh:

| Cổng        | Ngưỡng                                                                              |
| ----------- | ----------------------------------------------------------------------------------- |
| `typecheck` | **0 lỗi**                                                                           |
| `lint`      | **0 lỗi**. Cảnh báo còn vài chỗ cũ — đừng thêm mới                                  |
| `test`      | **xanh trong thư mục vừa sửa** (`npx vitest run <thư mục>`), không quét cả cây      |

**Cổng `test` chạy theo THƯ MỤC, không chạy full** (chốt 17/09/2026 khi bộ test vượt 3200
bài, `npm run check` mất 5-6 phút và ăn trọn 2 CPU của container). Sửa gì thì chạy vitest
đúng thư mục đó: phân hệ → `src/modules/<tên>`; lớp dùng chung → `src/shared/<khu>` hoặc
`src/core/<khu>`; đụng nhiều chỗ thì liệt kê nhiều đường dẫn trong cùng một lệnh. `typecheck`
đã bắt được lỗi lan sang phân hệ khác (đổi kiểu, đổi tên hàm), nên không cần test cả cây để
"cho chắc". Full suite chỉ khi được bảo rõ, hoặc ngay trước khi deploy.

**`format:check` CHƯA nằm trong `check`** và hiện đỏ ở ~381 tệp: Prettier mới được
thêm vào, chưa ai chạy `format --write` cho toàn bộ mã. Đừng tự ý chạy
`npm run format` trên cả cây trong lúc đang làm việc khác — nó đẻ ra một diff khổng
lồ đè lên việc đang làm dở của người khác. Chạy riêng, thành một commit độc lập,
lúc không ai sửa dở.

## Where tests go

Next to the file they cover: `format-money.ts` → `format-money.test.ts`.
No `__tests__/` folder, no separate mirror tree. The only file outside that rule is
`src/test/setup.ts` (dọn DOM sau mỗi test + nạp matcher của jest-dom).

## What to test

Đi từ chỗ dễ sai nhất, không chạy theo phần trăm bao phủ:

1. **Hàm thuần có quy tắc nghiệp vụ** — tiền, ngày, đọc số thành chữ, dịch bộ lọc
   thành query param. Rẻ, chạy nhanh, và chính là chỗ lỗi âm thầm hay nằm.
2. **Ràng buộc dữ liệu** — bảng đăng ký module, hằng số phải khớp nhau
   (xem `src/app/router/module-registry.test.ts`).
3. **Hành vi component mà người dùng thấy được** — bấm được / không bấm được,
   hiện gì khi rỗng, gọi callback với đối số nào. Khẳng định theo VAI TRÒ và
   NỘI DUNG (`getByRole`, `getByText`), **không** theo class Tailwind hay
   `data-testid` bịa ra.

Không viết test cho: dựng bố cục thuần túy, đầu ra của thư viện ngoài, hay
"gọi hàm này rồi kiểm tra chính hàm này được gọi".

## Conventions

- Không bật `globals` — `import { describe, expect, it, vi } from 'vitest'` rõ ràng.
- Tên `it(...)` viết bằng **tiếng Anh**, mô tả HÀNH VI chứ không mô tả hàm:
  "làm tròn tới đồng, không để lẻ rò ra cột danh sách", không phải "test formatMoney".
- Test nào nhắc lại một lỗi đã từng xảy ra thì ghi rõ lỗi đó trong comment —
  người sau đọc mới biết tại sao không được xóa.
- Múi giờ khi chạy test cố định `Asia/Ho_Chi_Minh` (đặt trong `vitest.config.ts`).
  Đừng viết khẳng định phụ thuộc "hôm nay"; truyền ngày cụ thể vào.
- Gọi API thật thì mock ở tầng `@/core/api` (`vi.mock`), không mock `axios`.

## Tress test

- Test những trường hợp cực đoan, ví dụ: chuỗi rỗng, số âm, số quá lớn, ngày ngoài dải
  hợp lệ, danh sách rỗng, danh sách quá dài. Không cần test từng giá trị hợp lệ
  riêng lẻ — đó là việc của TypeScript.
- Test những trường hợp nhỏ nhưng có thể gây lỗi thầm lặng, ví dụ: số âm, số 0, số 1, chuỗi rỗng, danh sách rỗng, danh sách một phần tử, danh sách một phần tử trùng nhau.
- Test như người hacker cố gắng phá vỡ hệ thống, không test như người dùng bình thường. Người dùng bình thường không bấm nút "Xoá tất cả" khi đang có 1000 dòng trong bảng, nhưng hacker có thể làm vậy.
- Test những trường hợp phụ thuộc vào module khác, ví dụ: một hàm format tiền phụ thuộc vào hằng số `currency` trong module khác. Nếu hằng số đó thay đổi, test sẽ fail và báo cho người sửa biết rằng họ đã phá vỡ quy tắc nghiệp vụ.
- Với trường hợp test 1 module thì test luôn cả những module mà nó phụ thuộc vào, không mock chúng. Nếu module phụ thuộc thay đổi, test sẽ fail và báo cho người sửa biết rằng họ đã phá vỡ quy tắc nghiệp vụ.
- Với trường hợp test phụ thuộc bạn test cực đoan những trường hợp với module phục thuộc dựa vào độ flexible mà mudule phụ thuộc cung cấp. Ví dụ: nếu module phụ thuộc có thể trả về null, test luôn cả trường hợp null. Nếu module phụ thuộc có thể trả về undefined, test luôn cả trường hợp undefined. Nếu module phụ thuộc có thể trả về một danh sách rỗng, test luôn cả trường hợp danh sách rỗng.

**Chân lý**

- Test ko cố gắng làm nó đúng test case mà test cố gắng làm nó sai. Nếu test case fail thì báo cho người sửa biết rằng họ đã phá vỡ quy tắc nghiệp vụ. Tìm ra những trường hợp đó chứng tỏ code đang bị lủng chứ ko cố gắng sửa test case để nó đúng.
