import { useState, useSyncExternalStore } from 'react'
import { UiButton, UiError, UiGroup, UiLoading, UiTooltipText } from '@/components/ui'
import { cancelWaitingVideoEditExport, listWaitingVideoEditExports, retryableVideoEditExportJob, retryVideoEditExportJob, videoEditExportJobProgress, videoEditExportQueue } from '../application/videoEditExportQueue'
import { VIDEO_EDIT_EXPORT_NOT_RETAINED_REASONS } from '../application/videoEditExportRegistry'
import { collectVideoEditOutput } from '../application/videoEditOutputs'
import { subscribeVideoEdit, videoEditRevision } from '../application/videoEditService'
import { videoEditUserErrorMessage } from '../application/videoEditUserError'

const labels = { queued: '等待导出', running: '正在导出', completed: '已完成', cancelled: '已取消', failed: '导出失败', interrupted: '已中断' } as const
/** 中断项写明停在哪：用户据此决定重试还是放弃。 */
const stateLabel = (state: keyof typeof labels, progress: number): string => state === 'interrupted' && progress > 0 ? `已中断（导出到 ${Math.round(progress * 100)}%）` : labels[state]
const ROW_CLASS = 'flex flex-wrap items-center gap-2 border-b border-line/60 py-3 first:pt-0 last:border-b-0 last:pb-0'
export function VideoEditExportQueueList(): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const jobs = videoEditExportQueue.list()
  const waiting = listWaitingVideoEditExports()
  const [error, setError] = useState('')
  const [collecting, setCollecting] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  if (!jobs.length && !waiting.length) return null
  return <UiGroup title="导出队列" divided>
    <div className="max-h-64 overflow-y-auto">
      {jobs.map(job => <div key={job.id} className={ROW_CLASS}>
        <div className="min-w-0 flex-1"><p className="break-words text-sm text-text1">{job.name} · {job.presetName}</p>{job.state === 'running' ? <UiLoading size="xs" message={`正在导出 ${Math.round(videoEditExportJobProgress(job) * 100)}%`} /> : <p role="status" className="text-xs text-text2">{stateLabel(job.state, videoEditExportJobProgress(job))}</p>}
          {(job.restored || job.notRetained) && <p className="flex gap-3 text-xs text-text2">
            {job.restored && <UiTooltipText tooltip="按界面重新加载前提交时的内容导出">已恢复</UiTooltipText>}
            {job.notRetained && <UiTooltipText tooltip={VIDEO_EDIT_EXPORT_NOT_RETAINED_REASONS[job.notRetained]}>重载后不会保留</UiTooltipText>}
          </p>}
          {job.error && <UiError size="xs" align="start" message={job.error} />}</div>
        {['queued', 'running'].includes(job.state) && <UiButton size="sm" onClick={() => videoEditExportQueue.cancel(job.id)}>取消</UiButton>}
        {retryableVideoEditExportJob(job) && <UiButton size="sm" onClick={() => { try { void retryVideoEditExportJob(job.id).then(() => setError('')).catch(reason => setError(videoEditUserErrorMessage(reason))) } catch (reason) { setError(videoEditUserErrorMessage(reason)) } }}>重试</UiButton>}
        {job.task?.assetRef && <p className="text-xs text-text2">已加入资产库</p>}
        {job.task?.output && !job.task.assetRef && <UiButton loading={collecting === job.id} size="sm" disabled={collecting !== null} onClick={() => {
          setCollecting(job.id); setError(''); setNotice('')
          void collectVideoEditOutput(job.task!.output!).then(asset => { job.task!.assetRef = { kind: 'asset', id: asset.id }; setNotice('已加入资产库。') }).catch(reason => setError(videoEditUserErrorMessage(reason))).finally(() => setCollecting(null))
        }}>{'加入资产库'}</UiButton>}
      </div>)}
      {waiting.map(record => <div key={record.id} className={ROW_CLASS}>
        <div className="min-w-0 flex-1"><p className="break-words text-sm text-text1">{record.name} · {record.presetName}</p>
          <p role="status" className="text-xs text-text2"><UiTooltipText tooltip="打开原剪辑后按界面重新加载前提交时的内容继续">{record.state === 'queued' ? '等待原剪辑打开' : stateLabel(record.state, record.progress)}</UiTooltipText></p></div>
        <UiButton size="sm" onClick={() => cancelWaitingVideoEditExport(record.id)}>取消</UiButton>
      </div>)}
    </div>
    <UiButton variant="danger" size="sm" onClick={() => videoEditExportQueue.clearFinished()}>清除已结束项</UiButton>
    {notice && <p role="status" className="text-xs text-text2">{notice}</p>}
    {error && <UiError message={error} />}
  </UiGroup>
}
