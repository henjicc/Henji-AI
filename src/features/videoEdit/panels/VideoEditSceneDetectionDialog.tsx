import { useEffect, useRef, useState } from 'react'
import { UiButton, UiCheckbox, UiError, UiFormRow, UiGroup, UiLoading, UiModal, UiRangeInput } from '@/components/ui'
import { detectVideoEditScenes, applyVideoEditScenes, type VideoEditSceneAnalysis, type VideoEditSceneTarget } from '../application/videoEditSceneDetection'
import type { SceneApplyOptions } from '@/core/videoEdit/sceneDetection'

export function VideoEditSceneDetectionDialog({ target, onClose }: { target: VideoEditSceneTarget; onClose: () => void }): React.ReactElement {
  const [sensitivity, setSensitivity] = useState(50)
  const [options, setOptions] = useState<SceneApplyOptions>({ split: true, markers: false, subclips: false })
  const [analysis, setAnalysis] = useState<VideoEditSceneAnalysis | null>(null)
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0); const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => { controller.current?.abort() }, [])
  const run = async (apply: boolean, force = false): Promise<void> => {
    const current = new AbortController(); controller.current = current; setBusy(true); setApplying(false); setError(''); setProgress(0)
    try {
      const result = (!force && analysis) || await detectVideoEditScenes(target, sensitivity, current.signal, value => { if (!current.signal.aborted) setProgress(value) })
      if (!current.signal.aborted) setAnalysis(result)
      if (apply) { setApplying(true); await applyVideoEditScenes(target, result.analysisId, options, current.signal); onClose() }
    } catch (reason) { if (!current.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (controller.current === current && !current.signal.aborted) { controller.current = null; setBusy(false) } }
  }
  const close = (): void => { controller.current?.abort(); onClose() }
  return <UiModal isOpen title="场景编辑检测" onClose={close} footer={<>
    <UiButton onClick={close}>{busy ? '取消操作' : '取消'}</UiButton>
    <UiButton variant="secondary" disabled={busy} onClick={() => { setAnalysis(null); void run(false, true) }}>检测切点</UiButton>
    <UiButton variant="primary" disabled={busy || !Object.values(options).some(Boolean)} onClick={() => { void run(true) }}>检测并应用</UiButton>
  </>}>
    <div className="space-y-4" data-video-edit-scene-dialog>
      <UiGroup>
        <UiFormRow label="灵敏度"><div className="flex items-center gap-3"><span>少切</span><UiRangeInput aria-label="灵敏度" min={0} max={100} step={1} value={sensitivity} disabled={busy} onChange={event => { setSensitivity(Number(event.target.value)); setAnalysis(null) }} /><span>多切</span></div></UiFormRow>
        <UiFormRow label="拆分片段" inline><UiCheckbox checked={options.split} disabled={busy} onCheckedChange={split => setOptions(value => ({ ...value, split }))} /></UiFormRow>
        <UiFormRow label="添加片段标记" inline><UiCheckbox checked={options.markers} disabled={busy} onCheckedChange={markers => setOptions(value => ({ ...value, markers }))} /></UiFormRow>
        <UiFormRow label="创建子剪辑（素材面板）" inline><UiCheckbox checked={options.subclips} disabled={busy} onCheckedChange={subclips => setOptions(value => ({ ...value, subclips }))} /></UiFormRow>
      </UiGroup>
      {busy && <UiLoading message={applying ? '正在应用切点' : `正在分析镜头切换 ${Math.round(progress * 100)}%`} />}
      {analysis && !busy && <p className="text-text2">发现 {analysis.cutFrames.length} 个切点，应用后可一步撤销。</p>}
      {error && <UiError message={error} onRetry={() => { setAnalysis(null); void run(false, true) }} retryLabel="重新检测" />}
    </div>
  </UiModal>
}
