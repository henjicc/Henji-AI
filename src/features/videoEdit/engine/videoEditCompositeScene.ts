import { videoEditEffectNeedsFloat } from './videoEditRenderPrecision'
import type { VideoEditMotionSampledClip } from '@/core/videoEdit/motionBlur'
import type { EffectQuality } from '@/core/imaging/effects/descriptor'
import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditCompositeNode } from '@/core/videoEdit/compositing'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'
import { activeVideoEditEffects } from '@/core/videoEdit/compositing'
import { videoEditEffectUsesSubject } from '@/core/videoEdit/builtinEffects'
import type { VideoEditSmartRegionMask } from './videoEditSmartRegionMasks'
import { videoEditTransitionPictureClips, videoEditTransitionRender } from '@/core/videoEdit/transitions'
import type { PreparedVideoEditEffect } from './videoEditCodeSources'
import type { VideoEditCodeGpu } from './videoEditCodeGpu'
import { VideoEditCodePicture } from './videoEditCodePicture'
import type { VideoEditGpuCompositor, VideoEditPicture, VideoEditMaterialViewport } from './videoEditGpuCompositor'
import { planVideoEditBuiltinEffect } from './videoEditBuiltinEffectPasses'
import { isShaderGraphEffect } from '@/core/videoEdit/shaderGraph/effects'
import { VIDEO_EDIT_PRECISE_FORMAT, videoEditPictureHighPrecision } from './videoEditGpuFrame'
import type { VideoEditTrackedClip } from './videoEditTrackResults'
import type { AuthorGpuInputs } from './videoEditAuthorModule'
import type { PreparedVideoEditCodeEffect } from './videoEditCodeSources'
import type { SpatialCodeSources, SpatialExposurePlan, SpatialFrameRequest, SpatialMaterialPlan, SpatialPictureLease, SpatialTargetSpec } from './videoEditSpatialContracts'
import { videoEditClipPictureSize, videoEditPictureTransitionsAt } from '@/core/videoEdit/clipGeometry'
import type { BuiltinEncodingBatch } from './videoEditBuiltinEffectsGpu'

export type VideoEditFilterFrameReader = (clip: VideoEditClip, plan: PreparedVideoEditCodeEffect, input: VideoEditCodePicture) => Promise<AuthorGpuInputs['frames']>

interface Layer { clip: VideoEditClip; picture: VideoEditPicture }
export interface VideoEditCompositeReplacements {
  pictures: ReadonlyMap<string, VideoEditCodePicture>
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
      const bounds = materialViewport!.bounds
      const operation = planVideoEditBuiltinEffect(builtin, { width: input.width, height: input.height, frame: frame - clip.start, renderScale, quality, frameDuration: 1 / document.fps, referenceSize: logical,
        layer: { referenceSize: logical, contentBounds: { x: 0, y: 0, width: logical.width, height: logical.height }, rasterScale: renderScale, rasterOrigin: [-bounds.x * renderScale, -bounds.y * renderScale], quality } })
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
  const resolve = async (nodes: readonly VideoEditCompositeNode[]): Promise<Layer[]> => {
    const layers: Layer[] = []
    for (const node of nodes) {
      current()
      const id = node.kind === 'transition' ? `transition:${node.window.transition.id}` : node.clip.id
      const replacement = replacements?.pictures.get(id)
      if (replacement) { layers.push({ clip: identity(node.kind === 'transition' ? node.window.left : node.clip), picture: replacement }); continue }
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
        const children = await resolve(node.children)
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
export async function renderVideoEditSpatialCompositeScene(options: {
  request: SpatialFrameRequest; plan: SpatialExposurePlan; sources: SpatialCodeSources
  drawn: VideoEditComposition; active: readonly VideoEditClip[]; nodes: readonly VideoEditCompositeNode[]
  pictures: ReadonlyMap<string, VideoEditPicture>; effects: ReadonlyMap<string, readonly PreparedVideoEditEffect[]>
  compositor: VideoEditGpuCompositor; readFilterFrames?: VideoEditFilterFrameReader
  onEffectError?: (effect: VideoEditEffect, error: unknown) => void
  compositionAt?: import('./videoEditSpatialExposurePlan').SpatialCompositionAt
}): Promise<SpatialPictureLease> {
  const { request, plan, sources, drawn, active, nodes, pictures, effects, compositor } = options
  const [{ renderSpatialExposure }, { createVideoEditSpatialHost }] = await Promise.all([import('./videoEditSpatialExposure'), import('./videoEditSpatialComposite')])
  const spatial = await compositor.spatial(), runtime = await compositor.code()
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
  const materialPicture = async (material: SpatialMaterialPlan, input: VideoEditPicture): Promise<SpatialPictureLease> => {
    current()
    const original = active.find(clip => clip.id === material.clipId)
    if (!original) throw new Error(`空间卡片 ${material.clipId} 缺少中心片段。`)
    // 世界场景已由共享相机投影；卡片仍须在参考平面应用二维放置和片段效果。
    const clip = { ...(material.kind === 'worldScene' ? identity(original) : original), opacity: 1 } as VideoEditClip & VideoEditMotionSampledClip
    delete clip.motionSamples
    const local = { ...drawn, width: material.target.width, height: material.target.height }
    const node: VideoEditCompositeNode = { kind: 'clip', clip, fromTrack: clip.track, toTrack: clip.track + 1 }
    const carriesLight = input instanceof Object && 'carriesLight' in input && input.carriesLight === true
    return capture(material.target, target => renderVideoEditCompositeScene(local, [node], new Map([[clip.id, input]]), effects, compositor, request.sequenceFrame, current, undefined,
      material.referenceSize, target, options.onEffectError, request.quality, options.readFilterFrames, undefined,
      { referenceSize: material.referenceSize, bounds: material.logicalBounds,
        // 纹素密度是一倍栅格乘二次幂档位，取整只让它略大于档位。
        rasterTier: 2 ** Math.max(0, Math.round(Math.log2(material.rasterScale[1] / (request.output.height / request.output.displayHeight)))) }), carriesLight)
  }
  const materialSources: SpatialCodeSources = {
    describeSpatialSources: (...args) => sources.describeSpatialSources(...args),
    prepareSpatialFrame: (...args) => sources.prepareSpatialFrame(...args),
    inspectSpatialSceneSamples: (...args) => sources.inspectSpatialSceneSamples(...args),
    generatorTargetCapacity: (...args) => sources.generatorTargetCapacity(...args),
    releaseSpatialFrame: (...args) => sources.releaseSpatialFrame(...args),
    async renderSpatialSample(sample) {
      const material = sample.materialPlan
      const original = active.find(clip => clip.id === material.clipId)!
      const size = videoEditClipPictureSize(request.composition, original)
      const target = material.kind === 'worldScene' ? sample.target : { ...sample.target,
        width: Math.max(1, Math.ceil(size.width * material.rasterScale[0])),
        height: Math.max(1, Math.ceil(size.height * material.rasterScale[1])) }
      const raw = await sources.renderSpatialSample({ ...sample, target })
      let completion = raw.completion
      try {
        const input = compositor.spatialPicture(raw)
        const source = material.kind === 'worldScene' ? input : new VideoEditCodePicture(input.texture, input.width, input.height, input.owner, input.textureFormat, false, size)
        source.carriesLight = input.carriesLight
        const picture = await materialPicture(material, source)
        completion = picture.completion
        return picture
      } finally { await raw.release(completion) }
    },
  }
  const host = createVideoEditSpatialHost(request, spatial, {
    generatorTargetCapacity: (width, height, format) => sources.generatorTargetCapacity(width, height, format),
    async reserveWorkingSet(workingSet, signal) { current(); spatial.reserveWorkingSet(workingSet, signal) },
    async releaseWorkingSet() { spatial.releaseWorkingSet() },
    async prepareCardMaterial(_request, material) {
      if (!pictures.has(material.clipId)) throw new Error(`空间卡片 ${material.clipId} 缺少中心画面。`)
      return materialPicture(material, pictures.get(material.clipId)!)
    },
    async compositeTransition(items, sample) {
      const id = items[0].itemId.slice('transition:'.length)
      const window = videoEditPictureTransitionsAt(request.composition, sample.sequenceFrame).find(window => window.transition.id === id)
      if (!window) throw new Error('空间转场采样越过了转场窗口。')
      const endpoints: SpatialPictureLease[] = []
      let completion = Promise.resolve()
      try {
        for (const item of items) {
          const target = spatial.target(outputSpec(`spatial:transition:${id}:${item.clipId}`), true)
          try { target.completion = (await spatial.draw(target, [item])).completion; endpoints.push(spatial.picture(target, item.picture.carriesLight)) }
          finally { await spatial.releaseTarget(target) }
        }
        const shown = window.empty === 'left' ? window.right : window.left
        const first = compositor.spatialPicture(endpoints[items.findIndex(item => item.clipId === shown.id)])
        const second = window.side || window.empty ? first : compositor.spatialPicture(endpoints[items.findIndex(item => item.clipId === window.right.id)])
        const transition = videoEditTransitionRender(window, sample.sequenceFrame), key = `composite:transition:${id}`
        const picture = transition.kind === 'mix'
          ? await runtime.mix(key, window.empty === 'left' ? 'transparent' : first, window.empty === 'right' ? 'transparent' : second, transition.amount, transition.through)
          : await runtime.transition(key, transition.input, first, second)
        const borrowed: SpatialPictureLease = { texture: picture.texture, width: picture.width, height: picture.height, format: picture.textureFormat,
          owner: 'composite-host', highPrecision: picture.highPrecision, carriesLight: endpoints.some(endpoint => endpoint.carriesLight), completion: Promise.resolve(),
          async release(afterUse) { await afterUse } }
        const consumed = await spatial.consume(borrowed, outputSpec(`spatial:transition:${id}:owned`))
        completion = consumed.completion
        return consumed
      } finally { await Promise.all(endpoints.map(endpoint => endpoint.release(completion))) }
    },
    async compositeFrame(_request, groups) {
      const replacements: VideoEditCompositeReplacements = {
        pictures: new Map(groups.map(group => {
          const planned = plan.groups.find(value => value.id === group.groupId)!
          return [planned.itemIds[0], compositor.spatialPicture(group.picture)]
        })),
        replaced: new Set(plan.groups.flatMap(group => group.itemIds)),
      }
      return capture(outputSpec('spatial:frame'), target => renderVideoEditCompositeScene(drawn, nodes, pictures, effects, compositor, request.sequenceFrame, current, undefined,
        request.composition, target, options.onEffectError, request.quality, options.readFilterFrames, replacements), groups.some(group => group.picture.carriesLight))
    },
  })
  return renderSpatialExposure(request, plan, materialSources, host, options.compositionAt)
}
