import { useEffect, useRef, useState } from 'react'
import { UiButton, UiError, UiFormRow, UiInput, UiModal, UiTextArea } from '@/components/ui'
import { createVideoEditCodeItems } from '../application/videoEditCodeService'

const starter = `export default {
  apiVersion: 1, name: "透明图形", kind: "generator", mode: "static",
  width: 1920, height: 1080, durationSeconds: 3, seed: 42,
  parameters: {
    ink: { type: "color", title: "图形颜色", default: [0.2, 0.6, 1, 0.8] }
  },
  render(ctx) {
    return [rect({ x: 160, y: 160, width: 800, height: 480,
      fill: ctx.params.ink, radius: 32 })];
  }
}`

/** Authoring entry for a new project item. The domain service validates and
 * trial-renders the candidate before it can alter the project. */
export function VideoEditCodeCreateDialog({ projectId, binId, onClose, onCreated }: { projectId: string; binId?: string; onClose: () => void; onCreated: (itemIds: string[]) => void }): React.ReactElement {
  const [source, setSource] = useState(starter)
  const [name, setName] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(new Error('代码素材创建已取消。')) } }, [])
  const close = (): void => { controller.current?.abort(new Error('代码素材创建已取消。')); onClose() }
  const create = async (): Promise<void> => {
    if (busy.current) return
    busy.current = true; setChecking(true); setError('')
    const pending = new AbortController(); controller.current = pending
    try {
      const ids = await createVideoEditCodeItems(projectId, [{ source, ...(name.trim() ? { name: name.trim() } : {}), ...(binId ? { binId } : {}) }], pending.signal)
      if (mounted.current) { onCreated(ids); onClose() }
    } catch (reason) { if (mounted.current && !pending.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { busy.current = false; if (controller.current === pending) controller.current = null; if (mounted.current) setChecking(false) }
  }
  return <UiModal isOpen size="editor" title="新建代码素材" onClose={close} footer={<><UiButton variant="plain" onClick={close}>取消</UiButton><UiButton variant="primary" disabled={checking || !source.trim()} onClick={() => { void create() }}>{checking ? '正在检查画面…' : '检查并创建'}</UiButton></>}>
    <div className="space-y-3">
      <p className="text-xs text-text-muted">编写图形或动态标题的源码。检查通过后成为工程素材，可拖入时间线与视频混合剪辑。</p>
      <UiFormRow label="素材名称"><UiInput aria-label="代码素材名称" placeholder="使用源码中的名称" maxLength={200} value={name} disabled={checking} onChange={event => setName(event.target.value)} /></UiFormRow>
      <UiFormRow label="作者源码"><UiTextArea aria-label="作者源码" className="h-80 font-mono text-xs" spellCheck={false} value={source} maxLength={65536} disabled={checking} onChange={event => setSource(event.target.value)} /></UiFormRow>
      {error && <UiError size="xs" message={error} />}
    </div>
  </UiModal>
}
