import type { VideoEditClip, VideoEditSequence } from './document'
import { buildVideoEditCompositePlan, type VideoEditCompositeNode } from './compositing'
import { videoEditPictureTransitionsAt } from './clipGeometry'
import { videoEditTransitionPictureClips } from './transitions'
import { videoEditCodeClipReferenceIds } from './codeClipReferences'
import type { SpatialCardGeometry, SpatialFact } from './spatialTypes'
import { spaceClipIsSolid } from './spatialSchema'
import { videoEditPictureFilter } from './clipGeometry'

/**
 * 三维分组，与渲染时的曝光计划一致：同一合成层级里连续的空间片段（含空间转场）成一组，调整层与非空间片段隔断。
 * order 是组的合成先后（越大越靠上，后合成的组整幅盖在先合成的组上）。
 */
function spatialGroups(document: Pick<VideoEditSequence, 'tracks' | 'clips' | 'transitions'>, sequenceFrame: number, clips: readonly VideoEditClip[],
  enabled: (clip: VideoEditClip) => boolean): Map<string, { id: string; order: number }> {
  const group = new Map<string, { id: string; order: number }>()
  let order = 0
  const visit = (nodes: readonly VideoEditCompositeNode[], parent: string): void => {
    let run: { id: string; order: number } | undefined
    for (const node of nodes) {
      if (node.kind === 'adjustment') { run = undefined; visit(node.children, `${parent}/${node.clip.id}`); continue }
      const sources = node.kind === 'clip' ? [node.clip] : videoEditTransitionPictureClips(node.window)
      if (!sources.every(enabled)) { run = undefined; continue }
      run ??= { id: `${parent}/${sources[0].id}`, order: order++ }
      for (const clip of sources) group.set(clip.id, run)
    }
  }
  visit(buildVideoEditCompositePlan(clips, videoEditPictureTransitionsAt(document, sequenceFrame)), '')
  return group
}

/**
 * 只看片段字段就能判断的事实（不执行作者源码）：
 * - cross-group：作者场景引用的片段与它不在同一个三维组里。三维按层序成组，调整层与二维片段会把三维分成前后两层，
 *   这时引用方拿得到位置与形状，但两者之间的遮挡、折射与受光没有定义（各组分别画完再按层序合成）。
 * - element-cycle：代码片段互相引用成环。环上每个片段只渲染它自己的子合成，环上的引用这一帧拿到空画面。
 * - reference-inactive：引用的片段这一帧不在画面里（不在它的时间范围内、停用或所在轨道隐藏），作者拿到空画面。
 * - cross-group-order：两张卡片在画面上重叠，三维里靠前的那张却在层序更低的组里：两组分别画完按层序叠，它会被盖住。
 * - unlit：受光的片段所在序列没有灯光片段与环境光，缺省布光也关了；除非作者场景自己布光，受光内容是黑的。
 * `clips` 是这一帧在画面里的片段（已求值）。
 */
export function spatialElementFacts(document: Pick<VideoEditSequence, 'tracks' | 'clips' | 'transitions' | 'spaceRender'>, sequenceFrame: number, clips: readonly VideoEditClip[],
  enabled: (clip: VideoEditClip) => boolean, cards: readonly SpatialCardGeometry[] = []): SpatialFact[] {
  const facts: SpatialFact[] = []
  const group = spatialGroups(document, sequenceFrame, clips, enabled)
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], b = cards[j], ga = group.get(a.clipId), gb = group.get(b.clipId), x = a.screenBounds, y = b.screenBounds
    if (!ga || !gb || ga.id === gb.id || !a.visiblePolygon.length || !b.visiblePolygon.length) continue
    if (x.x >= y.x + y.width || y.x >= x.x + x.width || x.y >= y.y + y.height || y.y >= x.y + x.height) continue
    const [upper, lower] = ga.order > gb.order ? [a, b] : [b, a]
    // 上面那组整张在下面那组身后（视深更远）：三维里本该被挡住，合成后却盖在前面。
    if (upper.viewDepthRange[0] <= lower.viewDepthRange[1]) continue
    facts.push({ code: 'cross-group-order', clipIds: [lower.clipId, upper.clipId], sequenceFrame,
      message: '两张卡片在画面上重叠，三维里靠前的那张在层序更低的三维组：两组之间隔着调整层或二维片段，按层序合成后它被身后那张盖住。去掉隔断，或调整轨道顺序。', values: {} })
  }
  const solids = clips.filter(clip => clip.kind !== 'light' && enabled(clip) && spaceClipIsSolid(clip) && (clip.spaceLit === true || (clip.spaceMaterial?.preset ?? 'picture') !== 'picture'))
  const visible = videoEditPictureFilter(document)
  // 缺省布光按整条序列判断：序列里有灯（哪怕这一帧还没亮）就不套缺省布光，所以这一帧没有灯时同样是黑的。
  const sequenceLit = document.clips.some(clip => clip.kind === 'light' && clip.enabled !== false && visible.has(clip))
  const lightNow = clips.some(clip => clip.kind === 'light' && clip.enabled !== false)
  if (solids.length && !lightNow && (document.spaceRender?.environment ?? 'none') === 'none' && (sequenceLit || document.spaceRender?.defaultLighting === 'off')) {
      facts.push({ code: 'unlit', clipIds: solids.map(clip => clip.id), sequenceFrame, message: sequenceLit ? '这一帧没有亮着的灯光片段与环境光（序列里有灯，所以不套缺省布光）：除非作者场景自己布光，受光内容是黑的。' : '受光的片段所在序列没有灯光片段与环境光，缺省布光也关了：除非作者场景自己布光，受光内容是黑的。加一盏灯、设环境光或打开缺省布光。', values: {} })
  }
  const referrers = clips.filter(clip => videoEditCodeClipReferenceIds(clip).length)
  if (!referrers.length) return facts
  for (const clip of referrers) for (const target of new Set(videoEditCodeClipReferenceIds(clip))) {
    // 与取图同一判断（codeClipReferencePresent）：帧落在被引用片段自身的时间范围、片段启用、所在轨道可见；转场手柄延伸出去的部分取不到图。
    const source = document.clips.find(value => value.id === target)
    if (target !== clip.id && source && source.enabled !== false && sequenceFrame >= source.start && sequenceFrame < source.start + source.duration && visible.has(source)) continue
    facts.push({ code: 'reference-inactive', clipIds: [clip.id, target], sequenceFrame,
      message: target === clip.id ? '代码片段引用了自己：取不到自己的画面，作者拿到空画面。' : document.clips.some(value => value.id === target) ? '引用的片段这一帧不在画面里（不在它的时间范围内、停用或所在轨道隐藏），作者拿到空画面。' : '引用的片段已不在这条序列里，作者拿到空画面。',
      values: { exists: document.clips.some(value => value.id === target) } })
  }
  for (const clip of referrers) {
    const own = group.get(clip.id)?.id
    if (!own) continue
    for (const target of new Set(videoEditCodeClipReferenceIds(clip))) {
      if (target === clip.id || !clips.some(value => value.id === target) || group.get(target)?.id === own) continue
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
