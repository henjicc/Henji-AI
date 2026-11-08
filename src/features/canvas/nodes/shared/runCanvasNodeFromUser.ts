import i18n from '@/i18n'
import { GenerationPreparationError } from '@/features/generation'
import { runCanvasNode } from '@/features/canvas/application/canvasExecutionService'
import { showAlertDialog } from '@/stores/alertDialogStore'

/**
 * 用户在节点上点生成。提交前就被拒（如素材尺寸不合模型要求）时还没有结果节点能承载原因，
 * 这里把原因弹给用户；其余失败由结果节点或执行器自身的提示呈现。
 */
export function runCanvasNodeFromUser(nodeId: string): void {
  void runCanvasNode(nodeId).catch((error: unknown) => {
    if (!(error instanceof GenerationPreparationError)) return
    showAlertDialog({ title: i18n.t('common:generationInputRejected.title'), message: error.message, type: 'warning' })
  })
}
