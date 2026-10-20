const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** «HH:mm dd/MM/yyyy» giờ Việt Nam — dạng giờ công cụ tìm tin cũ của trợ lý trả cho mô hình. Hàm thuần. */
export function formatVnClock(ms: number): string {
  const iso = new Date(ms + VN_OFFSET_MS).toISOString();
  return `${iso.slice(11, 16)} ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
