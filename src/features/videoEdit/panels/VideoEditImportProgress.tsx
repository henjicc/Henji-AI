import { useSyncExternalStore } from 'react'
import { UiButton, UiPanel } from '@/components/ui'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { cancelVideoEditImport, videoEditImportTask, subscribeVideoEditImport, videoEditImportRevision } from '../application/videoEditImportTask'

/** Persistent, non-modal feedback using the shared panel and progress primitives. */
export function VideoEditImportProgress({ projectId }: { projectId: string }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditImport, videoEditImportRevision)
  const task = videoEditImportTask(projectId)
  if (!task) return null
  const known = Boolean(task.totalKnown)
  const label = known ? `正在导入 ${task.completed.toLocaleString()} / ${task.total.toLocaleString()}` : `正在查找素材 · 已发现 ${(task.discovered ?? task.total).toLocaleString()} 个`
  return <UiPanel className="absolute bottom-4 right-4 z-panel w-80 max-w-full p-3" aria-label="素材导入进度">
    <div className="mb-2 flex items-center justify-between gap-3">
      <span className="text-13 tabular-nums text-text1" role="status">{label}</span>
      <UiButton size="sm" aria-label="取消整个导入队列" disabled={task.controller.signal.aborted} onClick={() => cancelVideoEditImport(projectId)}>{task.controller.signal.aborted ? '正在取消' : '取消'}</UiButton>
    </div>
    <div role="progressbar" aria-label="素材导入进度" aria-valuemin={known ? 0 : undefined} aria-valuemax={known ? task.total : undefined} aria-valuenow={known ? task.completed : undefined} className={known ? '' : 'animate-pulse'}>
      <ProgressBar progress={known ? task.total ? task.completed / task.total * 100 : 0 : 35} showPercentage={false} duration={0} />
    </div>
  </UiPanel>
}
