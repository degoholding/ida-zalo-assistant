import { usePermission } from '@/core/authorization/use-permission'
import { Button } from '@/shared/ui/button'
import { ErrorState } from '@/shared/ui/error-state'
import { useAiKeyMutations, useAiKeys } from '../hooks/use-ai-keys'
import { AiKeyListCard } from './ai-key-list-card'

/** Tab «Khóa AI» đứng đầu màn Cài đặt — nối thẻ danh sách khóa với API. */
export function AiKeysTab() {
  const { data, isLoading, isError, refetch } = useAiKeys()
  const { add, update, moveUp, remove } = useAiKeyMutations()
  const { can } = usePermission()

  if (isError) {
    return (
      <ErrorState title="Không tải được danh sách khóa AI" description="Có lỗi khi gọi máy chủ, thử tải lại.">
        <Button onClick={() => void refetch()}>Thử lại</Button>
      </ErrorState>
    )
  }

  return (
    <AiKeyListCard
      items={data ?? []}
      isLoading={isLoading}
      canWrite={can('setting', 'write')}
      saving={add.isPending}
      onAdd={(body) => add.mutateAsync(body)}
      onUpdate={(id, body) => update.mutate({ id, body })}
      onMoveUp={(id) => moveUp.mutate(id)}
      onRemove={(id) => remove.mutate(id)}
    />
  )
}
