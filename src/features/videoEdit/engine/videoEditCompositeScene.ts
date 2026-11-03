import { videoEditEffectNeedsFloat } from './videoEditRenderPrecision'
import { SPACE_ONLY_FIELDS } from '@/core/videoEdit/spatialSchema'
import type { VideoEditMotionSampledClip } from '@/core/videoEdit/motionBlur'
import type { EffectQuality } from '@/core/imaging/effects/descriptor'
import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditCompositeNode } from '@/core/videoEdit/compositing'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'
import { activeVideoEditEffects } from '@/core/videoEdit/compositing'
import { videoEditEffectUsesSubject } from '@/core/videoEdit/builtinEffects'
import type { VideoEditSmartRegionMask } from './videoEditSmartRegionMasks'
import { videoEditTransitionAmount, videoEditTransitionDipColor, videoEditTransitionPictureClips, videoEditTransitionRender } from '@/core/videoEdit/transitions'
import type { PreparedVideoEditEffect } from './videoEditCodeSources'
import type { VideoEditCodeGpu } from './videoEditCodeGpu'
import { VideoEditCodePicture } from './videoEditCodePicture'
import type { VideoEditGpuCompositor, VideoEditPicture, VideoEditMaterialViewport } from './videoEditGpuCompositor'
import { planVideoEditBuiltinEffect } from './videoEditBuiltinEffectPasses'
import { isShaderGraphEffect } from '@/core/videoEdit/shaderGraph/effects'
import { VIDEO_EDIT_PRECISE_FORMAT, videoEditPictureHighPrecision } from './videoEditGpuFrame'
import { isSpaceGlassMaterial } from './videoEditSpaceMaterials'
import type { VideoEditTrackedClip } from './videoEditTrackResults'
import type { AuthorGpuInputs } from './videoEditAuthorModule'
import type { PreparedVideoEditCodeEffect } from './videoEditCodeSources'
import type { SpatialCodeSources, SpatialExposurePlan, SpatialFrameRequest, SpatialMaterialPlan, SpatialPictureLease, SpatialTargetSpec } from './videoEditSpatialContracts'
import { videoEditPictureTransitionsAt } from '@/core/videoEdit/clipGeometry'
import type { BuiltinEncodingBatch } from './videoEditBuiltinEffectsGpu'
import { documentFontRevision } from '@/platform/fontFaces'

export type VideoEditFilterFrameReader = (clip: VideoEditClip, plan: PreparedVideoEditCodeEffect, input: VideoEditCodePicture) => Promise<AuthorGpuInputs['frames']>

interface Layer { clip: VideoEditClip; picture: VideoEditPicture }
export interface VideoEditCompositeReplacements {
  pictures: ReadonlyMap<string, VideoEditCodePicture>
  /**
   * 要看见下方画面的空间组（组里有玻璃等透射材质）：合成树走到它时，把它下面已经解析好的各层（含父层级更早的层）
   * 先合成为一张画面交给它，再画这一组。下方各层只解析一次，最终合成照常再叠一遍；没有下方内容时给 undefined。
   */
  deferred?: ReadonlyMap<string, (below: VideoEditCodePicture | undefined) => Promise<VideoEditCodePicture>>
  replaced: ReadonlySet<string>
}
const effective = (clip: VideoEditClip): boolean => activeVideoEditEffects(clip).length > 0
const slot = (clip: VideoEditClip, index: number): string => `composite:clip:${clip.id}:${index}`
// Chain length never determines target count. The current picture and filtered output
// ping-pong; fractional strength/masks need a third target to read both originals.
// A translucent adjustment layer keeps one additional unchanged band for its final mix.
const slots = (clip: VideoEditClip): string[] => Array.from({ length: effective(clip) ? clip.kind === 'adjustment' && clip.opacity < 1 ? 4 : 3 : 1 }, (_, index) => slot(clip, index))
/**
 * 智能区域的低分辨率上传纹理全场景共用；同一片段里配置相同的作用区域共用放置结果。
 * 批次开始前分别放置不同区域，避免后续上传覆盖批次尚未读取的蒙版。
 */
const MASK_SOURCE = 'composite:mask:source'; const MASK_DOCUMENT = 'composite:mask:document'
/** 人物蒙版在片段画面外延续后的那张（工序纹理 `subject`）。 */
const SUBJECT_DOCUMENT = 'composite:mask:subject'
const regionKey = (clip: VideoEditClip, effect: VideoEditEffect, subject = false): string => subject ? `${SUBJECT_DOCUMENT}:${clip.id}` : `${MASK_DOCUMENT}:${clip.id}:${JSON.stringify(effect.mask)}`
const subjectUsed = (clip: VideoEditClip): boolean => activeVideoEditEffects(clip).some(effect => videoEditEffectUsesSubject(effect.builtin))
const masked = (clip: VideoEditClip): boolean => subjectUsed(clip) || activeVideoEditEffects(clip).some(effect => effect.mask)
const maskKeys = (keys: Set<string>, clip: VideoEditClip): void => {
  if (masked(clip)) keys.add(MASK_SOURCE)
  if (subjectUsed(clip)) keys.add(MASK_DOCUMENT)
  for (const effect of activeVideoEditEffects(clip)) {
    if (effect.mask) keys.add(regionKey(clip, effect))
    if (videoEditEffectUsesSubject(effect.builtin)) keys.add(regionKey(clip, effect, true))
  }
}
/** Reserve the entire frame together with generated pictures before releasing old targets. */
export function videoEditCompositeSurfaceKeys(nodes: readonly VideoEditCompositeNode[]): Set<string> {
  const keys = new Set<string>()
  const visit = (node: VideoEditCompositeNode): void => {
    // 空间组要看见下方画面时合成那张下方画面的目标（只登记名字，用到时才分配）：键名不在这里，下一帧会被当成用不着而销毁。
    if (node.kind !== 'adjustment') keys.add(`composite:below:${node.kind === 'transition' ? `transition:${node.window.transition.id}` : node.clip.id}`)
    if (node.kind === 'clip') { if (effective(node.clip)) slots(node.clip).forEach(key => keys.add(key)); maskKeys(keys, node.clip) }
    else if (node.kind === 'transition') {
      for (const clip of videoEditTransitionPictureClips(node.window)) { slots(clip).forEach(key => keys.add(key)); maskKeys(keys, clip) }
      keys.add(`composite:transition:${node.window.transition.id}`)
    } else {
      node.children.forEach(visit)
      if (effective(node.clip) && node.clip.opacity > 0) {
        slots(node.clip).forEach(key => keys.add(key))
        maskKeys(keys, node.clip)
      }
    }
  }
  nodes.forEach(visit); return keys
}
/** Render-only full-canvas layer; original persisted geometry and clocks stay unchanged. */
function identity(clip: VideoEditClip): VideoEditClip { const result: VideoEditTrackedClip & VideoEditMotionSampledClip = { ...clip, x: 0, y: 0, anchorX: 0.5, anchorY: 0.5, scale: 1, rotation: 0, opacity: 1 }; delete result.scaleAspect; delete result.trackingQuad; delete result.motionSamples; return result }

function materialBuiltinPlan(builtin: NonNullable<PreparedVideoEditEffect['builtin']>, clip: VideoEditClip, frame: number, size: { width: number; height: number }, fps: number, quality: EffectQuality, viewport: VideoEditMaterialViewport): ReturnType<typeof planVideoEditBuiltinEffect> {
  const renderScale = size.height / viewport.bounds.height
  const logical = viewport.referenceSize, bounds = viewport.bounds
  return planVideoEditBuiltinEffect(builtin, { ...size, frame: frame - clip.start, renderScale, quality, frameDuration: 1 / fps, referenceSize: logical,
    layer: { referenceSize: logical, contentBounds: { x: 0, y: 0, width: logical.width, height: logical.height }, rasterScale: renderScale, rasterOrigin: [-bounds.x * renderScale, -bounds.y * renderScale], quality } })
}

/**
 * `document` carries the size the frame is drawn at; `logical` is the sequence's own size. They differ only at a reduced
 * playback resolution (task 4.9): code filters then still read the sequence size (a `1/width` offset stays the same
 * fraction of the picture) and built-in effects learn the scale for the few amounts that cannot shrink below a pixel.
 */
export async function renderVideoEditCompositeScene(document: VideoEditComposition, nodes: readonly VideoEditCompositeNode[], pictures: ReadonlyMap<string, VideoEditPicture>, effects: ReadonlyMap<string, readonly PreparedVideoEditEffect[]>, compositor: Pick<VideoEditGpuCompositor, 'code' | 'draw'> & Partial<Pick<VideoEditGpuCompositor, 'spatial'>>, frame: number, shouldPresent: () => boolean, deadline?: number, logical: Pick<VideoEditComposition, 'width' | 'height'> = document, target?: VideoEditCodePicture | ((pictures: readonly VideoEditPicture[]) => Promise<VideoEditCodePicture>), onEffectError?: (effect: VideoEditEffect, error: unknown) => void, quality: EffectQuality = 'interactive', readFilterFrames?: VideoEditFilterFrameReader, replacements?: VideoEditCompositeReplacements, materialViewport?: VideoEditMaterialViewport): Promise<{ presented: boolean; completion: Promise<void> }> {
  const renderScale = document.height / (materialViewport?.bounds.height ?? logical.height)
  let runtime: VideoEditCodeGpu | undefined
  const submissions: Array<Promise<PromiseSettledResult<void>>> = []
  const watch = (completion: Promise<void>): void => { submissions.push(completion.then(value => ({ status: 'fulfilled', value } as const), reason => ({ status: 'rejected', reason } as const))) }
  const current = (): void => { if (!shouldPresent()) throw new DOMException('旧合成画面已取消。', 'AbortError') }
  const gpu = async (): Promise<VideoEditCodeGpu> => { current(); runtime ??= await compositor.code(); current(); return runtime }
  const normalize = async (clip: VideoEditClip, layers: readonly Layer[]): Promise<VideoEditCodePicture> => {
    // 整链需求必须在首个效果前归并，避免前置逐像素效果先写进八位目标。
    const format = layers.some(layer => videoEditPictureHighPrecision(layer.picture)) || clip.effectsEnabled !== false && (effects.get(clip.id) ?? []).some(plan => plan.effect.enabled && plan.effect.amount > 0 && plan.builtin && videoEditEffectNeedsFloat(plan.builtin, { width: document.width, height: document.height, quality, renderScale, referenceSize: logical })) ? VIDEO_EDIT_PRECISE_FORMAT : 'rgba8unorm'
    const target = await (await gpu()).target(slot(clip, 0), document.width, document.height, format); current()
    const result = await compositor.draw(document, layers.map(layer => layer.clip), layers.map(layer => layer.picture), shouldPresent, undefined, target, materialViewport)
    watch(result.completion)
    current(); if (!result.presented) throw new DOMException('旧合成画面已取消。', 'AbortError')
    return target
  }
  /** 低分辨率蒙版按片段自己的位置、缩放、旋转画到序列尺寸，与片段画面逐像素对齐。 */
  const placeMask = async (runtime: VideoEditCodeGpu, clip: VideoEditClip, mask: VideoEditSmartRegionMask, subject = false, key = MASK_DOCUMENT): Promise<VideoEditCodePicture> => {
    const source = await runtime.uploadMask(MASK_SOURCE, mask.width, mask.height, mask.data, subject)
    const region = await runtime.target(key, document.width, document.height); current()
    const drawn = await compositor.draw(document, [{ ...clip, opacity: 1 }], [source], shouldPresent, undefined, region, materialViewport)
    watch(drawn.completion); current(); if (!drawn.presented) throw new DOMException('旧合成画面已取消。', 'AbortError')
    return region
  }
  /** `fade`：普通片段在效果链之后整体乘不透明度（与 AE 一致）；调整层按强度与原画混合。 */
  const apply = async (clip: VideoEditClip, input: VideoEditCodePicture, fade = false): Promise<VideoEditCodePicture> => {
    const runtime = await gpu(); const targets = slots(clip); const preserve = clip.kind === 'adjustment' && clip.opacity < 1
    let result = input; let key = targets[0]
    const placed = new Map<string, VideoEditCodePicture>()
    const masks = new Map<PreparedVideoEditEffect, { region?: VideoEditCodePicture; subject?: VideoEditCodePicture }>()
    for (const plan of effects.get(clip.id) ?? []) {
      if (clip.effectsEnabled === false || !plan.effect.enabled || plan.effect.amount <= 0 || !plan.builtin) continue
      const regionTarget = regionKey(clip, plan.effect), subjectTarget = regionKey(clip, plan.effect, true)
      const region = plan.mask ? placed.get(regionTarget) ?? await placeMask(runtime, clip, plan.mask, false, regionTarget) : undefined
      const subject = plan.subject ? placed.get(subjectTarget) ?? await runtime.subjectMatte(subjectTarget, await placeMask(runtime, clip, plan.subject, true)) : undefined
      if (region) placed.set(regionTarget, region)
      if (subject) placed.set(subjectTarget, subject)
      masks.set(plan, { region, subject }); current()
    }
    // 空间材料上的原生内置效果按材料视口换算图层坐标，由空间合成器自己编码，不进片段批次。
    const spatialBuiltin = async (builtin: NonNullable<PreparedVideoEditEffect['builtin']>, target: string, input: VideoEditCodePicture, subject?: VideoEditCodePicture): Promise<VideoEditCodePicture> => {
      if (!compositor.spatial) throw new Error('空间材料效果缺少共享合成器。')
      const filtered = await runtime.target(target, input.width, input.height, VIDEO_EDIT_PRECISE_FORMAT)
      const operation = materialBuiltinPlan(builtin, clip, frame, input, document.fps, quality, materialViewport!)
      await (await compositor.spatial()).encodeBuiltin(operation, input.texture, filtered.texture, filtered.textureFormat, document.colorLuts ?? [], subject)
      return filtered
    }
    let batch: BuiltinEncodingBatch | undefined
    const flush = (): void => { if (batch) { runtime.finishBuiltinBatch(batch); batch = undefined } }
    try {
      for (const plan of effects.get(clip.id) ?? []) {
        if (clip.effectsEnabled === false || !plan.effect.enabled || plan.effect.amount <= 0) continue
        current()
        const free = targets.filter(target => target !== key && (!preserve || target !== targets[0]))
        const previous = result; const previousKey = key
        try {
          // 效果时钟按片段自己的帧号与帧时长：复制、挪动片段观感不变，与只记相对位置的预渲染窗口一致；只在渲染时传递，不写入效果参数。
          const spatialMaterial = !!plan.builtin && !!materialViewport && !isShaderGraphEffect(plan.builtin.id)
          const native = plan.builtin && !isShaderGraphEffect(plan.builtin.id) && !spatialMaterial
          if (native) batch ??= await runtime.beginBuiltinBatch()
          else flush()
          const subject = masks.get(plan)?.subject
          const filtered = plan.builtin
            ? spatialMaterial ? await spatialBuiltin(plan.builtin, free[0], result, subject) : await runtime.builtin(free[0], plan.builtin, result, frame - clip.start, renderScale, document.colorLuts, quality, logical, 1 / document.fps, subject, batch)
            : await runtime.authorFilter(free[0], plan.instanceKey, plan.program, plan.parameters, result, plan.info, plan.program.frames.length ? await readFilterFrames?.(clip, plan, result) : [], plan.simulation, logical, current)
          current()
          if (plan.builtin && plan.mask) {
            // 只在区域内混入效果。
            const region = masks.get(plan)!.region!
            result = await runtime.maskedMix(free[1], result, filtered, region, plan.effect.amount, batch); key = free[1]; current()
          } else if (plan.effect.amount === 1) { result = filtered; key = free[0] }
          else { result = await runtime.mix(free[1], result, filtered, plan.effect.amount, undefined, batch); key = free[1]; current() }
        } catch (error) {
          current()
          if (plan.builtin || !onEffectError) throw error
          result = previous; key = previousKey
          onEffectError(plan.effect, error)
        }
      }
      if (preserve && result !== input) {
        const target = targets.find(target => target !== key && target !== targets[0])!
        result = await runtime.mix(target, input, result, clip.opacity, undefined, batch); current()
      } else if (fade && clip.opacity < 1) {
        result = await runtime.mix(targets.find(target => target !== key)!, 'transparent', result, clip.opacity, undefined, batch); current()
      }
      flush()
      return result
    } catch (error) { if (batch) runtime.abandonBuiltinBatch(batch); throw error }
  }
  const resolveClip = async (clip: VideoEditClip, force = false): Promise<Layer> => {
    const replacement = replacements?.pictures.get(clip.id)
    if (replacement) return { clip: identity(clip), picture: replacement }
    if (!pictures.has(clip.id)) throw new Error(`合成片段“${clip.name}”尚未准备画面。`)
    const layer = { clip, picture: pictures.get(clip.id)! }
    if (!force && !materialViewport && !effective(clip)) return layer
    if (!effective(clip)) return { clip: identity(clip), picture: await normalize(clip, [layer]) }
    // 与 AE 一致，片段不透明度在效果链之后乘：效果看到的是完整不透明的画面（按透明度取轮廓的描边、发光不会随淡入淡出变形），
    // 结果再整体乘一次；乘在画面里而不是交给最后的绘制，过渡两端拿到的画面同样带着不透明度。
    return { clip: identity(clip), picture: await apply(clip, await normalize(clip, [{ clip: { ...clip, opacity: 1 }, picture: layer.picture }]), true) }
  }
  const resolve = async (nodes: readonly VideoEditCompositeNode[], outer: readonly Layer[] = []): Promise<Layer[]> => {
    const layers: Layer[] = []
    for (const node of nodes) {
      current()
      const id = node.kind === 'transition' ? `transition:${node.window.transition.id}` : node.clip.id
      const replacement = replacements?.pictures.get(id)
      if (replacement) { layers.push({ clip: identity(node.kind === 'transition' ? node.window.left : node.clip), picture: replacement }); continue }
      const deferred = replacements?.deferred?.get(id)
      if (deferred) {
        const under = [...outer, ...layers]
        let below: VideoEditCodePicture | undefined
        if (under.length) {
          below = await (await gpu()).target(`composite:below:${id}`, document.width, document.height, VIDEO_EDIT_PRECISE_FORMAT); current()
          const drawn = await compositor.draw(document, under.map(layer => layer.clip), under.map(layer => layer.picture), shouldPresent, undefined, below, materialViewport)
          watch(drawn.completion); current(); if (!drawn.presented) throw new DOMException('旧合成画面已取消。', 'AbortError')
        }
        layers.push({ clip: identity(node.kind === 'transition' ? node.window.left : node.clip), picture: await deferred(below) }); current()
        continue
      }
      if (replacements?.replaced.has(id)) continue
      if (node.kind === 'clip') layers.push(await resolveClip(node.clip))
      else if (node.kind === 'transition') {
        // 单侧过渡（4.4）两边是同一个片段，只准备一次画面；停用的一侧（empty）不准备画面，按透明画。
        // 怎么画由 videoEditTransitionRender 统一给出：交叉溶解、黑场、白场走混合，带参数的过渡（4.7）走内置效果着色器。预览与导出都经过这里。
        const { window } = node
        const shown = window.empty === 'left' ? window.right : window.left
        const first = (await resolveClip(shown, true)).picture as VideoEditCodePicture
        const second = window.side || window.empty ? first : (await resolveClip(window.right, true)).picture as VideoEditCodePicture
        const left = window.empty === 'left' ? 'transparent' : first; const right = window.empty === 'right' ? 'transparent' : second
        const render = videoEditTransitionRender(window, frame); const key = `composite:transition:${window.transition.id}`
        const runtime = await gpu()
        // 内置过渡的空侧由 input 标记，那一侧传另一侧的画面占位，与单侧过渡相同。
        const picture = render.kind === 'mix'
          ? await runtime.mix(key, left, right, render.amount, render.through)
          : await runtime.transition(key, render.input, first, second)
        current()
        layers.push({ clip: identity(shown), picture })
      } else {
        const children = await resolve(node.children, [...outer, ...layers])
        if (!effective(node.clip) || node.clip.opacity <= 0) layers.push(...children)
        else {
          const band = await normalize(node.clip, children)
          layers.push({ clip: identity(node.clip), picture: await apply(node.clip, band) })
        }
      }
    }
    return layers
  }
  const layers = await resolve(nodes); current()
  const result = await compositor.draw(document, layers.map(layer => layer.clip), layers.map(layer => layer.picture), shouldPresent, deadline, typeof target === 'function' ? await target(layers.map(layer => layer.picture)) : target)
  watch(result.completion)
  return { presented: result.presented, completion: Promise.all(submissions).then(results => { const failed = results.find(value => value.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason }) }
}

/** 空间组替换原合成树中的连续项，二维覆盖和调整层仍由同一棵树处理。 */
/** 弥散圆系数 K：视深 z 处半径 = K·|z − S| / z（输出像素），与空间求值 opticalCocRadius 同一公式。 */
function threeSpaceCocScale(camera: import('@/core/videoEdit/spatialTypes').SpatialCameraFrame, output: import('@/core/videoEdit/spatialTypes').SpatialOutput): number {
  const f = camera.focalLengthMm, sf = camera.focusDistance * 1000
  if (camera.defocus === 0 || !(sf > f && camera.fStop > 0)) return 0
  return f * f / (camera.fStop * (sf - f)) * .5 / camera.sensorWidthMm * output.width * camera.defocus
}

/**
 * 每份作品的卡片材料：键相同就沿用上一帧的纹理（内容、放置、效果都没变），不再重画；
 * 卡片按自身视深整张虚化（弥散半径与空间求值同一光学公式），虚化结果另按景深参数缓存，拉焦时只重做虚化。
 */
interface ThreeSpaceMaterial { key: string; lease: SpatialPictureLease; defocusKey?: string; defocused?: SpatialPictureLease }
// 按空间 GPU 实例分开：换了设备（重建渲染器、设备丢失后重建）的旧纹理不能跨设备使用。
const threeSpaceMaterials = new WeakMap<object, Map<string, Map<string, ThreeSpaceMaterial>>>()

/**
 * 统一三维渲染器的接入：每个空间组的卡片与作者 three 场景交给同一个 three 场景一次绘制，景深与运动模糊整幅后处理；
 * 各组结果按原来的方式换回二维合成树（调整层、非空间片段照旧）；空间转场按两端各画一次再混合。
 */
export async function renderVideoEditThreeSpaceScene(options: {
  request: SpatialFrameRequest; plan: SpatialExposurePlan; sources: SpatialCodeSources
  drawn: VideoEditComposition; active: readonly VideoEditClip[]; nodes: readonly VideoEditCompositeNode[]
  pictures: ReadonlyMap<string, VideoEditPicture>; effects: ReadonlyMap<string, readonly PreparedVideoEditEffect[]>
  compositor: VideoEditGpuCompositor; readFilterFrames?: VideoEditFilterFrameReader
  onEffectError?: (effect: VideoEditEffect, error: unknown) => void
  compositionAt?: import('./videoEditSpatialExposurePlan').SpatialCompositionAt
  display?: import('@/core/videoEdit/spaceDisplay').VideoEditSpaceRenderDisplay
  /** 显示方式为“渲染”时的路径追踪安排（各空间组按组号再细分）。 */
  trace?: Omit<import('./videoEditThreeSpace').ThreeSpaceTrace, 'group'>
  /** 路径追踪这一帧还没收敛：画面先交出去，宿主稍后再要一次同一帧。 */
  /** 画面还在收敛（路径追踪没到目标）；`progress` 是这一组的追踪进度（0–1）。 */
  onRefining?: (progress: number) => void
  /** 导出的那条序列的三维渲染设置（嵌套序列跟随它）：泛光、遮蔽、反射强度从这里取。 */
  spaceRender?: import('@/core/videoEdit/document').VideoEditSpaceRender }): Promise<SpatialPictureLease> {
  const { request, plan, sources, drawn, active, nodes, pictures, effects, compositor } = options
  const [{ evaluateVideoEditClip, videoEditKeyframeValues }, { videoEditFadeOpacity }, { spatialClipMatrix, includeSpatialWorldBounds }, math] = await Promise.all([import('@/core/videoEdit/keyframes'), import('@/core/videoEdit/fades'),
    import('@/core/videoEdit/spatialEvaluation'), import('@/core/videoEdit/spatialMatrices')])
  // 材料面只覆盖片段的逻辑边界：先映射回参考平面、抵掉二维放置，再乘卡片几何。
  const materialToCard = (material: SpatialMaterialPlan, clip: VideoEditClip) => {
    const base = evaluateVideoEditClip(options.compositionAt?.(request.sequenceFrame).clips.find(value => value.id === clip.id) ?? clip, request.sequenceFrame)
    return math.spatialMultiply(math.spatialInverse(spatialClipMatrix(request.composition, { ...base, spatial: { enabled: false } }, request.output)),
      math.spatialTranslation(-request.output.displayWidth / request.output.displayHeight / 2, .5, 0),
      math.spatialScale(1 / request.output.displayHeight, -1 / request.output.displayHeight, 1), material.uvToReference)
  }
  const spatial = await compositor.spatial(), space = await compositor.threeSpace(), runtime = await compositor.code()
  const current = (): boolean => { request.signal.throwIfAborted(); request.assertCurrent(); return true }
  const outputSpec = (key: string): SpatialTargetSpec => ({ key, width: request.output.width, height: request.output.height, format: 'rgba16float', usage: 1 | 2 | 4 | 16 })
  const capture = async (spec: SpatialTargetSpec, action: (picture: VideoEditCodePicture) => Promise<{ completion: Promise<void> }>, carriesLight = false): Promise<SpatialPictureLease> => {
    const target = spatial.target(spec)
    try {
      const picture = compositor.spatialPicture({ texture: target.texture, width: spec.width, height: spec.height, format: spec.format, carriesLight })
      const result = await action(picture)
      target.completion = result.completion
      return spatial.picture(target, carriesLight || picture.carriesLight)
    } finally {
      target.completion = spatial.completion()
      await spatial.releaseTarget(target)
    }
  }
  const caches = threeSpaceMaterials.get(spatial) ?? new Map<string, Map<string, ThreeSpaceMaterial>>()
  threeSpaceMaterials.set(spatial, caches)
  const cache = caches.get(request.composition.id) ?? new Map<string, ThreeSpaceMaterial>()
  caches.set(request.composition.id, cache)
  const used = new Set<string>()
  const cardMaterial = async (material: SpatialMaterialPlan): Promise<SpatialPictureLease> => {
    current()
    const input = pictures.get(material.clipId)
    const original = active.find(clip => clip.id === material.clipId)
    if (input === undefined || !original) throw new Error(`空间卡片 ${material.clipId} 缺少中心画面。`)
    const plans = effects.get(original.id) ?? []
    const inputKey = input instanceof VideoEditCodePicture ? input.contentKey === undefined ? undefined : ['code', input.contentKey, input.width, input.height, input.displayWidth, input.displayHeight, input.textureFormat, input.carriesLight]
      : input === null && original.kind === 'text' ? ['text', documentFontRevision()]
      : typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap ? ['bitmap', spatial.identity(input), input.width, input.height] : undefined
    const cacheable = inputKey !== undefined && plans.every(value => value.builtin && !value.mask && !value.subject && !isShaderGraphEffect(value.builtin.id))
    const key = cacheable ? JSON.stringify([inputKey, { ...original, curves: undefined, spatial: undefined, depth: undefined, rotationX: undefined, rotationY: undefined, anchorDepth: undefined, ...SPACE_ONLY_FIELDS, motionSamples: undefined, opacity: 1 },
      material.referenceSize, material.logicalBounds, material.rasterScale, material.target.width, material.target.height, request.output, request.quality, drawn.colorLuts,
      plans.map(value => materialBuiltinPlan(value.builtin!, original, request.sequenceFrame, material.target, drawn.fps, request.quality, { referenceSize: material.referenceSize, bounds: material.logicalBounds }))]) : undefined
    used.add(material.clipId)
    const held = cache.get(material.clipId)
    if (key !== undefined && held?.key === key) return defocused(material, held)
    const clip = { ...original, opacity: 1 } as VideoEditClip & VideoEditMotionSampledClip
    delete clip.motionSamples
    const local = { ...drawn, width: material.target.width, height: material.target.height }
    const node: VideoEditCompositeNode = { kind: 'clip', clip, fromTrack: clip.track, toTrack: clip.track + 1 }
    const carriesLight = input instanceof Object && 'carriesLight' in input && input.carriesLight === true
    const lease = await capture({ ...material.target, key: `three:card:${material.clipId}`, usage: 1 | 2 | 4 | 16 }, target => renderVideoEditCompositeScene(local, [node], new Map([[clip.id, input]]), effects, compositor, request.sequenceFrame, current, undefined,
      material.referenceSize, target, options.onEffectError, request.quality, options.readFilterFrames, undefined,
      { referenceSize: material.referenceSize, bounds: material.logicalBounds,
        rasterTier: 2 ** Math.max(0, Math.round(Math.log2(material.rasterScale[1] / (request.output.height / request.output.displayHeight)))) }), carriesLight)
    if (held) { void held.lease.release(lease.completion).catch(() => undefined); void held.defocused?.release(lease.completion).catch(() => undefined) }
    if (key === undefined) { cache.delete(material.clipId); transient.push(lease); return defocused(material, { key: '', lease }, true) }
    const entry: ThreeSpaceMaterial = { key, lease }
    cache.set(material.clipId, entry)
    return defocused(material, entry)
  }
  const defocused = async (material: SpatialMaterialPlan, entry: ThreeSpaceMaterial, once = false): Promise<SpatialPictureLease> => {
    // 实体、线框预览不做景深，卡片也不虚化。
    if (material.defocus.bypass || (options.display ?? 'realtime') !== 'realtime') return entry.lease
    const defocusKey = JSON.stringify(material.defocus)
    if (entry.defocusKey === defocusKey && entry.defocused) return entry.defocused
    const result = await spatial.defocus(entry.lease, material)
    if (once) { transient.push(result); return result }
    void entry.defocused?.release(result.completion).catch(() => undefined)
    entry.defocusKey = defocusKey; entry.defocused = result
    return result
  }
  const transient: SpatialPictureLease[] = []
  const prepared = await sources.prepareSpatialFrame({ frame: request, plan })
  const groupPictures: Array<{ groupId: string; picture: SpatialPictureLease }> = []
  try {
    const opened = plan.samples.length > 1 ? plan.samples.reduce((first, sample) => sample.sequenceFrame < first.sequenceFrame ? sample : first).frame : undefined
    // 作者场景先更新到快门开始那一刻记下各物体的世界矩阵（运动模糊的速度由它求），再更新到中心帧绘制。
    const previous = new Map<string, Map<import('three').Object3D, import('three').Matrix4>>()
    // 实体、线框不做运动模糊，不必多算一遍快门开始时刻的场景。
    if (opened && drawn.motionBlur === true && (options.display ?? 'realtime') === 'realtime') for (const staged of await sources.stageSpatialScenes(prepared, 'open')) {
      const matrices = new Map<import('three').Object3D, import('three').Matrix4>()
      staged.root.traverse(object => { matrices.set(object, object.matrixWorld.clone()) })
      previous.set(staged.clipId, matrices)
    }
    const scenes = await sources.stageSpatialScenes(prepared)
    current()
    // 作者物体的包围框扩展远近裁剪面（与空间计划同一规则），不被按卡片推算的远近面裁掉。
    const bounds = scenes.flatMap(scene => scene.worldBounds ? [scene.worldBounds] : [])
    const center = includeSpatialWorldBounds(plan.centerFrame, bounds)
    const placements = new Map<string, import('@/core/videoEdit/spatialTypes').SpatialMat4>()
    for (const material of plan.materials) {
      const clip = active.find(value => value.id === material.clipId)
      if (clip && material.kind !== 'worldScene') placements.set(material.clipId, materialToCard(material, clip))
    }
    const place = (card: import('@/core/videoEdit/spatialTypes').SpatialCardGeometry) => placements.has(card.clipId) ? { ...card, uvToWorld: math.spatialMultiply(card.uvToWorld, placements.get(card.clipId)!) } : card
    const open = opened ? { ...opened, cards: opened.cards.map(place) } : undefined
    // 透明度按原始片段求值：active 里的片段已经乘过一次淡化。
    const opacityOf = (clipId: string): number => {
      const source = request.composition.clips.find(clip => clip.id === clipId)
      return source ? evaluateVideoEditClip(source, request.sequenceFrame).opacity * videoEditFadeOpacity(source, request.sequenceFrame) : 1
    }
    const emissionOf = (clipId: string): number => {
      const source = request.composition.clips.find(clip => clip.id === clipId)
      return source ? evaluateVideoEditClip(source, request.sequenceFrame).spaceEmission ?? 0 : 0
    }
    // 片段整段上有没有发光（含关键帧）：组画面的编码约定与管线拓扑要整段一致，不随某一帧发光为 0 而变。
    const emits = (source: VideoEditClip): boolean => source.spatial?.enabled === true
      && ((source.spaceEmission ?? 0) > 0 || !!source.curves?.spaceEmission?.some(point => videoEditKeyframeValues(point).some(value => typeof value === 'number' && value > 0)))
    const emitting = new Set(request.composition.clips.filter(emits).map(clip => clip.id))
    const emitsLight = (clipId: string): boolean => emitting.has(clipId)
    const cocScale = threeSpaceCocScale(center.camera, request.output)
    const sceneCoc = bounds.flatMap(box => [0, 1, 2, 3, 4, 5, 6, 7].map(index => {
      const depth = -math.spatialTransform(center.camera.view, [index & 1 ? box.max[0] : box.min[0], index & 2 ? box.max[1] : box.min[1], index & 4 ? box.max[2] : box.min[2]])[2]
      return depth > 0 ? cocScale * Math.abs(depth - center.camera.focusDistance) / depth : 0
    }))
    const camera = request.composition.spatialCamera
    const postEffects = { display: options.display ?? 'realtime', motionBlur: drawn.motionBlur === true, depthOfField: Boolean(camera?.defocus || camera?.curves?.defocus?.length),
      focusDistance: center.camera.focusDistance, cocScale, cocMax: Math.max(0, ...center.cards.map(card => card.cocRangePx[1]), ...sceneCoc),
      shutterScale: plan.samples.length > 1 ? plan.samples.length / (plan.samples.length - 1) : 1,
      bloom: options.spaceRender?.bloom ?? 0, bloomThreshold: options.spaceRender?.bloomThreshold ?? .75, bloomRadius: options.spaceRender?.bloomRadius ?? .45, ambientOcclusion: options.spaceRender?.ambientOcclusion ?? 0, reflections: options.spaceRender?.reflections ?? 0,
      exposure: options.spaceRender?.exposure ?? 0, toneMapping: options.spaceRender?.toneMapping ?? 'neutral',
      environment: options.spaceRender?.environment ?? 'none', environmentIntensity: options.spaceRender?.environmentIntensity ?? 1, environmentRotation: options.spaceRender?.environmentRotation ?? 0,
      emission: emitting.size > 0 }
    /**
     * 组画面是否“带发光”（宿主据此选解码约定）：有作者场景、发光卡片，或实时显示开了泛光（辉光会溢到透明处）。
     * 按整组算一次：转场两端各画一次时编码约定必须相同，混合后才能按同一约定解码。
     */
    const groupLight = (group: (typeof plan.groups)[number]): boolean => scenes.some(scene => group.clipIds.includes(scene.clipId))
      // 卡片材料是否带发光跟着它的中心画面（材料面由这张画面画出），转场两端还没画时也能先定下来。
      || group.clipIds.some(clipId => (pictures.get(clipId) as { carriesLight?: boolean } | null | undefined)?.carriesLight === true || emitsLight(clipId)) || (postEffects.display === 'realtime' && postEffects.bloom > 0)
    // 一组画面：去掉 excluded 里的片段后整组在同一三维场景里画一次。
    const renderGroup = async (group: (typeof plan.groups)[number], excluded: ReadonlySet<string>, variant: string, groupCarriesLight?: boolean, below?: VideoEditCodePicture): Promise<SpatialPictureLease> => {
      const cards: import('./videoEditThreeSpace').ThreeSpaceCard[] = []
      for (const clipId of group.clipIds) {
        if (excluded.has(clipId)) continue
        const material = plan.materials.find(value => value.clipId === clipId)
        const geometry = center.cards.find(card => card.clipId === clipId)
        if (!material || material.kind === 'worldScene' || !geometry || !active.some(value => value.id === clipId)) continue
        const lease = await cardMaterial(material)
        cards.push({ clipId, texture: lease.texture, width: lease.width, height: lease.height, geometry: place(geometry), opacity: opacityOf(clipId), light: lease.carriesLight, emission: emissionOf(clipId) })
      }
      const groupScenes = scenes.filter(scene => group.clipIds.includes(scene.clipId) && !excluded.has(scene.clipId))
        .map(scene => ({ ...scene, opacity: opacityOf(scene.clipId), ...previous.has(scene.clipId) ? { previous: previous.get(scene.clipId)! } : {} }))
      const light = groupCarriesLight ?? (cards.some(card => card.light || emitsLight(card.clipId)) || groupScenes.length > 0 || (postEffects.display === 'realtime' && postEffects.bloom > 0))
      return capture(outputSpec(`three:group:${group.id}${variant}`), async target => {
        const { refining, progress } = await space.render({ frame: center, light, ...(open ? { shutterOpen: open } : {}), cards, scenes: groupScenes, effects: postEffects,
          ...(below ? { below: { texture: below.texture, width: below.width, height: below.height, light: below.carriesLight } } : {}),
          target: { texture: target.texture, width: target.width, height: target.height }, ...(options.trace ? { trace: { ...options.trace, group: `${group.id}${variant}` } } : {}), assertCurrent: () => { current() } })
        if (refining) options.onRefining?.(progress ?? 0)
        return { completion: spatial.completion() }
      }, light)
    }
    const transitionWindows = videoEditPictureTransitionsAt(request.composition, request.sequenceFrame)
    // 组里有透射材质（玻璃、亚克力）才要下方画面：作者物体的材质 transmission > 0。没有的组照旧先画好，零额外开销。
    const transmits = (group: (typeof plan.groups)[number]): boolean => (options.display ?? 'realtime') !== 'solid' && (options.display ?? 'realtime') !== 'wireframe' && scenes.some(scene => {
      if (!group.clipIds.includes(scene.clipId)) return false
      let found = false
      scene.root.traverse(object => {
        const material = (object as { material?: import('three').Material | import('three').Material[] }).material
        // three 把 transmission > 0、或设了透射 / 背景节点的节点材质都当透射处理；标准实心玻璃读的也是身后的画面。
        for (const value of Array.isArray(material) ? material : material ? [material] : []) {
          const fields = value as { transmission?: number; transmissionNode?: unknown; backdropNode?: unknown }
          if ((fields.transmission ?? 0) > 0 || fields.transmissionNode || fields.backdropNode || isSpaceGlassMaterial(value)) found = true
        }
      })
      return found
    })
    const deferred = new Map<string, (below: VideoEditCodePicture | undefined) => Promise<VideoEditCodePicture>>()
    const renderWhole = async (group: (typeof plan.groups)[number], below?: VideoEditCodePicture): Promise<SpatialPictureLease> => {
      const windows = group.itemIds.flatMap(id => id.startsWith('transition:') ? transitionWindows.filter(window => window.transition.id === id.slice('transition:'.length)) : [])
      if (!windows.length) return await renderGroup(group, new Set(), '', undefined, below)
      // 空间转场：整组画两次再用这个转场自己的混合或着色器合成，两端与组里其他三维内容的遮挡、景深关系照旧。
      // 双侧转场两次各去掉另一端的片段；单侧转场（入点淡入、出点淡出）一次不画这个片段、一次画，
      // 在两者之间过渡，只有这个片段出现或消失，组里其他内容不跟着淡。
      // 同一组里另有双侧转场时，它们取当前占优的一端（极少见）；另有单侧转场时那个片段照常画。
      const [window, ...others] = windows
      const twoSided = (value: typeof window): boolean => !value.side && !value.empty && value.left.id !== value.right.id
      const base = new Set(others.filter(twoSided).flatMap(other => {
        const render = videoEditTransitionRender(other, request.sequenceFrame), amount = render.kind === 'mix' ? render.amount : render.input.progress
        return [(amount < .5 ? other.right : other.left).id]
      }))
      const light = groupLight(group)
      const single = !twoSided(window)
      const incoming = window.side === 'in' || window.empty === 'left'
      let first: SpatialPictureLease | undefined, second: SpatialPictureLease | undefined
      try {
        // 出现或消失的是可见的那一端：左侧停用（empty 为 left）时是右侧片段。
        const withoutClip = new Set([...base, (window.empty === 'left' ? window.right : window.left).id])
        first = await renderGroup(group, single ? incoming ? withoutClip : base : new Set([...base, window.right.id]), ':a', light, below)
        second = await renderGroup(group, single ? incoming ? base : withoutClip : new Set([...base, window.left.id]), ':b', light, below)
        const transition = videoEditTransitionRender(window, request.sequenceFrame), key = `three:transition:${window.transition.id}`
        const a = compositor.spatialPicture(first), b = compositor.spatialPicture(second)
        // 两端都是整组画面，没有“空的一侧”：着色器转场去掉空端标记。
        // 单侧交叉溶解：两端是“有 / 没有这个片段”的整组画面，按进度从一端混到另一端。
        // 单侧黑场 / 白场沿用二维的节奏（入点从纯色开始、出点停在纯色），混合量与经过色照转场给的取。
        const crossfade = single && !videoEditTransitionDipColor(window.transition.kind)
        const mixed = transition.kind === 'mix'
          ? await runtime.mix(key, a, b, crossfade ? videoEditTransitionAmount(window, request.sequenceFrame) : transition.amount, crossfade ? undefined : transition.through)
          : await runtime.transition(key, { ...transition.input, emptyOutgoing: undefined, emptyIncoming: undefined }, a, b)
        const borrowed: SpatialPictureLease = { texture: mixed.texture, width: mixed.width, height: mixed.height, format: mixed.textureFormat,
          owner: 'composite-host', highPrecision: mixed.highPrecision, carriesLight: light, completion: Promise.resolve(),
          async release(afterUse) { await afterUse } }
        return await spatial.consume(borrowed, outputSpec(`three:group:${group.id}`))
      } finally {
        const settled = spatial.completion()
        await Promise.allSettled([first?.release(settled), second?.release(settled)])
      }
    }
    for (const group of plan.groups) {
      if (!transmits(group)) { groupPictures.push({ groupId: group.id, picture: await renderWhole(group) }); continue }
      deferred.set(group.itemIds[0], async below => {
        const picture = await renderWhole(group, below)
        groupPictures.push({ groupId: group.id, picture })
        return compositor.spatialPicture(picture)
      })
    }
    const replacements: VideoEditCompositeReplacements = {
      pictures: new Map(groupPictures.map(group => [plan.groups.find(value => value.id === group.groupId)!.itemIds[0], compositor.spatialPicture(group.picture)])),
      deferred, replaced: new Set(plan.groups.flatMap(group => group.itemIds)),
    }
    return await capture(outputSpec('spatial:frame'), target => renderVideoEditCompositeScene(drawn, nodes, pictures, effects, compositor, request.sequenceFrame, current, undefined,
      request.composition, target, options.onEffectError, request.quality, options.readFilterFrames, replacements), groupPictures.some(group => group.picture.carriesLight))
  } finally {
    const settled = spatial.completion()
    await Promise.allSettled([...groupPictures.map(group => group.picture.release(settled)), ...transient.map(lease => lease.release(settled))])
    for (const [clipId, held] of cache) if (!used.has(clipId)) { cache.delete(clipId); void held.lease.release(settled).catch(() => undefined); void held.defocused?.release(settled).catch(() => undefined) }
    try { await sources.releaseSpatialFrame(prepared) } finally { spatial.endFrame() }
  }
}
