import { GenerationPreparationError } from '@/features/generation'
import { runCanvasNode } from '@/features/canvas/application/canvasExecutionService'
import { reportCanvasOperationFailure } from '@/features/canvas/application/canvasOperationFeedback'

/**
 * 用户在节点上点生成。提交前就被拒（如素材尺寸不合模型要求）时还没有结果节点能承载原因，
 * 这里用画布提示条说明原因，和续接节点、生成页的提交前拒绝同一种呈现；其余失败由结果节点或执行器自身的提示呈现。
 */
export function runCanvasNodeFromUser(nodeId: string): void {
  void runCanvasNode(nodeId).catch((error: unknown) => {
    if (error instanceof GenerationPreparationError) reportCanvasOperationFailure(error)
  })
}
