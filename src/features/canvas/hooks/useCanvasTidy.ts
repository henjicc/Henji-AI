import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasNode } from '../domain/canvasNodes'
import { canvasTidyGeometryKey, type CanvasTidyMode } from '../application/canvasTidyLayout'
import { applyCanvasTidyDraft, createCanvasTidyDraft, type CanvasTidyDraft } from '../application/canvasTidyService'
import { reportCanvasOperationFailure } from '../application/canvasOperationFeedback'

export function useCanvasTidy(projectId: string | null, nodes: CanvasNode[], rendered: CanvasNode[]) {
  const [draft, setDraft] = useState<CanvasTidyDraft | null>(null)
  const [mode, setMode] = useState<CanvasTidyMode>('align')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const geometry = useMemo(() => draft ? canvasTidyGeometryKey(nodes) : '', [nodes, draft])
  const valid = draft?.projectId === projectId && draft.baseline === geometry ? draft : null
  const cancel = useCallback(() => { generation.current++; setDraft(null); setBusy(false) }, [])
  useEffect(() => cancel, [cancel, projectId])
  const start = useCallback(async (pin: string | null = null) => {
    if (!projectId) return
    const request = ++generation.current
    setBusy(true)
    try {
      const next = await createCanvasTidyDraft(projectId, nodes, nodes.filter(n => n.selected).map(n => n.id), pin)
      if (request === generation.current) setDraft(next)
    } catch (error) { if (request === generation.current) reportCanvasOperationFailure(error) }
    finally { if (request === generation.current) setBusy(false) }
  }, [nodes, projectId])
  const candidate = valid?.candidates.find(c => c.mode === mode)
  const previewNodes = useMemo(() => {
    if (!candidate || candidate.unavailable) return rendered
    const placements = new Map(candidate.placements.map(p => [p.nodeId, p.position]))
    return rendered.map(node => placements.has(node.id) ? { ...node, position: placements.get(node.id)!, draggable: false } : node)
  }, [candidate, rendered])
  const apply = async (): Promise<void> => {
    if (!valid || !candidate || busy) return
    setBusy(true)
    try { await applyCanvasTidyDraft(valid, candidate); cancel() }
    catch (error) { cancel(); reportCanvasOperationFailure(error) }
  }
  return { draft: valid, mode, setMode, busy, start, cancel, apply, previewNodes, candidate }
}
