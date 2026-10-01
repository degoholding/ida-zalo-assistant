/** Đầu mối import của tầng API — module nghiệp vụ chỉ cần `from '@/core/api'`. */

export { httpClient } from './http-client'
export { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './api-request'
export { downloadFile } from './download-file'
export { fetchBlobUrl } from './fetch-blob-url'
export { queryClient } from './query-client'
export { extractErrorMessage } from './response-envelope'
export type { ApiEnvelope, SuccessEnvelope, ErrorEnvelope } from './response-envelope'
