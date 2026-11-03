// ticket 35 归因台：在页面主线程直接驱动正式 VideoEditRenderer，逐帧统计 GPU 命令与按阶段耗时。
import { CODE_AUTHOR_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
// 只做测量，不改任何渲染行为；阶段标签按调用栈归属，异步交错处可能有少量误差。
import { VideoEditRenderer } from '@/features/videoEdit/engine/videoEditRenderer'
import { VideoEditSpatialGpu } from '@/features/videoEdit/engine/videoEditSpatialComposite'
import { VideoEditAuthorThree } from '@/features/videoEdit/engine/videoEditAuthorThree'
import { VideoEditThreeSpace } from '@/features/videoEdit/engine/videoEditThreeSpace'
import { VideoEditGpuCompositor } from '@/features/videoEdit/engine/videoEditGpuCompositor'
import { VideoEditCodeSources } from '@/features/videoEdit/engine/videoEditCodeSources'
import { parseVideoEditDocument } from '@/core/videoEdit/documentValidation'
import { videoEditComposition } from '@/core/videoEdit/document'
import { rememberTransientCodeSource } from '@/core/videoEdit/codeMaterial/sources'
import { installAuthorTrustGate } from '@/features/videoEdit/engine/videoEditAuthorTrust'

// 样片代码是本机创作，测量台直接放行信任检查。
installAuthorTrustGate(async () => {})

type Counter = Record<string, number>
interface StageStats { cpuMs: number; calls: number; gpuMs: number; renderPasses: number; computePasses: number; submits: number; draws: number; dispatches: number
  writeTexture: number; writeTextureBytes: number; copyExternal: number; copyExternalBytes: number; writeBuffer: number; writeBufferBytes: number; copyT2T: number; copyB2T: number; createTexture: number; createBindGroup: number; createBuffer: number; waits: number; waitMs: number }
const blank = (): StageStats => ({ cpuMs: 0, calls: 0, gpuMs: 0, renderPasses: 0, computePasses: 0, submits: 0, draws: 0, dispatches: 0, writeTexture: 0, writeTextureBytes: 0, copyExternal: 0, copyExternalBytes: 0, writeBuffer: 0, writeBufferBytes: 0, copyT2T: 0, copyB2T: 0, createTexture: 0, createBindGroup: 0, createBuffer: 0, waits: 0, waitMs: 0 })
let frame: Record<string, StageStats> = {}
let extra: Counter = {}
const bump = (key: keyof StageStats, value = 1): void => { const s = frame[current()] ??= blank(); (s[key] as number) += value }
const stack: Array<{ label: string; since: number }> = []
const current = (): string => stack.at(-1)?.label ?? 'other'
let lastSwitch = performance.now()
const charge = (): void => { const now = performance.now(); const s = frame[current()] ??= blank(); s.cpuMs += now - lastSwitch; lastSwitch = now }
const enter = (label: string): void => { charge(); stack.push({ label, since: performance.now() }); (frame[label] ??= blank()).calls++ }
const exit = (label: string): void => { charge(); const index = stack.map(e => e.label).lastIndexOf(label); if (index >= 0) stack.splice(index, 1) }
function wrap(proto: object, name: string, label: string | ((self: unknown, args: unknown[]) => string)): void {
  const target = proto as Record<string, (...args: unknown[]) => unknown>
  const original = target[name]
  if (typeof original !== 'function') throw Error(`缺少方法 ${name}`)
  target[name] = function (this: unknown, ...args: unknown[]) {
    const value = typeof label === 'function' ? label(this, args) : label
    enter(value)
    let result: unknown
    try { result = original.apply(this, args) } catch (error) { exit(value); throw error }
    if (result && typeof (result as Promise<unknown>).then === 'function') return (result as Promise<unknown>).finally(() => exit(value))
    exit(value); return result
  }
}

// ---- GPU 命令计数与逐 pass 时间戳 ----
const bytesPer = (format?: string): number => format?.includes('32float') ? 16 : format?.includes('16float') ? 8 : 4
let timestamps = false
interface Timing { device: GPUDevice; sets: GPUQuerySet[]; used: number; passes: string[] }
const timings = new Map<GPUDevice, Timing>()
const encoderDevice = new WeakMap<object, GPUDevice>()
const QUERIES = 4096
function slot(device: GPUDevice, label: string): GPURenderPassTimestampWrites | undefined {
  if (!timestamps || !device.features.has('timestamp-query')) return undefined
  let timing = timings.get(device)
  if (!timing) { timing = { device, sets: [], used: 0, passes: [] }; timings.set(device, timing) }
  const index = timing.used++, set = Math.floor(index * 2 / QUERIES)
  if (set >= 8) { extra.untimedPasses = (extra.untimedPasses ?? 0) + 1; return undefined }
  timing.sets[set] ??= device.createQuerySet({ type: 'timestamp', count: QUERIES })
  timing.passes[index] = label
  return { querySet: timing.sets[set], beginningOfPassWriteIndex: index * 2 % QUERIES, endOfPassWriteIndex: index * 2 % QUERIES + 1 }
}
async function collectTimestamps(): Promise<{ busy: number; span: number }> {
  let busy = 0, first = Infinity, last = -Infinity
  for (const timing of timings.values()) {
    const { device, used } = timing
    if (!used) continue
    const count = Math.min(used, 8 * QUERIES / 2)
    const sets = Math.ceil(count * 2 / QUERIES)
    const resolve = device.createBuffer({ size: sets * QUERIES * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
    const read = device.createBuffer({ size: sets * QUERIES * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
    const encoder = originals.createCommandEncoder.call(device) as GPUCommandEncoder
    for (let s = 0; s < sets; s++) {
      const n = Math.min(QUERIES, count * 2 - s * QUERIES)
      encoder.resolveQuerySet(timing.sets[s], 0, n, resolve, s * QUERIES * 8)
    }
    encoder.copyBufferToBuffer(resolve, 0, read, 0, sets * QUERIES * 8)
    originals.submit.call(device.queue, [encoder.finish()])
    await read.mapAsync(GPUMapMode.READ)
    const values = new BigUint64Array(read.getMappedRange().slice(0))
    read.unmap(); read.destroy(); resolve.destroy()
    for (let i = 0; i < count; i++) {
      const begin = values[i * 2], end = values[i * 2 + 1]
      if (!begin || !end || end < begin) continue
      const ms = Number(end - begin) / 1e6
      busy += ms; first = Math.min(first, Number(begin) / 1e6); last = Math.max(last, Number(end) / 1e6)
      ;(frame[timing.passes[i]] ??= blank()).gpuMs += ms
    }
    timing.used = 0; timing.passes = []
  }
  return { busy, span: Number.isFinite(first) ? last - first : 0 }
}
const originals = {
  createCommandEncoder: GPUDevice.prototype.createCommandEncoder,
  submit: GPUQueue.prototype.submit,
}
{
  const requestDevice = GPUAdapter.prototype.requestDevice
  GPUAdapter.prototype.requestDevice = function (descriptor?: GPUDeviceDescriptor) {
    const features = new Set([...(descriptor?.requiredFeatures ?? [])])
    if (this.features.has('timestamp-query')) features.add('timestamp-query')
    return requestDevice.call(this, { ...descriptor, requiredFeatures: [...features] })
  }
  GPUDevice.prototype.createCommandEncoder = function (descriptor?: GPUCommandEncoderDescriptor) {
    const encoder = originals.createCommandEncoder.call(this, descriptor); encoderDevice.set(encoder, this); return encoder
  }
  const beginRender = GPUCommandEncoder.prototype.beginRenderPass
  GPUCommandEncoder.prototype.beginRenderPass = function (descriptor: GPURenderPassDescriptor) {
    bump('renderPasses')
    const device = encoderDevice.get(this)
    const writes = !descriptor.timestampWrites && device ? slot(device, current()) : undefined
    return beginRender.call(this, writes ? { ...descriptor, timestampWrites: writes } : descriptor)
  }
  const beginCompute = GPUCommandEncoder.prototype.beginComputePass
  GPUCommandEncoder.prototype.beginComputePass = function (descriptor?: GPUComputePassDescriptor) {
    bump('computePasses')
    const device = encoderDevice.get(this)
    const writes = !descriptor?.timestampWrites && device ? slot(device, current()) : undefined
    return beginCompute.call(this, writes ? { ...descriptor, timestampWrites: writes } : descriptor)
  }
  const t2t = GPUCommandEncoder.prototype.copyTextureToTexture
  GPUCommandEncoder.prototype.copyTextureToTexture = function (...args: Parameters<GPUCommandEncoder['copyTextureToTexture']>) { bump('copyT2T'); return t2t.apply(this, args) }
  const b2t = GPUCommandEncoder.prototype.copyBufferToTexture
  GPUCommandEncoder.prototype.copyBufferToTexture = function (...args: Parameters<GPUCommandEncoder['copyBufferToTexture']>) { bump('copyB2T'); return b2t.apply(this, args) }
  const draw = GPURenderPassEncoder.prototype.draw
  GPURenderPassEncoder.prototype.draw = function (...args: Parameters<GPURenderPassEncoder['draw']>) { bump('draws'); return draw.apply(this, args) }
  const drawIndexed = GPURenderPassEncoder.prototype.drawIndexed
  GPURenderPassEncoder.prototype.drawIndexed = function (...args: Parameters<GPURenderPassEncoder['drawIndexed']>) { bump('draws'); return drawIndexed.apply(this, args) }
  const dispatch = GPUComputePassEncoder.prototype.dispatchWorkgroups
  GPUComputePassEncoder.prototype.dispatchWorkgroups = function (...args: Parameters<GPUComputePassEncoder['dispatchWorkgroups']>) { bump('dispatches'); return dispatch.apply(this, args) }
  // 每次等待 GPU 完成即一次 CPU↔GPU 往返；记次数与从发起到完成的时长（未必都被同步等待）。
  const done = GPUQueue.prototype.onSubmittedWorkDone
  GPUQueue.prototype.onSubmittedWorkDone = function () {
    const stage = current(), started = performance.now(); bump('waits')
    return done.call(this).then(value => { (frame[stage] ??= blank()).waitMs += performance.now() - started; return value })
  }
  GPUQueue.prototype.submit = function (buffers: Iterable<GPUCommandBuffer>) { bump('submits'); return originals.submit.call(this, buffers) }
  const writeTexture = GPUQueue.prototype.writeTexture
  GPUQueue.prototype.writeTexture = function (destination: GPUTexelCopyTextureInfo, data: GPUAllowSharedBufferSource, layout: GPUTexelCopyBufferLayout, size: GPUExtent3DStrict) {
    bump('writeTexture'); bump('writeTextureBytes', (data as ArrayBufferView).byteLength ?? 0); return writeTexture.call(this, destination, data, layout, size)
  }
  const copyExternal = GPUQueue.prototype.copyExternalImageToTexture
  GPUQueue.prototype.copyExternalImageToTexture = function (source: GPUCopyExternalImageSourceInfo, destination: GPUCopyExternalImageDestInfo, size: GPUExtent3DStrict) {
    const [w, h] = Array.isArray(size) ? size : [(size as GPUExtent3DDict).width, (size as GPUExtent3DDict).height ?? 1]
    bump('copyExternal'); bump('copyExternalBytes', w * (h ?? 1) * bytesPer(destination.texture.format)); return copyExternal.call(this, source, destination, size)
  }
  const writeBuffer = GPUQueue.prototype.writeBuffer
  GPUQueue.prototype.writeBuffer = function (buffer: GPUBuffer, offset: number, data: GPUAllowSharedBufferSource, ...rest: number[]) {
    bump('writeBuffer'); bump('writeBufferBytes', (data as ArrayBufferView).byteLength ?? 0); return (writeBuffer as (...a: unknown[]) => void).call(this, buffer, offset, data, ...rest)
  }
  for (const [name, key] of [['createTexture', 'createTexture'], ['createBindGroup', 'createBindGroup'], ['createBuffer', 'createBuffer']] as const) {
    const original = GPUDevice.prototype[name] as (...a: unknown[]) => unknown
    ;(GPUDevice.prototype as unknown as Record<string, unknown>)[name] = function (this: GPUDevice, ...args: unknown[]) { bump(key); return original.apply(this, args) }
  }
  // 二维栅格（文字等 Canvas2D 绘制）CPU 时间单独累计。
  const ctx = OffscreenCanvasRenderingContext2D.prototype as unknown as Record<string, (...a: unknown[]) => unknown>
  for (const name of ['fillText', 'strokeText', 'fill', 'stroke', 'fillRect', 'drawImage', 'putImageData']) {
    const original = ctx[name]
    ctx[name] = function (...args: unknown[]) { const started = performance.now(); try { return original.apply(this, args) } finally { extra.raster2dMs = (extra.raster2dMs ?? 0) + performance.now() - started; extra.raster2dCalls = (extra.raster2dCalls ?? 0) + 1 } }
  }
}

// ---- 阶段标签 ----
let plan: { samples: number; groups: string[]; materials: Array<{ clipId: string; kind: string; width: number; height: number; dof: boolean }> } | undefined
let spatialGpu: VideoEditSpatialGpu | undefined
wrap(VideoEditSpatialGpu.prototype, 'consume', 'mip')
wrap(VideoEditSpatialGpu.prototype, 'defocus', 'dof')
wrap(VideoEditSpatialGpu.prototype, 'encodeBuiltin', 'cardEffects')
wrap(VideoEditAuthorThree.prototype, 'render', 'three')
wrap(VideoEditThreeSpace.prototype, 'render', 'threeSpace')
wrap(VideoEditCodeSources.prototype, 'prepare', 'codePrepare')
wrap(VideoEditCodeSources.prototype, 'prepareSpatialFrame', 'scenePrepare')
wrap(VideoEditGpuCompositor.prototype, 'draw', (_self, args) => {
  if (current() !== 'other' && current() !== 'final') return current() === 'cardMaterial' ? 'cardMaterial2d' : current()
  const clips = args[1] as Array<{ kind: string }>
  return args[6] ? clips[0]?.kind === 'code' ? 'sceneToMaterial' : 'cardMaterial2d' : 'final'
})

interface Config { scale: 1 | 2; motionBlur: boolean; dof: boolean; timestamps: boolean; from: number; to: number; quality: 'interactive' | 'final'; shots?: number[]; display?: 'realtime' | 'solid' | 'wireframe' | 'render'; noWarmup?: boolean; pathTrace?: boolean; transition?: boolean | 'single'; effects?: { bloom?: number; ambientOcclusion?: number; reflections?: number }; emission?: Record<string, number>; bind?: Record<string, string>; refine?: number }
async function attribute(project: unknown, sceneSource: string, hash: string, media: Record<string, string>, config: Config) {
  const raw = structuredClone(project) as { media: Array<{ id: string; path: string }>; codeMaterials: Array<{ versions: Array<{ files: Array<{ location: string; hash: string }> }> }>; sequences: Array<{ motionBlur?: boolean; spatialCamera?: { curves?: Record<string, unknown>; defocus?: number } }> }
  const location = rememberTransientCodeSource(hash, sceneSource)
  for (const material of raw.codeMaterials) for (const version of material.versions) { for (const file of version.files) file.location = location; (version as { apiVersion: number }).apiVersion = CODE_AUTHOR_API_VERSION }
  const sequence = raw.sequences[0]
  sequence.motionBlur = config.motionBlur
  // --transition：把一张空间卡片在第 150 帧切成两段，中间 30 帧交叉溶解，右段下移一点以便看出转场。
  if (config.transition) {
    const clips = (sequence as unknown as { clips: Array<Record<string, unknown> & { id: string; start: number; duration: number; y: number }> }).clips
    const left = clips.find(clip => clip.id === 'panel-b')!, cut = 150
    const right = { ...structuredClone(left), id: 'panel-b2', start: cut, duration: left.start + left.duration - cut, y: left.y + .08 }
    // 'single'：只在右段入点淡入（单侧转场），左段提前 30 帧结束、中间留空。
    left.duration = cut - left.start - (config.transition === 'single' ? 30 : 0)
    // 关键帧时间相对片段：左段只留切点之前的，右段整体前移并只留自身范围内的。
    const retime = (curves: unknown, shift: number, duration: number): unknown => curves && typeof curves === 'object' ? Object.fromEntries(Object.entries(curves as Record<string, unknown>).map(([key, points]) =>
      [key, Array.isArray(points) ? points.map(point => ({ ...point, time: point.time - shift })).filter(point => point.time >= 0 && point.time <= duration) : points])) : curves
    left.curves = retime(left.curves, 0, left.duration)
    right.curves = retime(right.curves, cut - left.start, right.duration)
    clips.push(right)
    ;(sequence as { transitions?: unknown[] }).transitions = [config.transition === 'single'
      ? { id: 'tx', kind: 'cross_dissolve', rightClipId: 'panel-b2', durationFrames: 30 }
      : { id: 'tx', kind: 'cross_dissolve', leftClipId: 'panel-b', rightClipId: 'panel-b2', durationFrames: 30 }]
  }
  // --bind：给世界场景片段的图片参数绑定时间线片段（参数=片段 ID）。
  for (const [key, clipId] of Object.entries(config.bind ?? {})) { const scene = (sequence as unknown as { clips: Array<{ kind: string; code?: { parameters: Record<string, unknown> } }> }).clips.find(item => item.kind === 'code' && item.code); if (scene?.code) scene.code.parameters[key] = { kind: 'clip', clipId } }
  // --emission：给指定片段设发光强度（片段 ID=强度）。
  for (const [clipId, value] of Object.entries(config.emission ?? {})) { const clip = (sequence as unknown as { clips: Array<{ id: string; spaceEmission?: number }> }).clips.find(item => item.id === clipId); if (clip) clip.spaceEmission = value }
  if (config.pathTrace || config.effects) (sequence as { spaceRender?: unknown }).spaceRender = { ...(config.pathTrace ? { finalRenderer: 'pathTrace' } : {}), ...config.effects }
  if (!config.dof && sequence.spatialCamera) { delete sequence.spatialCamera.curves?.defocus; sequence.spatialCamera.defocus = 0 }
  const parsed = parseVideoEditDocument(raw)
  // 页面内用 data URL 读取图片；格式校验要求绝对路径，校验后再替换（解析结果已冻结，复制出新对象）。
  const document = { ...parsed, media: parsed.media.map(item => ({ ...item, path: media[item.id] })) }
  const composition = videoEditComposition(document, document.sequences[0].id)
  const canvas = new OffscreenCanvas(composition.width, composition.height)
  const renderer = new VideoEditRenderer(composition, { surface: canvas, previewWidth: composition.width })
  if (config.scale !== 1) renderer.setOutputScale(config.scale)
  if (config.display) renderer.setSpaceDisplay(config.display)
  timestamps = config.timestamps
  const rows: unknown[] = []
  const shots: Record<number, string> = {}
  try {
    const one = async (index: number) => {
      frame = {}; extra = {}; plan = undefined; stack.length = 0; lastSwitch = performance.now()
      const cache = undefined as undefined | { hits: number; misses: number; evictions: number; entries: number; bytes: number }
      const started = performance.now()
      enter('other')
      let result = await renderer.render(index, true, false, () => true, undefined, undefined, config.quality, undefined, true)
      const submittedMs = performance.now() - started
      await result.completion
      // --refine N：像节目监视器停住时那样，画面还在收敛（approximate）就再要同一帧，最多 N 次。
      for (let pass = 0; pass < (config.refine ?? 0) && (result as { approximate?: boolean }).approximate; pass++) {
        result = await renderer.render(index, true, false, () => true, undefined, undefined, config.quality, undefined, true)
        await result.completion
      }
      exit('other')
      const elapsedMs = performance.now() - started
      const gpu = await collectTimestamps()
      const after = cache
      if (!result.presented || result.effectErrors?.length) throw Error(JSON.stringify({ index, result }))
      if (config.shots?.includes(index)) {
        const blob = await canvas.convertToBlob({ type: 'image/png' })
        shots[index] = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(blob) })
      }
      return { frame: index, submittedMs, elapsedMs, gpuBusyMs: gpu.busy, gpuSpanMs: gpu.span, plan, stages: frame, extra,
        cache: after && cache ? { hits: after.hits - cache.hits, misses: after.misses - cache.misses, evictions: after.evictions - cache.evictions, entries: after.entries, bytes: after.bytes } : after }
    }
    // 预热：编译管线、加载 three 与字体。
    if (!config.noWarmup) for (const index of [0, 60, 120]) await one(index)
    for (let index = config.from; index < config.to; index++) rows.push(await one(index))
  } finally { timestamps = false; await renderer.dispose() }
  return { config, rows, shots }
}
Object.assign(window, { attribute })
