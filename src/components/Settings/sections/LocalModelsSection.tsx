import React from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'

import { UI_TEXT_META_CLASS, UiButton, UiError, UiFormRow, UiIconButton } from '@/components/ui'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useI18n } from '@/hooks/useI18n'
import { LOCAL_MODEL_DOWNLOAD_SOURCES, type LocalModelInfo } from '@/platform/contracts/localModels'
import SettingsSegmented from '../components/SettingsSegmented'
import { formatLocalModelSize, useLocalModels, type LocalModelsView } from '../hooks/useLocalModels'

/**
 * 文件与下载 › 本地模型（任务 4.11）：抠像、检测、跟踪在本机运行的小模型。
 * 第一次用到时会自动下载，这里只给需要提前下载、腾空间或换下载源的人用。
 * 每行只放用户需要据此行动的信息：名称、用途、大小、许可证、状态与对应动作。
 */
const LocalModelsSection: React.FC = () => {
  const { t } = useI18n('settings')
  const view = useLocalModels()

  return (
    <>
      <UiFormRow label={t('sections.localModels.sourceLabel')} info={t('sections.localModels.sourceHint')} inline>
        <SettingsSegmented
          value={view.downloadSource}
          options={LOCAL_MODEL_DOWNLOAD_SOURCES.map((value) => ({ value, label: t(`sections.localModels.source.${value}`) }))}
          onChange={view.changeDownloadSource}
          ariaLabel={t('sections.localModels.sourceLabel')}
        />
      </UiFormRow>

      <UiFormRow label={t('sections.localModels.listLabel')} info={t('sections.localModels.listHint')}>
        {view.loadFailed ? (
          <UiError message={t('sections.localModels.loadFailed')} onRetry={view.reload} />
        ) : (
          <div className="space-y-3">
            {view.models.map((model) => <LocalModelRow key={model.id} model={model} view={view} />)}
          </div>
        )}
      </UiFormRow>
    </>
  )
}

const LocalModelRow: React.FC<{ model: LocalModelInfo; view: LocalModelsView }> = ({ model, view }) => {
  const { t, i18n } = useI18n('settings')
  const zh = i18n.language.startsWith('zh')
  const title = zh ? model.title.zh : model.title.en
  const purpose = zh ? model.purpose.zh : model.purpose.en
  const percent = model.progress && model.progress.totalBytes > 0
    ? Math.floor((model.progress.receivedBytes / model.progress.totalBytes) * 100)
    : 0
  const meta = model.status === 'unavailable'
    ? model.license
    : `${formatLocalModelSize(model.sizeBytes)} · ${model.license}`

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-13 text-text1">{title}</div>
        <div className="truncate text-xs text-text3">{purpose}</div>
        <div className={UI_TEXT_META_CLASS}>{meta}</div>
        {model.status === 'downloading' ? <ProgressBar appearance="hairline" progress={percent} className="mt-1.5" /> : null}
        {model.lastFailure && model.status !== 'downloading' && model.lastFailure !== 'cancelled' ? (
          <div className="mt-0.5 text-xs text-danger-text">{t(`sections.localModels.failure.${model.lastFailure}`)}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <LocalModelActions model={model} view={view} percent={percent} title={title} />
      </div>
    </div>
  )
}

const LocalModelActions: React.FC<{ model: LocalModelInfo; view: LocalModelsView; percent: number; title: string }> = ({ model, view, percent, title }) => {
  const { t } = useI18n('settings')
  switch (model.status) {
    case 'downloading':
      return (
        <>
          <span className={UI_TEXT_META_CLASS}>{percent}%</span>
          <UiButton size="sm" onClick={() => view.cancel(model.id)}>{t('sections.localModels.cancel')}</UiButton>
        </>
      )
    case 'ready':
      return (
        <>
          <span className={UI_TEXT_META_CLASS}>{t('sections.localModels.status.ready')}</span>
          <UiIconButton
            size="sm"
            title={t('sections.localModels.openFolder')}
            aria-label={t('sections.localModels.openFolder')}
            onClick={() => view.openFolder(model.id)}
          >
            <FolderOpen className="h-4 w-4" />
          </UiIconButton>
          <UiIconButton
            size="sm"
            tone="danger"
            title={t('sections.localModels.remove', { name: title })}
            aria-label={t('sections.localModels.remove', { name: title })}
            onClick={() => view.remove(model.id)}
          >
            <Trash2 className="h-4 w-4" />
          </UiIconButton>
        </>
      )
    case 'unavailable':
      return <span className={UI_TEXT_META_CLASS}>{t('sections.localModels.status.unavailable')}</span>
    case 'corrupt':
      return (
        <>
          <span className="text-xs text-danger-text">{t('sections.localModels.status.corrupt')}</span>
          <UiButton size="sm" variant="secondary" onClick={() => view.download(model.id)}>{t('sections.localModels.redownload')}</UiButton>
        </>
      )
    default:
      return (
        <UiButton size="sm" variant="secondary" onClick={() => view.download(model.id)}>
          {model.lastFailure && model.lastFailure !== 'cancelled' ? t('sections.localModels.retry') : t('sections.localModels.download')}
        </UiButton>
      )
  }
}

export default LocalModelsSection
