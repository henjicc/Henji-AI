import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelTrigger, UiButton, UiError, UiLoading, UiOptionButton } from '@/components/ui'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useLocalModels, formatLocalModelSize } from '@/components/Settings/hooks/useLocalModels'
import { useImageEditorSubjectV3 } from './ImageEditorSubjectContextV3'

export function ImageEditorSubjectParametersV3(): JSX.Element | null {
  const { t } = useTranslation('ui'), subject = useImageEditorSubjectV3(), [page, setPage] = useState(0)
  const models = useLocalModels()
  const downloading = subject?.busy ? models.models.find(model => ['object_tracking_efficienttam', 'person_matting_rvm', 'selfie_segmentation'].includes(model.id) && model.status === 'downloading') : undefined
  const percent = downloading?.progress ? Math.floor(downloading.progress.receivedBytes / Math.max(1, downloading.progress.totalBytes) * 100) : 0
  useEffect(() => setPage(0), [subject?.candidates])
  if (!subject) return null
  return <>
    <UiButton size="sm" disabled={subject.busy} onClick={() => void subject.run({ kind: 'subject' })}>{t('imageEditor.v3.subject.auto')}</UiButton>
    <UiButton size="sm" disabled={subject.busy} onClick={() => void subject.run({ kind: 'portrait', quality: 'fine' })}>{t('imageEditor.v3.subject.portrait')}</UiButton>
    {subject.candidates.length ? <PanelTrigger panelWidth="content" closeOnPanelClick={false} renderPanel={() => <div className="flex flex-col gap-1 whitespace-nowrap p-2">
      {subject.candidates.slice(page * 8, (page + 1) * 8).map((candidate, index) => <UiOptionButton key={candidate.id} variant="menu" onClick={() => void subject.run({ kind: 'subject' }, candidate.id)}>{t('imageEditor.v3.subject.candidate', { number: page * 8 + index + 1, area: Math.round(candidate.area * 100) })}</UiOptionButton>)}
      <div className="flex items-center justify-between gap-2"><UiButton size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('imageEditor.v3.subject.previous')}</UiButton><UiButton size="sm" disabled={(page + 1) * 8 >= subject.candidates.length} onClick={() => setPage(page + 1)}>{t('imageEditor.v3.subject.next')}</UiButton></div>
    </div>}>
      {({ togglePanel, open }) => <UiButton size="sm" aria-expanded={open} onClick={togglePanel}>{t('imageEditor.v3.subject.choose')}</UiButton>}
    </PanelTrigger> : null}
    {downloading ? <><span className="text-xs text-text3">{t('imageEditor.v3.repair.download-hint', { size: formatLocalModelSize(downloading.sizeBytes) })}</span><ProgressBar appearance="hairline" progress={percent} /><UiButton size="sm" onClick={() => { subject.cancel(); models.cancel(downloading.id) }}>{t('imageEditor.v3.repair.cancel-download')}</UiButton></> : null}
    {subject.busy ? <><UiLoading size="xs" message={t('imageEditor.v3.subject.processing')} /><UiButton size="sm" onClick={subject.cancel}>{t('imageEditor.v3.selection.cancel-task')}</UiButton></> : null}
    {subject.error ? <UiError size="xs" message={subject.error} /> : null}
  </>
}
