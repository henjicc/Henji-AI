import { GenerationPreparationError } from '@/features/generation'
import { runCanvasNode } from '@/features/canvas/application/canvasExecutionService'
import { reportCanvasOperationFailure } from '@/features/canvas/application/canvasOperationFeedback'
import { isCanvasNodeBodyVisible } from '@/features/canvas/presence/useCanvasNodePresence'
import { isUserCancellation } from '@/services/paidApproval'
import { useAlertDialogStore } from '@/stores/alertDialogStore'

/**
 * 用户在节点上点生成。提交前就被拒（如素材尺寸不合模型要求）时还没有结果节点能承载原因，
 * 这里用画布提示条说明原因，和续接节点、生成页的提交前拒绝同一种呈现；其余失败由结果节点或执行器自身的提示呈现。
 *
 * 节点正文没挂着、或在远景里看不见时（从工具栏运行），写在正文里的提示（提示词标红、行内报错）用户看不到，
 * 这时失败原因一律走画布提示条；已经有弹窗在说明原因的不重复。
 */
export function runCanvasNodeFromUser(nodeId: string): void {
  void runCanvasNode(nodeId).catch((error: unknown) => {
    if (error instanceof GenerationPreparationError) { reportCanvasOperationFailure(error); return }
    if (isCanvasNodeBodyVisible(nodeId) || isUserCancellation(error) || useAlertDialogStore.getState().queue.length > 0) return
    reportCanvasOperationFailure(error)
  })
}
