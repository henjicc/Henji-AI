import { useI18n } from '@/hooks/useI18n'
import { formatPaidApprovalMessage } from '@/i18n/paidApproval'
import { UiButton, UiModal } from '@/components/ui'
import { UI_TEXT_BODY_CLASS } from '@/components/ui/styleTokens'
import type { ExplanationSendRequest } from '../application/explanationGeneration'

export function ExplanationSendConfirmation({ request, generating, onCancel, onSend }: {
  request?: ExplanationSendRequest; generating: boolean; onCancel(): void; onSend(project?: boolean): void
}): JSX.Element {
  const { t } = useI18n('common')
  return <UiModal size="compact" title={t('paidApproval.sendExplanation')} isOpen={!!request} onClose={onCancel} footer={<>
    <UiButton variant="quiet" disabled={generating} onClick={onCancel}>{t('paidApproval.deny')}</UiButton>
    {request?.hasProject && <UiButton variant="quiet" disabled={generating} onClick={() => onSend(true)}>{t('paidApproval.alwaysAllowProject')}</UiButton>}
    <UiButton variant="primary" disabled={generating} onClick={() => onSend(false)}>{t('paidApproval.allowOnce')}</UiButton>
  </>}>
    {request && <div className="space-y-4">
      <p className={UI_TEXT_BODY_CLASS}>{t('paidApproval.explanationContent', { count: request.imageCount, modelName: request.modelName })}</p>
      <p className={`whitespace-pre-line ${UI_TEXT_BODY_CLASS}`}>{formatPaidApprovalMessage(request.paidDetails)}</p>
    </div>}
  </UiModal>
}
