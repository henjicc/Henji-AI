// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type { ApplicationHostPlatform } from '@/core/application-control/localHostContracts'
import type { OperationReviewSnapshot } from '@/core/application-control/operationReview'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { attachOperationReviews, operationReviewsSnapshot } from './operationReviews'

it('核对沿现有弹窗队列；稍后处理保留入口，自动结案移除正在显示的核对', async () => {
  useAlertDialogStore.setState({ queue: [] })
  const item = { operationId: crypto.randomUUID(), callerId: crypto.randomUUID(), title: '这次修改生效了吗？', message: '当前有三条字幕', targets: [{ kind: 'video_edit.document', id: 'video' }] }
  let receive!: (snapshot: OperationReviewSnapshot) => void
  const reviewOperations = vi.fn().mockResolvedValue({ items: [item] })
  const platform: ApplicationHostPlatform = { reviewOperations, onReviews: handler => { receive = handler; return () => {} },
    publishContext: async () => {}, registerHost: async () => {}, complete: async () => {}, onRequest: () => () => {}, onCancel: () => () => {}, onRevoke: () => () => {} }
  const detach = attachOperationReviews(platform)
  try {
    receive({ items: [item], open: item })
    receive({ items: [item], open: item })
    expect(useAlertDialogStore.getState().queue).toHaveLength(1)
    useAlertDialogStore.getState().dismissCurrent()
    await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(0))
    expect(reviewOperations).toHaveBeenLastCalledWith({ action: 'resolve', operationId: item.operationId, callerId: item.callerId, decision: 'later' })
    expect(operationReviewsSnapshot().items).toHaveLength(1)
    receive({ items: [item], open: item })
    receive({ items: [] })
    expect(useAlertDialogStore.getState().queue).toHaveLength(0)
    expect(operationReviewsSnapshot().items).toHaveLength(0)
  } finally { detach(); useAlertDialogStore.setState({ queue: [] }) }
})
