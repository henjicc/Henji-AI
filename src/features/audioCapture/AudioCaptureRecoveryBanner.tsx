import { useStore } from 'zustand'
import { useEffect, useState } from 'react'
import { UiButton, UiError, UiGroup } from '@/components/ui'
import type { AudioCaptureFile } from '@/core/audioCapture/contracts'
import { getPlatform } from '@/platform/runtime'
import { getAudioCaptureSession } from './captureApplicationService'
import { loadAudioEditProject, openAudioEditDocument } from '@/features/audioEdit'

export function AudioCaptureRecoveryBanner({ projectId }: { projectId?: string }): JSX.Element | null {
  const capture = getAudioCaptureSession()
  const phase = useStore(capture.store, state => state.phase)
  const captureBusy = useStore(capture.store, state => state.busy)
  const [files, setFiles] = useState<AudioCaptureFile[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (phase === 'recording' || captureBusy) return
    let disposed = false
    void getPlatform().audioCapture.pendingFiles().then(result => { if (!disposed) setFiles(result.filter(file => !projectId || file.placement?.projectId === projectId)) }).catch((raw: unknown) => { if (!disposed) setError(raw instanceof Error ? raw.message : '读取未完成录音失败') })
    return () => { disposed = true }
  }, [projectId, phase, captureBusy])
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError('')
    try { await operation(); setFiles((await getPlatform().audioCapture.pendingFiles()).filter(file => !projectId || file.placement?.projectId === projectId)) }
    catch (raw) { setError(raw instanceof Error ? raw.message : '恢复录音失败') }
    finally { setBusy(false) }
  }
  if (phase === 'recording' || captureBusy) return null
  if (!files.length && !error) return null
  return <UiGroup title="发现上次未完成的录音">
    {files.map(file => <div key={file.outputPath} className="flex items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-text2">{file.name}（{(file.durationSeconds ?? 0).toFixed(1)} 秒）</span>
      {file.placement && <UiButton variant="secondary" disabled={busy} disabledReason="正在处理录音" onClick={() => void run(async () => {
        await loadAudioEditProject(file.placement!.projectId)
        await capture.restore(file)
        await openAudioEditDocument({ id: file.placement!.projectId })
      })}>拼回原位置</UiButton>}
      <UiButton variant="secondary" disabled={busy} disabledReason="正在处理录音" onClick={() => void run(() => getAudioCaptureSession().recover(file.outputPath))}>另存为新草稿</UiButton>
      <UiButton variant="danger" disabled={busy} disabledReason="正在处理录音" onClick={() => void run(() => getAudioCaptureSession().discard(file.outputPath))}>移到回收站</UiButton>
    </div>)}
    {error && <UiError message={error} />}
  </UiGroup>
}
