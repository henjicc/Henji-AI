import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { repairImageEditRegionV3, type ImageEditRepairOptionsV3 } from '../application/imageEditRepairServiceV3'
import { useImageEditorSessionStoreV3 } from '../store'
import type { ImageEditorV3Controller } from './types'

interface RepairView {
  busy: boolean
  error: string | null
  progress: { stage: string; percent: number } | null
  quality: 'auto' | 'fast' | 'fine'
  previewReady: boolean
  apply(): void
  setQuality(value: 'auto' | 'fast' | 'fine'): void
  run(options: Omit<ImageEditRepairOptionsV3, 'quality' | 'signal' | 'progress'>): Promise<void>
  cancel(): void
}
const RepairContext = createContext<RepairView | null>(null)
// eslint-disable-next-line react-refresh/only-export-components -- 工作区限定的 context 与 provider 同源，非组件导出仅为订阅钩子。
export function useImageEditorRepairV3(): RepairView | null { return useContext(RepairContext) }

export function ImageEditorRepairProviderV3({ bus, controller, children }: { bus: ImageEditCommandBusV3; controller: ImageEditorV3Controller; children: ReactNode }): JSX.Element {
  const [quality, setQuality] = useState<'auto' | 'fast' | 'fine'>('auto')
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<RepairView['progress']>(null)
  const abort = useRef<AbortController | null>(null)
  const confirmation = useRef<(() => void) | null>(null)
  const [previewReady, setPreviewReady] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; setBusy(false); setProgress(null); return () => { mounted.current = false; abort.current?.abort(); abort.current = null } }, [bus])
  async function run(options: Omit<ImageEditRepairOptionsV3, 'quality' | 'signal' | 'progress'>): Promise<void> {
    if (abort.current) return
    const layerIds = useImageEditorSessionStoreV3.getState().sessions[controller.sessionId]?.selectedLayerIds ?? []
    if (layerIds.length !== 1) { setError('请选择一个像素图层'); return }
    const task = new AbortController(); abort.current = task; setBusy(true); setError(null); setProgress({ stage: 'selecting', percent: 0 })
    const startSession = useImageEditorSessionStoreV3.getState().sessions[controller.sessionId]
    const unsubscribe = useImageEditorSessionStoreV3.subscribe(state => {
      const now = state.sessions[controller.sessionId]
      if (!now || now.activeTool !== startSession.activeTool || now.selectedLayerIds.join('/') !== startSession.selectedLayerIds.join('/')) task.abort()
    })
    const confirm = options.method === 'texture' ? (signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
      signal.throwIfAborted()
      const cancelWait = (): void => { confirmation.current = null; reject(new Error('填充预览已取消')) }
      signal.addEventListener('abort', cancelWait, { once: true })
      confirmation.current = () => { signal.removeEventListener('abort', cancelWait); confirmation.current = null; setPreviewReady(false); resolve() }
      setPreviewReady(true); setProgress(null)
    }) : undefined
    try {
      await repairImageEditRegionV3(bus, layerIds[0], { ...options, confirm, quality, signal: task.signal, progress: value => { if (mounted.current && !task.signal.aborted) setProgress({ stage: value.stage, percent: Math.floor(value.done / Math.max(1, value.total) * 100) }) } })
    } catch (cause) { if (mounted.current && !task.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { unsubscribe(); confirmation.current = null; if (abort.current === task) { abort.current = null; if (mounted.current) { setBusy(false); setProgress(null); setPreviewReady(false) } } }
  }
  function cancel(): void { abort.current?.abort(); setBusy(false); setProgress(null) }
  return <RepairContext.Provider value={{ busy, error, progress, quality, setQuality, previewReady, apply: () => confirmation.current?.(), run, cancel }}>{children}</RepairContext.Provider>
}
