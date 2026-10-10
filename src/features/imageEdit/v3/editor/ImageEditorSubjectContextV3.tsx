import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ImageEditSubjectRegionV3 } from '@/core/imageEdit/v3/subjectSelection'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { discardImageEditSubjectCandidatesV3, selectImageEditRegionV3, type ImageEditSubjectCandidateV3 } from '../application/imageEditSubjectSelectionServiceV3'
import { useImageEditorSessionStoreV3 } from '../store'
import type { ImageEditorV3Controller } from './types'

interface SubjectView {
  busy: boolean
  error: string | null
  candidates: ImageEditSubjectCandidateV3[]
  run(region: ImageEditSubjectRegionV3, candidateId?: string): Promise<void>
  cancel(): void
}
const SubjectContext = createContext<SubjectView | null>(null)
// eslint-disable-next-line react-refresh/only-export-components -- 工作面 context 与订阅钩子同源。
export function useImageEditorSubjectV3(): SubjectView | null { return useContext(SubjectContext) }
export function ImageEditorSubjectProviderV3({ bus, controller, children }: { bus: ImageEditCommandBusV3; controller: ImageEditorV3Controller; children: ReactNode }): JSX.Element {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [candidates, setCandidates] = useState<ImageEditSubjectCandidateV3[]>([])
  const abort = useRef<AbortController | null>(null), mounted = useRef(true)
  const session = useImageEditorSessionStoreV3(state => state.sessions[controller.sessionId])
  const selectedKey = session?.selectedLayerIds.join(':') ?? ''
  useEffect(() => { mounted.current = true; setBusy(false); setCandidates([]); setError(null); return () => { mounted.current = false; abort.current?.abort(); abort.current = null } }, [bus])
  useEffect(() => { abort.current?.abort(); discardImageEditSubjectCandidatesV3(bus); setCandidates([]); setError(null) }, [bus, selectedKey, session?.activeTool])
  useEffect(() => bus.subscribe(() => { setCandidates([]) }), [bus])
  async function run(region: ImageEditSubjectRegionV3, candidateId?: string): Promise<void> {
    if (abort.current) return
    const ids = useImageEditorSessionStoreV3.getState().sessions[controller.sessionId]?.selectedLayerIds ?? []
    if (ids.length !== 1) { setError('请选择一个像素图层'); return }
    const task = new AbortController(); abort.current = task; setBusy(true); setError(null); setCandidates([])
    try {
      const result = await selectImageEditRegionV3(bus, ids[0], { region, candidateId, combine: useImageEditorSessionStoreV3.getState().sessions[controller.sessionId]?.toolSettings.selectionCombineMode ?? 'replace', signal: task.signal })
      if (mounted.current && !task.signal.aborted) setCandidates(result.candidates)
    } catch (cause) { if (mounted.current && !task.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (abort.current === task) { abort.current = null; if (mounted.current) setBusy(false) } }
  }
  function cancel(): void { abort.current?.abort(); discardImageEditSubjectCandidatesV3(bus); setCandidates([]) }
  return <SubjectContext.Provider value={{ busy, error, candidates, run, cancel }}>{children}</SubjectContext.Provider>
}
