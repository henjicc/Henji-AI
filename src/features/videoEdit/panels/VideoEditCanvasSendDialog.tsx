import { useEffect, useRef, useState } from 'react'
import { Dropdown, UiButton, UiError, UiModal } from '@/components/ui'
import { useNotification } from '@/contexts/NotificationContext'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import { useProjectStore } from '@/stores/projectStore'
import { sendVideoEditToCanvas, type VideoEditCanvasTransfer } from '@/services/workspaceTransfer'
import { requireVideoEditInstance } from '../application/videoEditService'
import { CanvasPersistenceError, confirmCanvasPersistence } from '@/features/canvas/application/canvasPersistenceService'

export type VideoEditCanvasSendRequest = Pick<VideoEditCanvasTransfer, 'projectId' | 'sequenceId' | 'source'>

export function VideoEditCanvasSendDialog({ request, onClose }: { request: VideoEditCanvasSendRequest; onClose: () => void }): React.ReactElement {
  const [baseline] = useState(() => requireVideoEditInstance(request.projectId).document)
  const [documents, setDocuments] = useState<Array<{ id: string; name: string }>>([])
  const [canvasId, setCanvasId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savePending, setSavePending] = useState<string | null>(null)
  const operation = useRef<AbortController | null>(null)
  const { showNotification } = useNotification()
  useEffect(() => {
    let live = true
    void getDocumentOperations().listDocuments({ kind: 'canvas', includeDrafts: true, includeMissing: false }).then(values => {
      if (!live) return
      setDocuments(values)
      const current = useProjectStore.getState().currentProjectId
      setCanvasId(values.find(value => value.id === current)?.id ?? values[0]?.id ?? '')
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false; operation.current?.abort() }
  }, [])
  const submit = async (): Promise<void> => {
    if (operation.current) return
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError('')
    try {
      if (savePending) {
        await confirmCanvasPersistence(savePending)
        showNotification('画布已保存，请检查已有节点；可在画布中撤销。', 'success'); onClose(); return
      }
      if (requireVideoEditInstance(request.projectId).document !== baseline) throw new Error('原剪辑已修改，请重新选择要发送的内容。')
      const result = await sendVideoEditToCanvas({ ...request, canvasId, placement: { mode: 'viewport_center' } }, controller.signal)
      if (!result.verification.verified) throw new Error('画布已有新增节点，但保存回读尚未核实，请在画布检查并保存。')
      showNotification('已发送到画布，可在画布中撤销。', 'success'); onClose()
    } catch (cause) {
      if (cause instanceof CanvasPersistenceError) setSavePending(cause.projectId)
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    }
    finally { operation.current = null; setBusy(false) }
  }
  return <UiModal isOpen title={request.source.kind === 'frame' ? '发送当前帧到画布' : '发送片段到画布'} onClose={() => { if (!busy) onClose() }}
    footer={<><UiButton onClick={() => { operation.current?.abort(); if (!busy) onClose() }}>{busy ? '取消发送' : '取消'}</UiButton><UiButton variant="primary" disabled={busy || !canvasId} onClick={() => void submit()}>{busy ? '正在处理…' : savePending ? '重试保存画布' : '发送'}</UiButton></>}>
    <Dropdown label="目标画布" disabled={busy || Boolean(savePending)} value={canvasId} options={documents.map(value => ({ value: value.id, label: value.name }))} onSelect={setCanvasId} />
    {!loading && !canvasId && !error && <UiError title="请先创建或打开一份画布。" message="" />}
    {error && <UiError title={error} message="" />}
  </UiModal>
}
