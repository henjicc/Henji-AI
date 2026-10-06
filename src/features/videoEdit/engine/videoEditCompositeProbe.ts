import { isUiInspectionActive } from '@/platform/runtime'
import { buildVideoEditCompositePlan } from '@/core/videoEdit/compositing'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'
import { createVideoEditDocument, videoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import { createVideoEditGraphic } from '@/core/videoEdit/graphics'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditTransitionsAt } from '@/core/videoEdit/transitions'
import { VideoEditCodeCompiler } from './videoEditCodeCompiler'
import { VideoEditCodeSources } from './videoEditCodeSources'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { renderVideoEditCompositeScene, videoEditCompositeSurfaceKeys } from './videoEditCompositeScene'

const source = (body: string, mode = 'static', parameters = '{}'): string => `export default {apiVersion:1,name:"有限合成检查",kind:"filter",mode:"${mode}",width:3840,height:2160,durationSeconds:10,seed:1,parameters:${parameters},render(ctx){${body}}}`
const check = (value: boolean, message: string): void => { if (!value) throw new Error(message) }
const percent = (values: number[], p: number): number => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]

/** Fixed pixel fixtures in the formal Electron runner only; no author/host script input. */
export async function runVideoEditCompositeProbe(host: HTMLElement): Promise<Record<string, unknown>> {
  if (!isUiInspectionActive()) throw new Error('合成实验仅由正式桌面验收运行。')
  const canvas = document.createElement('canvas'); canvas.width = 3840; canvas.height = 2160
  canvas.setAttribute('aria-label', '基础图层全分辨率实验'); canvas.style.cssText = 'width:100%;max-height:65vh;object-fit:contain'
  host.replaceChildren(canvas)
  const output = canvas.transferControlToOffscreen(); const compositor = new VideoEditGpuCompositor(output); const compiler = new VideoEditCodeCompiler()
  const model = createVideoEditDocument('有限合成检查'); const sequence = model.sequences[0]
  sequence.width = 3840; sequence.height = 2160; sequence.frameRate = { numerator: 60, denominator: 1 }
  sequence.tracks.push(...[2, 3].map(index => ({ ...sequence.tracks.find(track => track.kind === 'video')!, id: `visual-${index}`, index, name: `画面${index}` })))
  model.codeMaterials = [
    { id: 'green', name: '绿色滤镜', defaultVersionId: 'v', versions: [{ id: 'v', apiVersion: 1, languageVersion: 1, source: source('return rgba(0,1,0,.5);') }] },
    { id: 'gain', name: '红色强度', defaultVersionId: 'v', versions: [{ id: 'v', apiVersion: 1, languageVersion: 1, source: source('const c=sample(ctx.u,ctx.v);return rgba(c.r*ctx.params.gain,c.g,c.b,c.a);', 'static', '{gain:{type:"number",title:"强度",default:.5,min:0,max:1,step:.01,animatable:true}}') }] },
  ]
  const effect = (id: string, definitionId: string, amount = 1): VideoEditEffect => ({ id, name: id, enabled: true, amount, code: { definitionId, versionId: 'v', parameters: {} } })
  const graphic = (id: string, track: number, fill: [number, number, number, number], patch: Partial<VideoEditClip> = {}): VideoEditClip => {
    const definition = createVideoEditGraphic('solid', 3840, 2160); definition.objects[0].parameters.fill = fill
    model.items.push({ id: `item-${id}`, name: id, kind: 'graphic', graphic: definition })
    return { ...makeVideoEditItemClip(model, `item-${id}`, sequence.id, { frame: 0, track }), duration: 120, ...patch }
  }
  const load = (clips: VideoEditClip[], transitions?: VideoEditComposition['transitions']): VideoEditComposition => {
    sequence.clips = clips; sequence.transitions = transitions
    return videoEditComposition(model, sequence.id)
  }
  let composition = load([]); const sources = new VideoEditCodeSources(composition, () => compositor.code(), compiler)
  let snapshot: ImageBitmap | undefined
  const pixels: Array<{ name: string; actual: number[]; expected: number[] }> = []
  const render = async (frame: number, inspect = false): Promise<{ elapsed: number; cacheHits: number }> => {
    const began = performance.now(); const windows = videoEditTransitionsAt(composition, frame)
    const active = composition.clips.filter(clip => frame >= clip.start && frame < clip.start + clip.duration)
    const ids = new Set(active.map(clip => clip.id)); for (const window of windows) for (const clip of [window.left, window.right]) if (!ids.has(clip.id)) { active.push(clip); ids.add(clip.id) }
    const nodes = buildVideoEditCompositePlan(active, windows)
    await compositor.prepareImages(new Map(), () => true, new Set(active.filter(clip => clip.kind === 'text').map(clip => clip.id)), new Set(active.map(clip => clip.id)))
    const prepared = await sources.prepare(composition, active, frame, () => true, undefined, { transitions: windows, surfaceKeys: videoEditCompositeSurfaceKeys(nodes) })
    const device = inspect ? prepared.pictures.values().next().value?.owner : undefined
    device?.pushErrorScope('validation')
    let validationError: { message?: string } | null | undefined
    try {
      const result = await renderVideoEditCompositeScene(composition, nodes, new Map(active.map(clip => [clip.id, prepared.pictures.get(clip.id) ?? null])), prepared.effects, compositor, frame, () => true)
      check(result.presented, '正式合成没有提交画面')
      // A connected canvas can be presented/cleared by Chromium while awaiting the
      // fence. Capture its submitted texture first, then wait before consuming it.
      if (inspect) { snapshot?.close(); snapshot = output.transferToImageBitmap() }
      await result.completion
    } finally {
      validationError = await device?.popErrorScope()
    }
    if (validationError) throw new Error(`真实合成GPU验证失败：${validationError.message}`)
    const elapsed = performance.now() - began
    return { elapsed, cacheHits: prepared.cacheHits }
  }
  const set = (next: VideoEditComposition): void => { composition = next; sources.updateDocument(next) }
  const pixel = (name: string, x: number, y: number, expected: number[]): void => {
    const sample = new OffscreenCanvas(1, 1); const context = sample.getContext('2d', { willReadFrequently: true })!
    context.drawImage(snapshot!, x, y, 1, 1, 0, 0, 1, 1); const actual = [...context.getImageData(0, 0, 1, 1).data]
    pixels.push({ name, actual, expected }); check(actual.every((value, index) => Math.abs(value - expected[index]) <= 3), `${name}实际像素${actual}，预期${expected}`)
  }
  const update = (clips: VideoEditClip[], transitions?: VideoEditComposition['transitions']): void => set(load(clips, transitions))
  let runtime: Awaited<ReturnType<typeof compositor.code>> | undefined
  try {
    const shapes = graphic('命名对象', 1, [0, 0, 0, 0]); const rect = createVideoEditGraphic('rect', 3840, 2160).objects[0]
    Object.assign(rect.parameters, { x: 200, y: 200, width: 100, height: 40, rotation: 90, fill: [1, 0, 0, .5], opacity: .5 })
    const ellipse = createVideoEditGraphic('ellipse', 3840, 2160).objects[0]; Object.assign(ellipse.parameters, { x: 600, y: 200, width: 200, height: 100, fill: [0, 1, 0, .5] })
    const title = createVideoEditGraphic('text', 3840, 2160).objects[0]; Object.assign(title.parameters, { x: 1920, y: 1250, text: '原生图层 · 4K', fontSize: 160, align: 'center', color: [1, 1, 1, 1] })
    shapes.graphic!.objects = [rect, ellipse, title]
    update([shapes]); const cold = await render(0, true); runtime = await compositor.code()
    pixel('旋转矩形内部RGBA合成', 250, 180, [64, 0, 0, 255]); pixel('原未旋转位置为空', 210, 220, [0, 0, 0, 255]); pixel('椭圆中心', 700, 250, [0, 128, 0, 255]); pixel('椭圆外角', 602, 202, [0, 0, 0, 255])
    const cached = await render(0); check(cached.cacheHits === 1, '静态结构化图形没有命中同会话缓存')
    const red = graphic('滤镜片段', 1, [1, 0, 0, .5], { opacity: .5, effects: [effect('片段滤镜', 'green', .5)] })
    update([red]); await render(0, true); pixel('片段几何透明度先归一化后强度混合', 100, 100, [32, 64, 0, 255])
    const lower = graphic('范围外红色', 1, [1, 0, 0, .5]); const band = graphic('范围内蓝色', 2, [0, 0, 1, .5])
    model.items.push({ id: 'item-adjustment', name: '调整图层', kind: 'adjustment' })
    const adjustment = { ...makeVideoEditItemClip(model, 'item-adjustment', sequence.id, { frame: 0, track: 3 }), duration: 120, opacity: .25, adjustment: { fromTrack: 2 }, effects: [effect('调整滤镜', 'green')] }
    update([lower, band, adjustment]); await render(0, true); pixel('调整层只替换下方指定范围并保留原band', 100, 100, [64, 32, 96, 255])
    const left = graphic('转场左端', 1, [1, 0, 0, .5], { duration: 60, opacity: .5 }); const right = graphic('转场右端', 1, [0, 0, 1, .5], { start: 60, opacity: .75 })
    update([left, right], [{ id: 'cross', kind: 'cross_dissolve', leftClipId: left.id, rightClipId: right.id, durationFrames: 10 }])
    for (const [frame, expected] of [[55, [64, 0, 0, 255]], [60, [28, 0, 53, 255]], [64, [0, 0, 96, 255]]] as const) { await render(frame, true); pixel(`交叉溶解帧${frame}单次预乘混合`, 100, 100, [...expected]) }
    const long = graphic('长源入点', 1, [1, 0, 0, .5], { sourceInUs: 3_600_000_000, effects: [effect('长源滤镜', 'gain')] })
    long.effects![0].code!.curves = { gain: [{ id: 'k0', sourceInUs: 3_600_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, value: 0, interpolation: 'linear' }, { id: 'k1', sourceInUs: 3_601_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, value: 1, interpolation: 'linear' }] }
    update([long]); await render(30, true); pixel('一小时源入点参数曲线继续真实求值', 100, 100, [64, 0, 0, 255])
    const unsafe = await compiler.compile(source('return rgba(clamp(1/(ctx.localTime+.5),0,1),0,0,1);', 'dynamic'))
    const safe = await compiler.compile(source('return rgba(clamp(1/(max(ctx.localTime,0)+.5),0,1),0,0,1);', 'dynamic'))
    const input = await runtime.target('proof-input', 3840, 2160)
    const time = { time: 1, localTime: 0, sequenceTime: 1, frame: 60, fps: 60, width: 3840, height: 2160 }
    await runtime.filter('proof-output', 'ordinary-proof', unsafe, time, {}, input)
    const proofBefore = runtime.diagnostics(); let rejected = false
    try { await runtime.filter('unsafe-output', 'ordinary-proof', unsafe, { ...time, localTime: -.5 }, {}, input, true) } catch (error) { rejected = error instanceof Error && error.message.includes('除数') }
    check(rejected && JSON.stringify(proofBefore) === JSON.stringify(runtime.diagnostics()), '负时钟证明失败应先于GPU提交/分配')
    await runtime.filter('proof-output', 'safe-proof', safe, { ...time, localTime: -.5 }, {}, input, true)
    const proof = { rejected, before: proofBefore, after: runtime.diagnostics() }
    const hotClip = graphic('热帧', 1, [1, .2, .1, .5], { duration: 240, effects: [effect('热帧滤镜', 'gain')] })
    update([hotClip]); await render(0)
    const before = runtime.diagnostics(); const hot: number[] = []; let hits = 0
    for (let frame = 1; frame <= 180; frame++) { const result = await render(frame); hot.push(result.elapsed); hits += result.cacheHits }
    const after = runtime.diagnostics()
    check(before.textureAllocations === after.textureAllocations && before.pipelineCompiles === after.pipelineCompiles && before.externalCopies === after.externalCopies, '热帧应复用纹理、管线和字形')
    const changed = { ...hotClip, effects: [{ ...hotClip.effects![0], code: { ...hotClip.effects![0].code!, parameters: { gain: .8 } } }] }
    // Keep the clip alive at frame 180 for the entire declared hot sequence.
    update([{ ...changed, duration: 240 }]); const response = await render(0, true); pixel('只改参数后的实际画面', 100, 100, [102, 26, 13, 255])
    update([shapes]); await render(0, true)
    const inspection = document.createElement('canvas'); inspection.width = 3840; inspection.height = 2160; inspection.style.cssText = canvas.style.cssText
    inspection.setAttribute('aria-label', '基础图层全分辨率实验结果'); inspection.getContext('2d')!.drawImage(snapshot!, 0, 0); host.replaceChildren(inspection)
    await sources.dispose(); await compositor.dispose()
    return { completed: true, resolution: [3840, 2160], pixels, coldMs: cold.elapsed, cacheHitMs: cached.elapsed, cacheHits: hits, hotFrames: hot.length, completedGpuFrameMs: { mean: hot.reduce((sum, value) => sum + value, 0) / hot.length, p95: percent(hot, .95), max: Math.max(...hot) }, parameterResponseMs: response.elapsed, before, after, proof, compiler: compiler.diagnostics(), disposed: runtime.diagnostics() }
  } finally { snapshot?.close(); await sources.dispose(); await compositor.dispose() }
}
