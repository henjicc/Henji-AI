import { useTranslation } from 'react-i18next'
import { CheckCircle2, FolderOpen } from 'lucide-react'
import { UiButton, UiError, UiLoading } from '@/components/ui'
import { UI_ICON_SIZE_CLASS, UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import type { RecordingQuickExport } from './application/recordingService'
import { formatRecordingTime } from './recordingSetupModel'

const keepOpen = (): void => {}

/** Quick mode ends here: the saved file itself, where it is, and what to do with it next. */
export function RecordingQuickResult({ result, onReveal, onRetry, onOpenWorkbench }: { result: RecordingQuickExport; onReveal(): void; onRetry(): void; onOpenWorkbench(): void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const name = result.path?.split(/[\\/]/).at(-1) ?? ''
  const folder = result.path ? result.path.slice(0, result.path.length - name.length - 1) : ''
  return <div className="flex min-h-0 flex-1" data-recording-quick-result={result.status}>
    <div className="flex min-w-0 flex-1 items-center justify-center bg-gap p-4" style={{ containerType: 'size' }}>
      {result.status === 'saved' && result.path
        ? <div style={{ width: `min(100cqw, 100cqh * ${16 / 9})` }}><VideoViewerModal open presentation="inline" videoUrl={resolveImageDisplayUrl(result.path)} filePath={result.path} onClose={keepOpen} mediaTestId="recording-quick-video" /></div>
        : result.status === 'saving' ? <UiLoading message={t('recording.quickSaving')} /> : <UiError message={result.error ?? ''} onRetry={onRetry} />}
    </div>
    <aside className="flex w-80 shrink-0 flex-col gap-4 border-l border-gap bg-panel p-4" aria-label={t('recording.quickResult')}>
      {result.status === 'saved' && <>
        <span className="flex items-center gap-2 text-sm font-medium text-text1"><CheckCircle2 className={`${UI_ICON_SIZE_CLASS.md} text-success-text`} aria-hidden />{t('recording.quickSaved')}</span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="break-all text-13 text-text1" data-observation-sensitive>{name}</span>
          <span className="break-all text-xs text-text2" data-observation-sensitive>{folder}</span>
          {result.durationUs !== undefined && <span className={`${UI_TEXT_TIMECODE_CLASS} text-xs text-text2`}>{formatRecordingTime(result.durationUs / 1e6)}</span>}
        </div>
        <div><UiButton variant="secondary" onClick={onReveal}><FolderOpen />{t('recording.revealFile')}</UiButton></div>
        <p className="text-xs text-text3">{t('recording.quickDataHint')}</p>
      </>}
      <div className="mt-auto flex flex-col gap-2">
        <p className="text-xs text-text3">{t('recording.quickWorkbenchHint')}</p>
        <div><UiButton size="sm" onClick={onOpenWorkbench}>{t('recording.openWorkbench')}</UiButton></div>
      </div>
    </aside>
  </div>
}
