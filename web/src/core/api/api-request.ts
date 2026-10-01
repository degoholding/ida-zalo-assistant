import type { AxiosRequestConfig } from 'axios'

import { httpClient } from './http-client'
import type { SuccessEnvelope } from './response-envelope'

/**
 * Bốn hàm dưới đây bóc sẵn lớp phong bì `{ success, message, data }`, trả thẳng `data`.
 * Nhờ vậy tầng module chỉ viết `apiGet<Supplier[]>('/api/suppliers')` thay vì
 * `res.data.data` ở khắp nơi (gõ sai một lần là undefined lúc runtime).
 *
 * Cần cả `message` (vd toast "Đã lưu") thì dùng `httpClient` trực tiếp.
 */

export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await httpClient.get<SuccessEnvelope<T>>(url, config)
  return res.data.data
}

export async function apiPost<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await httpClient.post<SuccessEnvelope<T>>(url, body, config)
  return res.data.data
}

export async function apiPut<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await httpClient.put<SuccessEnvelope<T>>(url, body, config)
  return res.data.data
}

export async function apiPatch<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await httpClient.patch<SuccessEnvelope<T>>(url, body, config)
  return res.data.data
}

export async function apiDelete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await httpClient.delete<SuccessEnvelope<T>>(url, config)
  return res.data.data
}
