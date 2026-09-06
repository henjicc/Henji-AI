import { canvasEventBus } from './canvasServices'

/** DOM 事件没有等待者，拒绝仍需通过既有画布通知反馈，不能成为未处理 Promise。 */
export function reportCanvasOperationFailure(error: unknown): void {
  canvasEventBus.publish('canvas/toast', {
    type: 'error',
    message: error instanceof Error ? error.message : '画布操作失败，请检查当前内容后重试',
  })
}
