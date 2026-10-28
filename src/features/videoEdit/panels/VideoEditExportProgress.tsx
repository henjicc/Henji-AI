import { useEffect, useState, useSyncExternalStore } from 'react'
import { UiButton, UiError, UiModal } from '@/components/ui'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { videoEditExportJobProgress, videoEditExportQueue } from '../application/videoEditExportQueue'
import { subscribeVideoEdit, videoEditRevision } from '../application/videoEditService'

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

/** UI、助手和批量队列的任务共用同一个进度宿主，不依赖导出设置面板是否打开。 */
export function VideoEditExportProgress(): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const [dismissed, setDismissed] = useState<string>()
  const jobs = videoEditExportQueue.list()
  const job = jobs.find(value => value.state === 'running') ?? jobs.find(value => value.state === 'queued') ?? jobs.at(-1)
  const attempt = job && `${job.id}:${job.startedAt ?? ''}`
  if (!job || attempt === dismissed && job.state !== 'running' && job.state !== 'queued') return null
  return <ExportProgress key={attempt} job={job} onClose={() => setDismissed(attempt)} />
}

function ExportProgress({ job, onClose }: { job: ReturnType<typeof videoEditExportQueue.list>[number]; onClose: () => void }): React.ReactElement {
  const [now, setNow] = useState(Date.now)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const active = job.state === 'running' || job.state === 'queued'
  const cancelling = active && job.controller.signal.aborted
  const progress = Math.max(0, Math.min(1, videoEditExportJobProgress(job)))
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  const elapsed = job.startedAt === undefined ? 0 : Math.max(0, (job.finishedAt ?? now) - job.startedAt)
  const remaining = progress >= .01 && elapsed >= 5000 ? elapsed * (1 - progress) / progress : undefined
  const title = cancelling ? '正在取消导出' : job.state === 'running' ? '正在导出' : job.state === 'queued' ? '准备导出' : job.state === 'completed' ? '导出完成' : job.state === 'cancelled' ? '导出已取消' : job.state === 'interrupted' ? '导出已中断' : '导出失败'
  return <UiModal isOpen title={title} dismissible={!active} onClose={onClose} footer={active
    ? confirmCancel
      ? <><UiButton variant="secondary" disabled={cancelling} onClick={() => setConfirmCancel(false)}>继续导出</UiButton><UiButton variant="dangerSolid" loading={cancelling} disabled={cancelling} onClick={() => videoEditExportQueue.cancel(job.id)}>确认取消导出</UiButton></>
      : <UiButton variant="secondary" onClick={() => setConfirmCancel(true)}>取消导出</UiButton>
    : <UiButton variant="primary" onClick={onClose}>完成</UiButton>}>
    <div className="flex flex-col gap-4">
      <p className="break-words text-13 text-text1">{job.name}</p>
      <div role="progressbar" aria-label="导出进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <ProgressBar progress={job.state === 'completed' ? 100 : progress * 100} duration={0} />
      </div>
      <p role="status" className="text-13 tabular-nums text-text2">已用 {duration(elapsed)}{active ? remaining === undefined ? ' · 正在估算剩余时间' : ` · 预计剩余 ${duration(remaining)}` : ''}</p>
      {active && progress === 1 && !cancelling && <p className="text-13 text-text2">画面处理完成，正在保存成片…</p>}
      <p className="break-all text-xs text-text2">保存位置：{job.path || '正在准备输出文件'}</p>
      {active && <p className="text-xs text-text2">{confirmCancel ? '确认取消？未完成的文件不会作为成片保存。' : '导出期间请保持软件开启。完成或取消后可继续编辑。'}</p>}
      {job.error && <UiError align="start" message={job.error} />}
    </div>
  </UiModal>
}
