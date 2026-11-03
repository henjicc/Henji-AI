import type { VideoEditClip, VideoEditSequence } from './document'
import { buildVideoEditCompositePlan, type VideoEditCompositeNode } from './compositing'
import { videoEditPictureTransitionsAt } from './clipGeometry'
import { videoEditTransitionPictureClips } from './transitions'
import { videoEditCodeClipReferenceIds } from './codeClipReferences'
import type { SpatialFact } from './spatialTypes'

/**
 * 只看片段字段就能判断的引用事实（不执行作者源码）：
 * - cross-group：作者场景引用的片段与它不在同一个三维组里。三维按层序成组，调整层与二维片段会把三维分成前后两层，
 *   这时引用方拿得到位置与形状，但两者之间的遮挡、折射与受光没有定义（各组分别画完再按层序合成）。
 * - element-cycle：代码片段互相引用成环。环上每个片段只渲染它自己的子合成，环上的引用这一帧拿到空画面。
 * 分组规则与渲染时的曝光计划一致：同一合成层级里连续的空间片段（含空间转场）成一组，调整层与非空间片段隔断。
 */
export function spatialElementFacts(document: Pick<VideoEditSequence, 'tracks' | 'clips' | 'transitions'>, sequenceFrame: number, clips: readonly VideoEditClip[],
  enabled: (clip: VideoEditClip) => boolean): SpatialFact[] {
  const referrers = clips.filter(clip => videoEditCodeClipReferenceIds(clip).length)
  if (!referrers.length) return []
  const facts: SpatialFact[] = []
  const group = new Map<string, string>()
  const visit = (nodes: readonly VideoEditCompositeNode[], parent: string): void => {
    let run: string | undefined
    for (const node of nodes) {
      if (node.kind === 'adjustment') { run = undefined; visit(node.children, `${parent}/${node.clip.id}`); continue }
      const sources = node.kind === 'clip' ? [node.clip] : videoEditTransitionPictureClips(node.window)
      if (!sources.every(enabled)) { run = undefined; continue }
      run ??= `${parent}/${sources[0].id}`
      for (const clip of sources) group.set(clip.id, run)
    }
  }
  visit(buildVideoEditCompositePlan(clips, videoEditPictureTransitionsAt(document, sequenceFrame)), '')
  for (const clip of referrers) {
    const own = group.get(clip.id)
    if (!own) continue
    for (const target of new Set(videoEditCodeClipReferenceIds(clip))) {
      if (target === clip.id || !clips.some(value => value.id === target) || group.get(target) === own) continue
      facts.push({ code: 'cross-group', clipIds: [clip.id, target], sequenceFrame,
        message: '引用的片段与作者场景不在同一个三维组：两者之间隔着调整层或二维片段，遮挡、折射与受光按前后两层处理。', values: {} })
    }
  }
  // 成环：从每个代码片段沿引用走，回到自己就是环（只报一次，按环上最小的 ID 去重）。
  const edges = new Map(referrers.map(clip => [clip.id, [...new Set(videoEditCodeClipReferenceIds(clip))].filter(id => id !== clip.id)]))
  const reported = new Set<string>()
  for (const start of edges.keys()) {
    const path: string[] = []
    const walk = (id: string): string[] | undefined => {
      if (id === start && path.length) return [...path]
      if (path.includes(id) || !edges.has(id)) return undefined
      path.push(id)
      for (const next of edges.get(id)!) { const found = walk(next); if (found) return found }
      path.pop()
      return undefined
    }
    const cycle = walk(start)
    if (!cycle) continue
    const key = [...cycle].sort().join(',')
    if (reported.has(key)) continue
    reported.add(key)
    facts.push({ code: 'element-cycle', clipIds: cycle, sequenceFrame, message: '代码片段互相引用成环：环上的引用这一帧拿到空画面，请去掉其中一条引用。', values: {} })
  }
  return facts
}
