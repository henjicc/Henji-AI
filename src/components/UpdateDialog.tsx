/**
 * 更新提示对话框：检测到新版本时显示，提供跳过此版本、稍后提醒、立即更新。
 *
 * 外观（任务 5.7 重做）：标准 `UiModal` 骨架（标题栏 + 正文 + 底部动作区），不再自画渐变头带与关闭按钮；
 * 版本行用图标而不是符号字符；下载中显示进度；下载或打开失败时在正文给出原因，主动作即重试。
 */
import React, { useState } from 'react'
import { ArrowRight } from 'lucide-react'

import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import {
  ReleaseInfo,
  downloadElectronUpdate,
  formatReleaseDate,
  installElectronUpdate,
} from '../services/updateChecker'
import { addIgnoredVersion } from '../utils/updateConfig'
import { useI18n } from '@/hooks/useI18n'
import { ProgressBar } from '@/components/ui/ProgressBar'
import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_TIMECODE_CLASS,
  UiButton,
  UiModal,
} from '@/components/ui'

const logger = createLogger('components.UpdateDialog')

interface UpdateDialogProps {
  releaseInfo: ReleaseInfo
  currentVersion: string
  onClose: () => void
}

/** 更新说明（Markdown 子集：二三级标题、列表、段落）。 */
function ReleaseNotes({ body, emptyText }: { body: string; emptyText: string }): JSX.Element {
  if (!body.trim()) {
    return <p className="text-13 text-text2">{emptyText}</p>
  }
  const blocks: JSX.Element[] = []
  let list: string[] = []
  const flushList = (): void => {
    if (list.length === 0) return
    blocks.push(
      <ul key={`list-${blocks.length}`} className="list-disc space-y-1 pl-5 text-text2 marker:text-text3">
        {list.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    )
    list = []
  }
  for (const line of body.split('\n')) {
    if (/^[-*] /.test(line)) {
      list.push(line.replace(/^[-*] /, ''))
      continue
    }
    flushList()
    if (line.trim() === '') continue
    const heading = /^(#{2,3}) (.*)$/.exec(line)
    if (heading) {
      blocks.push(<h4 key={`h-${blocks.length}`} className="pt-1 text-13 font-medium text-text1">{heading[2]}</h4>)
      continue
    }
    blocks.push(<p key={`p-${blocks.length}`} className="text-text2">{line}</p>)
  }
  flushList()
  return <div className="space-y-2 text-13">{blocks}</div>
}

const UpdateDialog: React.FC<UpdateDialogProps> = ({ releaseInfo, currentVersion, onClose }) => {
  const { t } = useI18n('ui')
  const [isUpdating, setIsUpdating] = useState(false)
  // 本次点击产生的失败；更新器推送的失败（下载中断）从 releaseInfo 读取
  const [localFailure, setLocalFailure] = useState<string | null>(null)
  const failure = localFailure
    ?? (releaseInfo.updateStatus === 'error' ? releaseInfo.errorMessage || t('updateDialog.failedUnknown') : null)

  const handleUpdate = async () => {
    setLocalFailure(null)
    try {
      if (releaseInfo.source === 'electron-updater') {
        if (releaseInfo.updateStatus === 'downloaded') {
          await installElectronUpdate()
          return
        }
        setIsUpdating(true)
        const result = await downloadElectronUpdate()
        if (result.status === 'downloaded') {
          await installElectronUpdate()
          return
        }
        if (result.status === 'error') {
          setLocalFailure(result.errorMessage || t('updateDialog.failedUnknown'))
        }
        return
      }
      // 打开 GitHub Release 页面
      await getPlatform().system.shell.openExternal(releaseInfo.htmlUrl)
      onClose()
    } catch (error) {
      logger.error('更新失败', error)
      setLocalFailure(error instanceof Error && error.message ? error.message : t('updateDialog.failedUnknown'))
    } finally {
      setIsUpdating(false)
    }
  }

  const handleIgnore = () => {
    addIgnoredVersion(releaseInfo.version)
    onClose()
  }

  const downloading = isUpdating || releaseInfo.updateStatus === 'downloading'
  const progress = releaseInfo.updateStatus === 'downloading' ? releaseInfo.progressPercent : undefined
  const actionLabel = releaseInfo.source === 'electron-updater' && releaseInfo.updateStatus === 'downloaded'
    ? t('updateDialog.actions.installNow')
    : downloading
      ? t('updateDialog.actions.downloading')
      : failure
        ? t('updateDialog.actions.retry')
        : t('updateDialog.actions.updateNow')

  return (
    <UiModal
      isOpen
      title={t('updateDialog.title')}
      onClose={onClose}
      size="form"
      contentClassName="min-h-0 overflow-y-auto px-4 py-4"
      footer={
        <>
          <UiButton onClick={handleIgnore} variant="secondary">
            {t('updateDialog.actions.skip')}
          </UiButton>
          <UiButton onClick={onClose} variant="secondary">
            {t('updateDialog.actions.remindLater')}
          </UiButton>
          <UiButton onClick={() => void handleUpdate()} disabled={downloading} variant="primary">
            {actionLabel}
          </UiButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <div className={`${UI_TEXT_BODY_CLASS} font-medium text-text1`}>
            {releaseInfo.name || t('updateDialog.versionFallback', { version: releaseInfo.version })}
          </div>
          <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${UI_TEXT_META_CLASS}`}>
            <span className={UI_TEXT_TIMECODE_CLASS}>{currentVersion}</span>
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-text3" />
            <span className={`${UI_TEXT_TIMECODE_CLASS} text-accent-text`}>{releaseInfo.version}</span>
            <span>{formatReleaseDate(releaseInfo.publishedAt)}</span>
          </div>
        </div>

        {downloading ? (
          <ProgressBar
            progress={progress ?? 0}
            showPercentage={progress !== undefined}
            height="h-1.5"
          />
        ) : null}

        {failure ? (
          <p role="alert" className="text-13 text-danger-text">
            {t('updateDialog.failed', { reason: failure })}
          </p>
        ) : null}

        <section className="space-y-2">
          <h3 className={UI_TEXT_LABEL_CLASS}>{t('updateDialog.notesTitle')}</h3>
          <ReleaseNotes body={releaseInfo.body} emptyText={t('updateDialog.noNotes')} />
        </section>
      </div>
    </UiModal>
  )
}

export default UpdateDialog
