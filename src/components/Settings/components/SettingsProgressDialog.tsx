import React from 'react'
import { UiModal } from '@/components/ui'
import { ProgressBar } from '@/components/ui/ProgressBar'
import type { MigrationProgress } from '../hooks/useDataPath'

interface SettingsProgressDialogProps {
  open: boolean
  title: string
  hint: string
  progress: MigrationProgress
}

/**
 * 数据迁移进度弹窗。
 *
 * 刻意不可关闭：迁移过程中不能让用户点遮罩把它关掉，所以 onClose 传空函数。
 */
const SettingsProgressDialog: React.FC<SettingsProgressDialogProps> = ({ open, title, hint, progress }) => {
  const ratio = progress.total > 0 ? (progress.current / progress.total) * 100 : 0
  return (
    <UiModal
      isOpen={open}
      title={title}
      onClose={() => { /* 迁移进行中，刻意不允许关闭 */ }}
      hideHeader
      widthClassName="w-[400px]"
      contentClassName="p-4"
    >
      <div className="text-base text-white">{title}</div>
      <div className="mt-4">
        <div className="mb-2 truncate text-sm text-zinc-300">{progress.file}</div>
        <div className="mb-2 text-xs text-zinc-400">{progress.current} / {progress.total}</div>
        <ProgressBar progress={ratio} showPercentage={false} duration={300} />
      </div>
      <div className="mt-4 text-xs text-zinc-400">{hint}</div>
    </UiModal>
  )
}

export default SettingsProgressDialog
