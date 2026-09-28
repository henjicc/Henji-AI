import i18n from '@/i18n'
import { getI18nText } from '@/core/types/I18nText'
import type { ModelDefinition } from '@/core/types/ModelDefinition'
import { requestAlertConfirmation } from '@/stores/alertDialogStore'

export class GenerationSubmissionCancelledError extends Error {
  constructor() {
    super('已取消提交，未发送生成请求')
    this.name = 'GenerationSubmissionCancelledError'
  }
}

export async function confirmGenerationSubmission(model: ModelDefinition, params: DynamicValueMap, signal: AbortSignal): Promise<void> {
  const confirmation = model.submissionConfirmation
  if (!confirmation?.condition(params)) return
  const accepted = await requestAlertConfirmation({
    type: 'warning',
    title: getI18nText(confirmation.title, i18n.language),
    message: getI18nText(confirmation.message, i18n.language),
    confirmLabel: getI18nText(confirmation.confirmLabel, i18n.language),
  }, signal)
  if (!accepted) throw new GenerationSubmissionCancelledError()
}
