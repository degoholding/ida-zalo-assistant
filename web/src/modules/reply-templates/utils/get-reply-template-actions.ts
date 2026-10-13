import { REPLY_TEMPLATE_STATUS, type ReplyTemplateAction } from '../types/reply-template'

export interface ReplyTemplateForActions {
  status: number
  can_edit: boolean
  can_review: boolean
}

/**
 * Nút hiện được, theo luật `decideTemplateTransition` ở máy chủ (máy chủ vẫn kiểm lại): gửi duyệt chỉ với mẫu Nháp và
 * người sửa được; duyệt / trả lại chỉ mẫu Chờ duyệt và người có quyền duyệt; ngừng dùng mọi mẫu chưa ngừng, người có quyền duyệt.
 */
export function getReplyTemplateActions(template: ReplyTemplateForActions): ReplyTemplateAction[] {
  const actions: ReplyTemplateAction[] = []
  if (template.status === REPLY_TEMPLATE_STATUS.draft && template.can_edit) actions.push('submit')
  if (template.status === REPLY_TEMPLATE_STATUS.pendingReview && template.can_review) actions.push('approve', 'return')
  if (template.status !== REPLY_TEMPLATE_STATUS.archived && template.can_review) actions.push('archive')
  return actions
}
