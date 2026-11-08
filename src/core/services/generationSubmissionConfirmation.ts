import i18n from '@/i18n'
import { getI18nText } from '@/core/types/I18nText'
import type { ModelDefinition } from '@/core/types/ModelDefinition'
import { applicationPaidOperationReceipt, hasApplicationPaidApproval } from '../application-control/userConfirmation'
import type { PaidOperationReceipt } from '../application-control/paidApproval'
import { prepareGenerationPaidApproval } from '@/services/paidApproval'

export interface GenerationSubmissionConfirmationRequest {
  type: 'warning'
  title: string
  message: string
  confirmLabel: string
}

export type GenerationSubmissionConfirm = (
  request: GenerationSubmissionConfirmationRequest,
  signal: AbortSignal,
) => Promise<boolean>

let requestConfirmation: GenerationSubmissionConfirm | undefined
// 从已授权的调用向其异步生成任务单次移交回执；工具参数不能创建该回执。
const approvedTasks = new Map<string, PaidOperationReceipt>()
export function transferGenerationPaidApproval(taskId: string, signal: AbortSignal): () => void {
  const receipt = applicationPaidOperationReceipt(signal)
  if (receipt && hasApplicationPaidApproval(signal, 'generation')) approvedTasks.set(taskId, receipt)
  return () => { approvedTasks.delete(taskId) }
}
export function consumeGenerationPaidApproval(taskId: string): PaidOperationReceipt | undefined {
  const receipt = approvedTasks.get(taskId); approvedTasks.delete(taskId); return receipt
}

export interface GenerationPaidExecution {
  receipt: PaidOperationReceipt
  start(): Promise<unknown>
  complete(): Promise<unknown>
  failed(error?: unknown): Promise<unknown>
  reject(): Promise<unknown>
}

/** 由渲染层装配模型自带提交说明的确认交互；未装配时禁止提交。 */
export function configureGenerationSubmissionConfirmation(confirm: GenerationSubmissionConfirm): void {
  requestConfirmation = confirm
}

export class GenerationSubmissionCancelledError extends Error {
  constructor() {
    super('已取消提交，未发送生成请求')
    this.name = 'GenerationSubmissionCancelledError'
  }
}

export async function confirmGenerationSubmission(model: ModelDefinition, params: DynamicValueMap, signal: AbortSignal, projectId?: string): Promise<GenerationPaidExecution | undefined> {
  const confirmation = model.submissionConfirmation?.condition(params) ? model.submissionConfirmation : undefined
  signal.throwIfAborted()
  if (!requestConfirmation) throw new Error('生成提交确认未初始化')
  const paid = await prepareGenerationPaidApproval(model.meta.id, params, projectId)
  try {
    signal.throwIfAborted()
    // 用户亲自发起的生成不受付费额度限制；模型自带的费用说明（如克隆音色另收的固定费用）仍须用户逐次确认。
    if (confirmation) {
      const accepted = await requestConfirmation({
        type: 'warning',
        title: getI18nText(confirmation.title, i18n.language),
        message: getI18nText(confirmation.message, i18n.language),
        confirmLabel: getI18nText(confirmation.confirmLabel, i18n.language),
      }, signal)
      if (!accepted || signal.aborted) throw new GenerationSubmissionCancelledError()
    }
    return paid
  } catch (error) { await paid.reject(); throw error }
}
