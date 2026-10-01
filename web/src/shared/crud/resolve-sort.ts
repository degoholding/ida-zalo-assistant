import type { CrudConfig, CrudRecord } from './types'

export interface ResolvedSort {
  /** Khóa cột gửi lên `sort_by`. Rỗng = không gửi, để backend sắp mặc định. */
  by: string
  dir: 'asc' | 'desc'
}

/**
 * Thứ tự sắp xếp hiện hành của màn danh sách: **URL thắng, `defaultSort` đỡ**.
 *
 * Tách khỏi `CrudListPage` vì ba nhánh của nó đều im lặng khi sai — sắp nhầm
 * cột thì bảng vẫn hiện đủ dòng, chỉ là sai thứ tự, và không có gì đỏ lên.
 *
 * Luật:
 * - URL có `sort_by` → dùng nó (người dùng vừa bấm tiêu đề cột), `sort_dir`
 *   thiếu thì `asc`. **Không** rơi về chiều của `defaultSort`: người ta đang
 *   sắp theo cột KHÁC, mượn chiều của cột mặc định là đoán mò.
 * - URL trống → `defaultSort` của danh mục.
 * - Không có cả hai → rỗng, chỗ gọi bỏ hẳn `sort_by`/`sort_dir` khỏi lời gọi
 *   API để backend dùng mặc định của nó (`id desc`).
 *
 * ⚠️ Nhịp thứ ba của tiêu đề cột ("thôi sắp xếp") XÓA param khỏi URL, nên nó
 * quay về `defaultSort` chứ không về `id desc`. Đúng ý: với danh mục có thứ tự
 * nghiệp vụ (năm giai đoạn của Loại hồ sơ), "mặc định" chính là thứ tự đó.
 */
export function resolveSort<T extends CrudRecord>(
  searchParams: URLSearchParams,
  config: Pick<CrudConfig<T>, 'defaultSort'>,
): ResolvedSort {
  const urlBy = searchParams.get('sort_by') || ''
  if (urlBy) {
    return { by: urlBy, dir: searchParams.get('sort_dir') === 'desc' ? 'desc' : 'asc' }
  }
  const fallback = config.defaultSort
  return fallback ? { by: fallback.by, dir: fallback.dir } : { by: '', dir: 'asc' }
}
