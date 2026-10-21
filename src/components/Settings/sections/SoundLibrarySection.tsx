import React from 'react'
import { FolderPlus, RefreshCw, Trash2 } from 'lucide-react'

import { UI_TEXT_META_CLASS, UiButton, UiEmpty, UiError, UiFormRow, UiIconButton, UiInlineStatus } from '@/components/ui'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useI18n } from '@/hooks/useI18n'
import type { SoundLibraryFolderInfo } from '@/platform/contracts/soundLibrary'
import { useSoundLibrary, type SoundLibraryView } from '../hooks/useSoundLibrary'

/**
 * 文件与下载 › 音效库：登记自己收集的音效文件夹，供助手按意图挑音效、卡点。
 * 每行只放用户据此行动的信息：文件夹、音效数量、整理进度、跳过了哪些坏文件，以及重新整理与取消登记。
 */
const SoundLibrarySection: React.FC = () => {
  const { t } = useI18n('settings')
  const view = useSoundLibrary()
  return (
    <UiFormRow label={t('sections.soundLibrary.listLabel')} info={t('sections.soundLibrary.listHint')}>
      {view.loadFailed ? <UiError message={t('sections.soundLibrary.loadFailed')} onRetry={view.reload} /> : (
        <div className="space-y-3">
          {view.state && !view.state.folders.length ? <UiEmpty title={t('sections.soundLibrary.empty')} /> : null}
          {view.state?.folders.map((folder) => <SoundFolderRow key={folder.id} folder={folder} view={view} />)}
          <div className="flex items-center gap-2">
            <UiButton size="sm" variant="secondary" onClick={view.add}><FolderPlus />{t('sections.soundLibrary.add')}</UiButton>
            {view.actionFailed ? <UiInlineStatus>{t('sections.soundLibrary.actionFailed')}</UiInlineStatus> : null}
          </div>
        </div>
      )}
    </UiFormRow>
  )
}

const SoundFolderRow: React.FC<{ folder: SoundLibraryFolderInfo; view: SoundLibraryView }> = ({ folder, view }) => {
  const { t } = useI18n('settings')
  const meta = folder.status === 'not_indexed' ? t('sections.soundLibrary.notIndexed')
    : [t('sections.soundLibrary.count', { count: folder.soundCount }), ...(folder.listeningCount ? [t('sections.soundLibrary.listening', { count: folder.listeningCount })] : [])].join(' · ')
  const progress = folder.progress && folder.progress.total > 0 ? Math.floor(folder.progress.done / folder.progress.total * 100) : 0
  const skipped = folder.skipped.map((file) => `${file.relativePath}（${file.reason}）`).join('；')
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-13 text-text1">{folder.name}</div>
        <div className="truncate text-xs text-text3" data-observation-sensitive>{folder.path}</div>
        <div className={UI_TEXT_META_CLASS}>{folder.status === 'indexing' && folder.progress ? t('sections.soundLibrary.indexing', folder.progress) : meta}</div>
        {folder.status === 'indexing' && folder.progress?.total ? <ProgressBar appearance="hairline" progress={progress} className="mt-1.5" /> : null}
        {folder.lastError ? <UiInlineStatus className="mt-0.5">{folder.lastError}</UiInlineStatus> : null}
        {folder.skipped.length ? <UiInlineStatus tone="warning" className="mt-0.5" truncate tooltip={skipped}>{t('sections.soundLibrary.skipped', { count: folder.skipped.length, files: skipped })}</UiInlineStatus> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <UiIconButton size="xs" tooltip={t('sections.soundLibrary.refresh', { name: folder.name })} aria-label={t('sections.soundLibrary.refresh', { name: folder.name })} disabled={folder.status === 'indexing'} disabledReason={t('sections.soundLibrary.indexing', folder.progress ?? { done: 0, total: 0 })} onClick={() => view.refresh(folder.id)}>
          <RefreshCw />
        </UiIconButton>
        <UiIconButton size="xs" tone="danger" tooltip={t('sections.soundLibrary.remove', { name: folder.name })} aria-label={t('sections.soundLibrary.remove', { name: folder.name })} onClick={() => view.remove(folder.id)}>
          <Trash2 />
        </UiIconButton>
      </div>
    </div>
  )
}

export default SoundLibrarySection
