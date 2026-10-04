import { useEffect, useRef, useState } from 'react'
import { UiButton, UiError, UiFormRow, UiInput, UiModal, UiTextArea } from '@/components/ui'
import { createVideoEditCodeItems, createVideoEditFilterMaterials } from '../application/videoEditCodeService'

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

const filterStarter = `export default {
  apiVersion: 1, name: "颜色滤镜", kind: "filter", mode: "static",
  width: 1920, height: 1080, durationSeconds: 1800, seed: 42,
  parameters: {
    gain: { type: "number", title: "色彩强度", default: 0.8,
      min: 0, max: 1, step: 0.01, animatable: true }
  },
  render(ctx) {
    const color = sample(ctx.u, ctx.v);
    return rgba(color.r * ctx.params.gain, color.g * ctx.params.gain,
      color.b * ctx.params.gain, color.a);
  }
}`

/** Authoring entry for a new project item. The domain service validates and
 * trial-renders the candidate before it can alter the project. */
export function VideoEditCodeCreateDialog({ projectId, binId, mode = 'generator', onClose, onCreated }: { projectId: string; binId?: string; mode?: 'generator' | 'filter'; onClose: () => void; onCreated: (ids: string[]) => void }): React.ReactElement {
  const [source, setSource] = useState(mode === 'filter' ? filterStarter : starter)
  const [name, setName] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const identity = JSON.stringify([projectId, mode])
  const currentIdentity = useRef(identity); currentIdentity.current = identity
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(new Error('源码创建已取消。')) } }, [identity])
  const close = (): void => { controller.current?.abort(new Error('代码素材创建已取消。')); onClose() }
  const create = async (): Promise<void> => {
    if (busy.current) return
    busy.current = true; setChecking(true); setError('')
    const pending = new AbortController(); controller.current = pending
    try {
      const input = { source, ...(name.trim() ? { name: name.trim() } : {}) }
      const ids = mode === 'filter' ? await createVideoEditFilterMaterials(projectId, [input], pending.signal) : await createVideoEditCodeItems(projectId, [{ ...input, ...(binId ? { binId } : {}) }], pending.signal)
      if (mounted.current && currentIdentity.current === identity && controller.current === pending && !pending.signal.aborted) { onCreated(ids); onClose() }
    } catch (reason) { if (mounted.current && !pending.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { busy.current = false; if (controller.current === pending) controller.current = null; if (mounted.current) setChecking(false) }
  }
  return <UiModal isOpen size="editor" title={mode === 'filter' ? '编写新滤镜源码' : '新建代码素材'} onClose={close} footer={<><UiButton onClick={close}>取消</UiButton><UiButton variant="primary" disabled={checking || !source.trim()} onClick={() => { void create() }}>{checking ? mode === 'filter' ? '正在检查源码…' : '正在检查画面…' : mode === 'filter' ? '检查并创建滤镜源码' : '检查并创建'}</UiButton></>}>
    <div className="space-y-3">
      <p className="text-xs text-text3">{mode === 'filter' ? '编写处理输入画面的滤镜源码。检查通过后保存在工程中，再选择“添加到片段”试渲染并应用；添加失败仍可复用这份源码。' : '编写图形或动态标题的源码。检查通过后成为工程素材，可拖入时间线与视频混合剪辑。'}</p>
      <UiFormRow label={mode === 'filter' ? '滤镜名称' : '素材名称'}><UiInput aria-label={mode === 'filter' ? '滤镜源码名称' : '代码素材名称'} placeholder="使用源码中的名称" maxLength={200} value={name} disabled={checking} onChange={event => setName(event.target.value)} /></UiFormRow>
      <UiFormRow label="作者源码"><UiTextArea aria-label="作者源码" className="h-80 font-mono" spellCheck={false} value={source} maxLength={65536} disabled={checking} onChange={event => setSource(event.target.value)} /></UiFormRow>
      {error && <UiError size="xs" align="start" title={error} message="" />}
    </div>
  </UiModal>
}
