import i18n from '@/i18n'
import { getI18nText } from '@/core/types/I18nText'
import type { ModelDefinition } from '@/core/types/ModelDefinition'
import { applicationPaidOperationReceipt, hasApplicationPaidApproval } from '../application-control/userConfirmation'
import { paidApprovalMessage, isPaidConfirmationExpired, type PaidOperationReceipt, type PaidApprovalDisplay } from '../application-control/paidApproval'
import { prepareGenerationPaidApproval } from '@/services/paidApproval'

export interface GenerationSubmissionConfirmationRequest {
  type: 'warning'
  title: string
  message: string
  confirmLabel: string
  paidDetails?: PaidApprovalDisplay
  paidConfirmation?: boolean
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

/** 由渲染层装配确认交互；未装配时禁止提交需要确认的请求。 */
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
  if (paid.decision.decision === 'deny') throw new GenerationSubmissionCancelledError()
  if (paid.decision.decision === 'auto') return paid
  const accepted = await requestConfirmation({
    type: 'warning',
    title: confirmation ? getI18nText(confirmation.title, i18n.language) : i18n.t('paidApproval.generateContent', { ns: 'common' }),
    message: confirmation ? getI18nText(confirmation.message, i18n.language) : i18n.t('paidApproval.operationContent', { ns: 'common' }),
    paidDetails: paidApprovalMessage(paid.decision, 'generation', getI18nText(model.meta.name, i18n.language)),
    confirmLabel: i18n.t('paidApproval.allowOnce', { ns: 'common' }), paidConfirmation: true,
  }, signal)
  if (!accepted || signal.aborted) throw new GenerationSubmissionCancelledError()
  try { await paid.confirm() }
  catch (error) {
    // IPC 往返期间刚好越过账本期限，仍属于未提交的取消。
    if (isPaidConfirmationExpired(error)) throw new GenerationSubmissionCancelledError()
    throw error
  }
  return paid
  } catch (error) { await paid.reject(); throw error }
}
