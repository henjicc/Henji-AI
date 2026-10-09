import i18n from '@/i18n'
import { getI18nText } from '@/core/types/I18nText'
import type { ModelDefinition } from '@/core/types/ModelDefinition'

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

export async function confirmGenerationSubmission(model: ModelDefinition, params: DynamicValueMap, signal: AbortSignal): Promise<void> {
  const confirmation = model.submissionConfirmation
  if (!confirmation?.condition(params)) return
  signal.throwIfAborted()
  if (!requestConfirmation) throw new Error('生成提交确认未初始化')
  const accepted = await requestConfirmation({
    type: 'warning',
    title: getI18nText(confirmation.title, i18n.language),
    message: getI18nText(confirmation.message, i18n.language),
    confirmLabel: getI18nText(confirmation.confirmLabel, i18n.language),
  }, signal)
  if (!accepted || signal.aborted) throw new GenerationSubmissionCancelledError()
}
