import { useState, useSyncExternalStore } from 'react'
import { UiButton, UiError, UiGroup, UiLoading } from '@/components/ui'
import { retryVideoEditExportJob, videoEditExportQueue } from '../application/videoEditExportQueue'
import { collectVideoEditOutput } from '../application/videoEditOutputs'
import { subscribeVideoEdit, videoEditRevision } from '../application/videoEditService'
import { videoEditUserErrorMessage } from '../application/videoEditUserError'

const labels = { queued: '等待导出', running: '正在导出', completed: '已完成', cancelled: '已取消', failed: '导出失败' } as const
export function VideoEditExportQueueList(): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const jobs = videoEditExportQueue.list()
  const [error, setError] = useState('')
  const [collecting, setCollecting] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  if (!jobs.length) return null
  return <UiGroup title="导出队列" divided>
    <div className="max-h-64 overflow-y-auto space-y-3">
      {jobs.map(job => <div key={job.id} className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1"><p className="break-words text-sm text-text1">{job.name} · {job.presetName}</p>{job.state === 'running' ? <UiLoading size="xs" message={`正在导出 ${Math.round((job.task?.progress ?? 0) * 100)}%`} /> : <p role="status" className="text-xs text-text2">{labels[job.state]}</p>}{job.error && <UiError size="xs" align="start" message={job.error} />}</div>
        {['queued', 'running'].includes(job.state) && <UiButton size="sm" onClick={() => videoEditExportQueue.cancel(job.id)}>取消</UiButton>}
        {job.state === 'failed' && job.task?.state !== 'completed' && <UiButton size="sm" onClick={() => { try { retryVideoEditExportJob(job.id); setError('') } catch (reason) { setError(videoEditUserErrorMessage(reason)) } }}>重试</UiButton>}
        {job.task?.output && <UiButton size="sm" disabled={collecting !== null} onClick={() => {
          setCollecting(job.id); setError(''); setNotice('')
          void collectVideoEditOutput(job.task!.output!).then(() => setNotice('已加入资产库。')).catch(reason => setError(videoEditUserErrorMessage(reason))).finally(() => setCollecting(null))
        }}>{collecting === job.id ? '正在收录…' : '加入资产库'}</UiButton>}
      </div>)}
    </div>
    <UiButton variant="danger" size="sm" onClick={() => videoEditExportQueue.clearFinished()}>清除已结束项</UiButton>
    {notice && <p role="status" className="text-xs text-text2">{notice}</p>}
    {error && <UiError message={error} />}
  </UiGroup>
}
