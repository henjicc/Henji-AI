import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditCompositeNode } from '@/core/videoEdit/compositing'
import { activeVideoEditEffects } from '@/core/videoEdit/compositing'
import { videoEditTransitionRender } from '@/core/videoEdit/transitions'
import type { PreparedVideoEditEffect } from './videoEditCodeSources'
import type { VideoEditCodePicture, VideoEditCodeGpu } from './videoEditCodeGpu'
import type { VideoEditGpuCompositor, VideoEditPicture } from './videoEditGpuCompositor'
import { VIDEO_EDIT_PRECISE_FORMAT, videoEditPictureHighPrecision } from './videoEditGpuFrame'

interface Layer { clip: VideoEditClip; picture: VideoEditPicture }
const effective = (clip: VideoEditClip): boolean => activeVideoEditEffects(clip).length > 0
const slot = (clip: VideoEditClip, index: number): string => `composite:clip:${clip.id}:${index}`
const slots = (clip: VideoEditClip): string[] => Array.from({ length: effective(clip) ? clip.kind === 'adjustment' && clip.opacity < 1 ? 4 : 3 : 1 }, (_, index) => slot(clip, index))
/**
 * 智能区域（4.7d）共用的两张画面：上传的低分辨率蒙版、按片段位置画到序列尺寸的蒙版。每个带区域的效果依次使用，
 * 用完即提交，所以全场景只需要这两张。
 */
const MASK_SOURCE = 'composite:mask:source'; const MASK_DOCUMENT = 'composite:mask:document'
const masked = (clip: VideoEditClip): boolean => activeVideoEditEffects(clip).some(effect => effect.mask)
/** Reserve the entire frame together with generated pictures before releasing old targets. */
export function videoEditCompositeSurfaceKeys(nodes: readonly VideoEditCompositeNode[]): Set<string> {
  const keys = new Set<string>()
  const visit = (node: VideoEditCompositeNode): void => {
    if (node.kind === 'clip') { if (effective(node.clip)) slots(node.clip).forEach(key => keys.add(key)); if (masked(node.clip)) keys.add(MASK_SOURCE).add(MASK_DOCUMENT) }
    else if (node.kind === 'transition') {
      for (const clip of [node.window.left, node.window.right]) { slots(clip).forEach(key => keys.add(key)); if (masked(clip)) keys.add(MASK_SOURCE).add(MASK_DOCUMENT) }
      keys.add(`composite:transition:${node.window.transition.id}`)
    } else {
      node.children.forEach(visit)
      if (effective(node.clip) && node.clip.opacity > 0) slots(node.clip).forEach(key => keys.add(key))
    }
  }
  nodes.forEach(visit); return keys
}
/** Render-only full-canvas layer; original persisted geometry and clocks stay unchanged. */
function identity(clip: VideoEditClip): VideoEditClip { return { ...clip, x: 0, y: 0, scale: 1, rotation: 0, brightness: 1, opacity: 1 } }

/**
 * `document` carries the size the frame is drawn at; `logical` is the sequence's own size. They differ only at a reduced
 * playback resolution (task 4.9): code filters then still read the sequence size (a `1/width` offset stays the same
 * fraction of the picture) and built-in effects learn the scale for the few amounts that cannot shrink below a pixel.
 */
export async function renderVideoEditCompositeScene(document: VideoEditComposition, nodes: readonly VideoEditCompositeNode[], pictures: ReadonlyMap<string, VideoEditPicture>, effects: ReadonlyMap<string, readonly PreparedVideoEditEffect[]>, compositor: Pick<VideoEditGpuCompositor, 'code' | 'draw'>, frame: number, shouldPresent: () => boolean, deadline?: number, logical: Pick<VideoEditComposition, 'width' | 'height'> = document): Promise<{ presented: boolean; completion: Promise<void> }> {
  const renderScale = document.height / logical.height
  let runtime: VideoEditCodeGpu | undefined
  const submissions: Array<Promise<PromiseSettledResult<void>>> = []
  const watch = (completion: Promise<void>): void => { submissions.push(completion.then(value => ({ status: 'fulfilled', value } as const), reason => ({ status: 'rejected', reason } as const))) }
  const current = (): void => { if (!shouldPresent()) throw new DOMException('旧合成画面已取消。', 'AbortError') }
  const gpu = async (): Promise<VideoEditCodeGpu> => { current(); runtime ??= await compositor.code(); current(); return runtime }
  const normalize = async (clip: VideoEditClip, layers: readonly Layer[]): Promise<VideoEditCodePicture> => {
    // High-precision layers (10-bit and deeper material) are normalized into an rgba16float surface, so effects and
    // transitions built on them keep their precision (task 2.7).
    const format = layers.some(layer => videoEditPictureHighPrecision(layer.picture)) ? VIDEO_EDIT_PRECISE_FORMAT : 'rgba8unorm'
    const target = await (await gpu()).target(slot(clip, 0), document.width, document.height, format); current()
    const result = await compositor.draw(document, layers.map(layer => layer.clip), layers.map(layer => layer.picture), shouldPresent, undefined, target)
    watch(result.completion)
    current(); if (!result.presented) throw new DOMException('旧合成画面已取消。', 'AbortError')
    return target
  }
  const apply = async (clip: VideoEditClip, input: VideoEditCodePicture): Promise<VideoEditCodePicture> => {
    const runtime = await gpu(); const targets = slots(clip); const preserve = clip.kind === 'adjustment' && clip.opacity < 1
    let result = input; let key = targets[0]
    for (const plan of effects.get(clip.id) ?? []) {
      if (!plan.effect.enabled || plan.effect.amount <= 0) continue
      current()
      const free = targets.filter(target => target !== key && (!preserve || target !== targets[0]))
      const filtered = plan.builtin
        ? await runtime.builtin(free[0], plan.builtin, result, frame, renderScale)
        : await runtime.filter(free[0], plan.version, plan.program, { ...plan.context, width: logical.width, height: logical.height }, plan.parameters, result, plan.transitionHandles)
      current()
      if (plan.builtin && plan.mask) {
        // 区域蒙版按片段自己的位置、缩放、旋转画到序列尺寸，与片段画面逐像素对齐；只在区域内混入效果。
        const source = await runtime.uploadMask(MASK_SOURCE, plan.mask.width, plan.mask.height, plan.mask.data)
        const region = await runtime.target(MASK_DOCUMENT, document.width, document.height); current()
        const drawn = await compositor.draw(document, [{ ...clip, brightness: 1, opacity: 1 }], [source], shouldPresent, undefined, region)
        watch(drawn.completion); current(); if (!drawn.presented) throw new DOMException('旧合成画面已取消。', 'AbortError')
        result = await runtime.maskedMix(free[1], result, filtered, region, plan.effect.amount); key = free[1]; current()
      } else if (plan.effect.amount === 1) { result = filtered; key = free[0] }
      else { result = await runtime.mix(free[1], result, filtered, plan.effect.amount); key = free[1]; current() }
    }
    if (preserve && result !== input) {
      const target = targets.find(target => target !== key && target !== targets[0])!
      result = await runtime.mix(target, input, result, clip.opacity); current()
    }
    return result
  }
  const resolveClip = async (clip: VideoEditClip, force = false): Promise<Layer> => {
    if (!pictures.has(clip.id)) throw new Error(`合成片段“${clip.name}”尚未准备画面。`)
    const layer = { clip, picture: pictures.get(clip.id)! }
    if (!force && !effective(clip)) return layer
    const normalized = await normalize(clip, [layer])
    return { clip: identity(clip), picture: effective(clip) ? await apply(clip, normalized) : normalized }
  }
  const resolve = async (nodes: readonly VideoEditCompositeNode[]): Promise<Layer[]> => {
    const layers: Layer[] = []
    for (const node of nodes) {
      current()
      if (node.kind === 'clip') layers.push(await resolveClip(node.clip))
      else if (node.kind === 'transition') {
        // 单侧过渡（4.4）两边是同一个片段，只准备一次画面；怎么画由 videoEditTransitionRender 统一给出：
        // 交叉溶解、黑场、白场走混合，带参数的过渡（4.7）走内置效果着色器。预览与导出都经过这里。
        const left = await resolveClip(node.window.left, true); const right = node.window.side ? left : await resolveClip(node.window.right, true)
        const render = videoEditTransitionRender(node.window, frame); const key = `composite:transition:${node.window.transition.id}`
        const runtime = await gpu()
        const picture = render.kind === 'mix'
          ? await runtime.mix(key, left.picture as VideoEditCodePicture, right.picture as VideoEditCodePicture, render.amount, render.through)
          : await runtime.transition(key, render.input, left.picture as VideoEditCodePicture, right.picture as VideoEditCodePicture)
        current()
        layers.push({ clip: identity(node.window.left), picture })
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
  const result = await compositor.draw(document, layers.map(layer => layer.clip), layers.map(layer => layer.picture), shouldPresent, deadline)
  watch(result.completion)
  return { presented: result.presented, completion: Promise.all(submissions).then(results => { const failed = results.find(value => value.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason }) }
}
