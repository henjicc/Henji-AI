import { UiButton, UiCheckbox, UiModal } from '@/components/ui'
import { UI_TEXT_BODY_CLASS } from '@/components/ui/styleTokens'
import type { ExplanationSendRequest } from '../application/explanationGeneration'

export function ExplanationSendConfirmation({ request, generating, rememberSend, setRememberSend, onCancel, onSend }: {
  request?: ExplanationSendRequest; generating: boolean; rememberSend: boolean; setRememberSend(value: boolean): void; onCancel(): void; onSend(): void
}): JSX.Element {
  return (<UiModal size="compact" title="发送讲解给 AI？" isOpen={!!request} onClose={onCancel} footer={<>
      <UiButton variant="secondary" disabled={generating} onClick={onCancel}>取消</UiButton>
      <UiButton variant="primary" disabled={generating} onClick={onSend}>发送</UiButton>
    </>}>
      {request && <div className="space-y-4">
        <p className={UI_TEXT_BODY_CLASS}>将发送讲解文字和 {request.imageCount} 张画面给 {request.modelName}，{request.estimatedCost ? `预计 ${request.estimatedCost}` : '费用以供应商为准'}。</p>
        <label className={`flex items-center gap-2 ${UI_TEXT_BODY_CLASS}`}><UiCheckbox aria-label="本次讲解不再询问" checked={rememberSend} onCheckedChange={setRememberSend} disabled={generating} />本次讲解不再询问</label>
      </div>}
    </UiModal>)
}
