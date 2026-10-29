import { useEffect, useRef, useState } from 'react'
import { UiButton, UiError, UiFormRow, UiInput, UiModal, UiTextArea } from '@/components/ui'
import { createVideoEditCodeItems, createVideoEditFilterMaterials } from '../application/videoEditCodeService'

const starter = `export default {
  name: "透明图形", mode: "static",
  width: 1920, height: 1080, durationSeconds: 3,
  params: [{ key: "opacity", type: "number", title: "不透明度",
    default: 0.8, min: 0, max: 1, step: 0.01 }],
  draw(ctx, time, params) {
    ctx.globalAlpha = params.opacity;
    ctx.fillRect(160, 160, 800, 480);
  }
}`

const filterStarter = `export default {
  name: "直通滤镜", kind: "filter", mode: "static",
  createWebGPU(device) {
    const module = device.createShaderModule({ code: \`
      @group(0) @binding(0) var input: texture_2d<f32>;
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        let p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
        return vec4f(p[i], 0, 1);
      }
      @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
        return textureLoad(input, vec2i(p.xy), 0);
      }\` });
    const layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 2, texture: { sampleType: "unfilterable-float" } }
    ] });
    const pipelines = new Map();
    return { draw(target, t, params, w, h, assets, info, inputs) {
      let pipeline = pipelines.get(target.format);
      if (!pipeline) {
        pipeline = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
          vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format: target.format }] } });
        pipelines.set(target.format, pipeline);
      }
      const bind = device.createBindGroup({ layout, entries: [{ binding: 0, resource: inputs.current.createView() }] });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store" }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
      device.queue.submit([encoder.finish()]);
    } };
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
  return <UiModal isOpen size="editor" title={mode === 'filter' ? '编写新滤镜源码' : '新建代码素材'} onClose={close} footer={<><UiButton onClick={close}>取消</UiButton><UiButton loading={checking} variant="primary" disabled={checking || !source.trim()} onClick={() => { void create() }}>{mode === 'filter' ? '检查并创建滤镜源码' : '检查并创建'}</UiButton></>}>
    <div className="space-y-3">
      <UiFormRow label={mode === 'filter' ? '滤镜名称' : '素材名称'}><UiInput aria-label={mode === 'filter' ? '滤镜源码名称' : '代码素材名称'} placeholder="使用源码中的名称" maxLength={200} value={name} disabled={checking} onChange={event => setName(event.target.value)} /></UiFormRow>
      <UiFormRow label="作者源码"><UiTextArea aria-label="作者源码" height="tall" className="font-mono" spellCheck={false} value={source} disabled={checking} onChange={event => setSource(event.target.value)} /></UiFormRow>
      {error && <UiError size="xs" align="start" title={error} message="" />}
    </div>
  </UiModal>
}
