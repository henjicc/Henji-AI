import { UiButton, UiModal } from '@/components/ui'
import { UI_TEXT_BODY_CLASS } from '@/components/ui/styleTokens'
import type { ExplanationSendRequest } from '../application/explanationGeneration'

export function ExplanationSendConfirmation({ request, generating, onCancel, onSend }: {
  request?: ExplanationSendRequest; generating: boolean; onCancel(): void; onSend(project?: boolean): void
}): JSX.Element {
  return <UiModal size="compact" title="发送讲解给 AI？" isOpen={!!request} onClose={onCancel} footer={<>
    <UiButton variant="quiet" disabled={generating} onClick={onCancel}>拒绝</UiButton>
    {request?.hasProject && <UiButton variant="quiet" disabled={generating} onClick={() => onSend(true)}>本项目始终允许</UiButton>}
    <UiButton variant="primary" disabled={generating} onClick={() => onSend(false)}>允许本次</UiButton>
  </>}>
    {request && <div className="space-y-4">
      <p className={UI_TEXT_BODY_CLASS}>将发送讲解文字和 {request.imageCount} 张画面给 {request.modelName}。</p>
      <p className={`whitespace-pre-line ${UI_TEXT_BODY_CLASS}`}>{request.costMessage}</p>
    </div>}
  </UiModal>
}
