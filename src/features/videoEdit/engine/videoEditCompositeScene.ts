import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditCompositeNode } from '@/core/videoEdit/compositing'
import { activeVideoEditEffects } from '@/core/videoEdit/compositing'
import { videoEditTransitionAmount } from '@/core/videoEdit/transitions'
import type { PreparedVideoEditEffect } from './videoEditCodeSources'
import type { VideoEditCodePicture, VideoEditCodeGpu } from './videoEditCodeGpu'
import type { VideoEditGpuCompositor, VideoEditPicture } from './videoEditGpuCompositor'
import { VIDEO_EDIT_PRECISE_FORMAT, videoEditPictureHighPrecision } from './videoEditGpuFrame'

interface Layer { clip: VideoEditClip; picture: VideoEditPicture }
const effective = (clip: VideoEditClip): boolean => activeVideoEditEffects(clip).length > 0
const slot = (clip: VideoEditClip, index: number): string => `composite:clip:${clip.id}:${index}`
const slots = (clip: VideoEditClip): string[] => Array.from({ length: effective(clip) ? clip.kind === 'adjustment' && clip.opacity < 1 ? 4 : 3 : 1 }, (_, index) => slot(clip, index))
/** Reserve the entire frame together with generated pictures before releasing old targets. */
export function videoEditCompositeSurfaceKeys(nodes: readonly VideoEditCompositeNode[]): Set<string> {
  const keys = new Set<string>()
  const visit = (node: VideoEditCompositeNode): void => {
    if (node.kind === 'clip') { if (effective(node.clip)) slots(node.clip).forEach(key => keys.add(key)) }
    else if (node.kind === 'transition') {
      for (const clip of [node.window.left, node.window.right]) slots(clip).forEach(key => keys.add(key))
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

export async function renderVideoEditCompositeScene(document: VideoEditComposition, nodes: readonly VideoEditCompositeNode[], pictures: ReadonlyMap<string, VideoEditPicture>, effects: ReadonlyMap<string, readonly PreparedVideoEditEffect[]>, compositor: Pick<VideoEditGpuCompositor, 'code' | 'draw'>, frame: number, shouldPresent: () => boolean, deadline?: number): Promise<{ presented: boolean; completion: Promise<void> }> {
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
      const filtered = await runtime.filter(free[0], plan.version, plan.program, { ...plan.context, width: document.width, height: document.height }, plan.parameters, result, plan.transitionHandles); current()
      if (plan.effect.amount === 1) { result = filtered; key = free[0] }
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
        const left = await resolveClip(node.window.left, true); const right = await resolveClip(node.window.right, true)
        const picture = await (await gpu()).mix(`composite:transition:${node.window.transition.id}`, left.picture as VideoEditCodePicture, right.picture as VideoEditCodePicture, videoEditTransitionAmount(node.window, frame)); current()
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
