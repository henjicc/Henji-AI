import { useEffect, useState } from 'react'
import { UiButton, UiError, UiGroup } from '@/components/ui'
import type { AudioCaptureFile } from '@/core/audioCapture/contracts'
import { getPlatform } from '@/platform/runtime'
import { getAudioCaptureSession } from './captureApplicationService'

export function AudioCaptureRecoveryBanner(): JSX.Element | null {
  const [files, setFiles] = useState<AudioCaptureFile[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let disposed = false
    void getPlatform().audioCapture.pendingFiles().then(result => { if (!disposed) setFiles(result) }).catch((raw: unknown) => { if (!disposed) setError(raw instanceof Error ? raw.message : '读取未完成录音失败') })
    return () => { disposed = true }
  }, [])
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError('')
    try { await operation(); setFiles(await getPlatform().audioCapture.pendingFiles()) }
    catch (raw) { setError(raw instanceof Error ? raw.message : '恢复录音失败') }
    finally { setBusy(false) }
  }
  if (!files.length && !error) return null
  return <UiGroup title="发现未完成的录音">
    {files.map(file => <div key={file.outputPath} className="flex items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-text2">{file.name}</span>
      <UiButton variant="secondary" disabled={busy} disabledReason="正在处理录音" onClick={() => void run(() => getAudioCaptureSession().recover(file.outputPath))}>恢复并打开</UiButton>
      <UiButton variant="danger" disabled={busy} disabledReason="正在处理录音" onClick={() => void run(() => getAudioCaptureSession().discard(file.outputPath))}>删除</UiButton>
    </div>)}
    {error && <UiError message={error} />}
  </UiGroup>
}
