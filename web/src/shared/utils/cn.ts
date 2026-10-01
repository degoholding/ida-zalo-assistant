import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Ghép class Tailwind có xử lý xung đột: `cn('p-2', 'p-4')` -> `'p-4'`.
 * Mọi component trong `shared/ui` đều dùng hàm này để prop `className` từ ngoài
 * ghi đè được style mặc định.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
