import { useSyncExternalStore } from 'react'
import { UiButton, UiError } from '@/components/ui'
import { openOperationReview, operationReviewsSnapshot, subscribeOperationReviews } from './operationReviews'

/** 文档顶部复用提示条；关闭核对面板不会丢掉再次处理的入口。 */
export function ApplicationOperationReviewBanner({ documentId, domain, label = '文档' }: { documentId: string; domain: string; label?: string }): React.ReactElement | null {
  const { items } = useSyncExternalStore(subscribeOperationReviews, operationReviewsSnapshot)
  const item = items.find(item => item.targets.some(ref => (ref.kind === `${domain}.document` && ref.id === documentId)
    || ref.kind.startsWith(`${domain}.`) && ref.id.startsWith(`${documentId}:`)
    || ref.kind === 'document' && ref.id === documentId))
  if (!item) return null
  return <UiError size="xs" align="start" className="px-3" message={null} title={<span className="inline-flex items-center gap-2">
    有一项 AI 修改还没确认是否生效，暂时不能修改这份{label}。
    <UiButton variant="quiet" size="sm" onClick={() => { void openOperationReview(item) }}>去确认</UiButton>
  </span>} />
}
