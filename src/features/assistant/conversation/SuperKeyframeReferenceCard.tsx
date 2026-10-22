import { useState, useSyncExternalStore } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { UiButton, UiDisclosurePanel, UiError, UiIconButton, UI_TEXT_META_CLASS } from '@/components/ui'
import type { SuperKeyframeAttachment } from '@/core/assistant/attachments'
import { listVideoEditInstances, subscribeVideoEditDomain, videoEditDomainRevision, removeSuperKeyframeTake, superKeyframeAttachment } from '@/features/videoEdit'

export function SuperKeyframeReferenceCard({ attachment, disabled, onChange }: { attachment: SuperKeyframeAttachment; disabled?: boolean; onChange?: (value: SuperKeyframeAttachment) => void }): JSX.Element {
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const [open, setOpen] = useState(false), [error, setError] = useState<string>(), [busy, setBusy] = useState(false)
  const [documentId, encodedDraft] = attachment.draftRef.id.split(':')
  const draftId = decodeURIComponent(encodedDraft ?? '')
  const owner = listVideoEditInstances().find(value => value.document.id === documentId)
  const draft = owner?.document.creativeIntents?.drafts.find(value => value.id === draftId)
  const summary = attachment.summary
  const remove = async (takeId: string): Promise<void> => {
    setBusy(true); setError(undefined)
    try { await removeSuperKeyframeTake(documentId, draftId, takeId); onChange?.(superKeyframeAttachment(documentId, draftId)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '删除失败，请重试。') }
    finally { setBusy(false) }
  }
  return <div className="min-w-0 flex-1">
    <UiButton variant="quiet" size="sm" onClick={() => setOpen(value => !value)} aria-expanded={open}><ChevronDown />超级关键帧 · {draft?.takes.length ?? summary.takeCount} 段</UiButton>
    <div className={UI_TEXT_META_CLASS}>{summary.durationSeconds.toFixed(1)} 秒 · {summary.elements.join('、')} · {summary.hasNarration ? '含讲解' : '操作记录'}</div>
    <UiDisclosurePanel open={open}>
      {!draft ? <div className={UI_TEXT_META_CLASS}>请打开原剪辑工程以查看段落。</div> : draft.takes.map((take, index) => <div key={take.id} className="flex items-center justify-between gap-2">
        <span className={UI_TEXT_META_CLASS}>第 {index + 1} 段 · {((take.monoSpanUs[1] - take.monoSpanUs[0]) / 1_000_000).toFixed(1)} 秒{take.timelineRange ? ` · 帧 ${take.timelineRange.join('–')}` : ''}</span>
        {onChange && <UiIconButton size="xs" tooltip={`删除第 ${index + 1} 段`} aria-label={`删除第 ${index + 1} 段`} disabled={disabled || busy} onClick={() => { void remove(take.id) }}><Trash2 /></UiIconButton>}
      </div>)}
    </UiDisclosurePanel>
    {error && <UiError size="xs" message={error} />}
  </div>
}
