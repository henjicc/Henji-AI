import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'

const logger = createLogger('components.UpdateDialog')
/**
 * 更新提示对话框组件
 * 当检测到新版本时显示，提供更新、忽略或取消选项
 */

import React, { useState } from 'react'
import {
  ReleaseInfo,
  downloadElectronUpdate,
  formatReleaseDate,
  installElectronUpdate,
} from '../services/updateChecker'
import { addIgnoredVersion } from '../utils/updateConfig'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiIconButton, UiModal } from '@/components/ui'

interface UpdateDialogProps {
  releaseInfo: ReleaseInfo
  currentVersion: string
  onClose: () => void
}

const UpdateDialog: React.FC<UpdateDialogProps> = ({ releaseInfo, currentVersion, onClose }) => {
  const { t } = useI18n('ui')
  const [isUpdating, setIsUpdating] = useState(false)

  // 关闭动画由 UiModal 的 useDialogTransition 负责，这里直接回调
  const handleClose = () => {
    onClose()
  }

  const handleUpdate = async () => {
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
        }
        return
      }
      // 打开 GitHub Release 页面
      await getPlatform().system.shell.openExternal(releaseInfo.htmlUrl)
      handleClose()
    } catch (error) {
      logger.error('打开更新页面失败:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleIgnore = () => {
    // 将此版本添加到忽略列表
    addIgnoredVersion(releaseInfo.version)
    handleClose()
  }

  const actionLabel = releaseInfo.source === 'electron-updater'
    ? releaseInfo.updateStatus === 'downloaded'
      ? t('updateDialog.actions.installNow', { defaultValue: '重启安装' })
      : releaseInfo.updateStatus === 'downloading'
        ? t('updateDialog.actions.downloading', {
            defaultValue: `下载中 ${Math.round(releaseInfo.progressPercent || 0)}%`
          })
        : t('updateDialog.actions.updateNow')
    : t('updateDialog.actions.updateNow')

  // 解析更新说明（Markdown 格式）
  const renderReleaseNotes = () => {
    if (!releaseInfo.body) {
      return <p className="text-zinc-400 text-sm">{t('updateDialog.noNotes')}</p>
    }

    // 简单的 Markdown 解析（支持标题、列表、粗体）
    const lines = releaseInfo.body.split('\n')
    return (
      <div className="space-y-2 text-sm">
        {lines.map((line, index) => {
          // 标题
          if (line.startsWith('### ')) {
            return (
              <h4 key={index} className="text-white font-semibold mt-3 mb-1">
                {line.replace('### ', '')}
              </h4>
            )
          }
          if (line.startsWith('## ')) {
            return (
              <h3 key={index} className="text-white font-bold text-base mt-4 mb-2">
                {line.replace('## ', '')}
              </h3>
            )
          }
          // 列表项
          if (line.startsWith('- ') || line.startsWith('* ')) {
            return (
              <div key={index} className="flex items-start gap-2 text-zinc-300 ml-2">
                <span className="text-accent mt-1">•</span>
                <span>{line.replace(/^[-*] /, '')}</span>
              </div>
            )
          }
          // 空行
          if (line.trim() === '') {
            return <div key={index} className="h-1" />
          }
          // 普通文本
          return (
            <p key={index} className="text-zinc-300">
              {line}
            </p>
          )
        })}
      </div>
    )
  }

  return (
    <UiModal
      isOpen
      title={t('update.title')}
      onClose={handleClose}
      hideHeader
      widthClassName="w-full max-w-2xl overflow-hidden"
      contentClassName=""
    >
        {/* 头部 */}
        <div className="bg-gradient-to-r from-accent/10 to-transparent p-6 border-b border-zinc-700/50">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-8 w-8 text-accent"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <div>
                  <h2 className="text-xl font-bold text-white">{t('updateDialog.title')}</h2>
                  <p className="text-sm text-zinc-400 mt-1">
                    {releaseInfo.name || t('updateDialog.versionFallback', { version: releaseInfo.version })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-zinc-500 mt-3">
                <span className="flex items-center gap-1">
                  <span className="text-zinc-400">{t('updateDialog.currentVersionLabel')}</span>
                  <span className="font-mono text-zinc-300">{currentVersion}</span>
                </span>
                <span className="text-zinc-600">→</span>
                <span className="flex items-center gap-1">
                  <span className="text-zinc-400">{t('updateDialog.latestVersionLabel')}</span>
                  <span className="font-mono text-accent">{releaseInfo.version}</span>
                </span>
                <span className="text-zinc-600">•</span>
                <span>{formatReleaseDate(releaseInfo.publishedAt)}</span>
              </div>
            </div>
            <UiIconButton
              onClick={handleClose}
              className="rounded-full text-zinc-400 hover:text-white"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </UiIconButton>
          </div>
        </div>

        {/* 更新说明 */}
        <div className="p-6 max-h-[400px] overflow-y-auto custom-scrollbar">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            {t('updateDialog.notesTitle')}
          </h3>
          {renderReleaseNotes()}
        </div>

        {/* 底部按钮 */}
        <div className="p-6 border-t border-zinc-700/50 bg-zinc-900/20 flex items-center justify-end gap-3">
          <UiButton
            onClick={handleIgnore}
            variant="muted"
            size="sm"
            className="px-5"
          >
            {t('updateDialog.actions.skip')}
          </UiButton>
          <UiButton
            onClick={handleClose}
            variant="muted"
            size="sm"
            className="px-5"
          >
            {t('updateDialog.actions.remindLater')}
          </UiButton>
          <UiButton
            onClick={handleUpdate}
            disabled={isUpdating || releaseInfo.updateStatus === 'downloading'}
            variant="primary"
            size="sm"
            className="px-5 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
          >
            {isUpdating ? t('updateDialog.actions.downloading', { defaultValue: '下载中' }) : actionLabel}
          </UiButton>
        </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;

        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(39, 39, 42, 0.3);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(113, 113, 122, 0.5);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(113, 113, 122, 0.7);
        }
      `}</style>
    </UiModal>
  )
}

export default UpdateDialog

