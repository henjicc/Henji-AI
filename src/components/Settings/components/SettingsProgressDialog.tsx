import React from 'react'
import { UI_TEXT_META_CLASS, UI_TEXT_TITLE_CLASS, UiButton, UiModal } from '@/components/ui'
import { ProgressBar } from '@/components/ui/ProgressBar'
import type { MigrationProgress } from '../hooks/useDataPath'

interface SettingsProgressDialogProps {
  open: boolean
  title: string
  hint: string
  progress: MigrationProgress
  /** 提供时显示“取消”按钮（只在可安全回滚的阶段传入）。 */
  onCancel?: () => void
  cancelLabel?: string
}

/**
 * 作品目录移动进度弹窗。
 *
 * 刻意不可关闭：移动过程中不能让用户点遮罩把它关掉，所以 onClose 传空函数；
 * 可回滚的阶段由调用方提供“取消”。
 */
const SettingsProgressDialog: React.FC<SettingsProgressDialogProps> = ({ open, title, hint, progress, onCancel, cancelLabel }) => {
  const ratio = progress.total > 0 ? (progress.current / progress.total) * 100 : 0
  return (
    <UiModal
      isOpen={open}
      title={title}
      onClose={() => { /* 迁移进行中，刻意不允许关闭 */ }}
      hideHeader
      size="compact"
      contentClassName="p-4"
      footer={onCancel ? (
        <UiButton size="lg" variant="secondary" onClick={onCancel}>{cancelLabel}</UiButton>
      ) : undefined}
    >
      <div className={UI_TEXT_TITLE_CLASS}>{title}</div>
      <div className="mt-4">
        <div data-observation-sensitive className="mb-2 truncate text-text2">{progress.file}</div>
        {/* 第一份文件复制完之前总数还不知道：不显示“0 / 0”（5.8 补截发现） */}
        {progress.total > 0 ? <div className={`mb-2 ${UI_TEXT_META_CLASS}`}>{progress.current} / {progress.total}</div> : null}
        <ProgressBar progress={ratio} showPercentage={false} duration={300} />
      </div>
      <div className={`mt-4 ${UI_TEXT_META_CLASS}`}>{hint}</div>
    </UiModal>
  )
}

export default SettingsProgressDialog
