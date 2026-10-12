import type { ApplicationHostPlatform } from '@/core/application-control/localHostContracts'
import type { OperationReviewItem, OperationReviewSnapshot } from '@/core/application-control/operationReview'
import { getApplicationHostService } from '@/commands/applicationControl'
import { showAlertDialog, useAlertDialogStore, type AlertDialogRequest } from '@/stores/alertDialogStore'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.application_control.review')
let snapshot: OperationReviewSnapshot = { items: [] }
const listeners = new Set<() => void>()
const same = (a: { operationId: string; callerId: string }, b: { operationId: string; callerId: string }): boolean => a.operationId === b.operationId && a.callerId === b.callerId
export function operationReviewsSnapshot(): OperationReviewSnapshot { return snapshot }
export function subscribeOperationReviews(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }

function acceptSnapshot(next: OperationReviewSnapshot, platform: ApplicationHostPlatform): void {
  snapshot = next
  useAlertDialogStore.setState(state => ({ queue: state.queue.filter(entry => !entry.review || next.items.some(item => same(item, entry.review!))) }))
  for (const listener of listeners) listener()
  const item = next.open && next.items.find(value => same(value, next.open!))
  if (!item || useAlertDialogStore.getState().queue.some(entry => entry.review && same(entry.review, item))) return
  let responding = false
  const entry: AlertDialogRequest = { title: item.title, message: item.message, type: 'warning', review: { ...item, resolve: decision => {
    if (responding) return
    responding = true
    void platform.reviewOperations({ action: 'resolve', operationId: item.operationId, callerId: item.callerId, decision }).then(value => {
      useAlertDialogStore.setState(state => ({ queue: state.queue.filter(value => value !== entry) }))
      acceptSnapshot(value, platform)
    }).catch(error => {
      logger.warn('保存核对结果失败', { event: 'application.review.resolve_failed', error })
      useAlertDialogStore.setState(state => ({ queue: state.queue.filter(value => value !== entry) }))
      showAlertDialog({ title: '核对结果未保存', message: '这项修改仍在待处理列表中，请稍后再试。', type: 'error' })
    }).finally(() => { responding = false })
  } } }
  showAlertDialog(entry)
}

/** 主进程账本是唯一真相源；这里只保存可重建的界面投影。 */
export function attachOperationReviews(platform: ApplicationHostPlatform): () => void {
  let active = true
  let received = false
  const unsubscribe = platform.onReviews(next => { received = true; if (active) acceptSnapshot(next, platform) })
  void platform.reviewOperations({ action: 'list' }).then(next => { if (active && !received) acceptSnapshot(next, platform) })
    .catch(error => logger.warn('读取待确认修改失败', { event: 'application.review.list_failed', error }))
  return () => { active = false; unsubscribe() }
}
export async function openOperationReview(item: OperationReviewItem): Promise<void> {
  try { await getApplicationHostService().reviewOperations({ action: 'open', operationId: item.operationId, callerId: item.callerId }) }
  catch (error) {
    logger.warn('打开核对面板失败', { event: 'application.review.open_failed', error })
    showAlertDialog({ title: '暂时无法核对', message: '应用正在连接，请稍后再试。待确认的修改会保留。', type: 'warning' })
  }
}
