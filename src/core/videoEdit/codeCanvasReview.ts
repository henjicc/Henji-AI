import type { AuthorElementObservation } from './codeAuthorProgram'
import type { VideoEditMotionStructureFact } from './motionStructure'
import { codePoint } from './codeMaterial/geometry'
import { videoEditQuadOutside } from './textOverflowReview'

export interface VideoEditCanvasEvidence { text?: string; inkQuad?: [number, number][]; boxQuad?: [number, number][]; visibility?: { before: number; minimum: number; after: number } }
export interface VideoEditCanvasIssue { kind: 'text_box_overflow' | 'shadow_outside_source'; key: string; localQuad: [number, number][]; canvas: VideoEditCanvasEvidence }
const box = ([x, y, right, bottom]: number[]): [number, number][] => [[x, y], [right, y], [right, bottom], [x, bottom]]
const area = (quad: [number, number][]): number => Math.abs(quad.reduce((sum, p, i) => { const q = quad[(i + 1) % quad.length]; return sum + p[0] * q[1] - p[1] * q[0] }, 0)) / 2
/** 中心须在框内且高度足以容纳正文；宽度不足正是撑框风险，不能据此排除。 */
function containsInk(ink: [number, number][], container: [number, number][]): boolean {
  const center: [number, number] = [ink.reduce((sum, p) => sum + p[0], 0) / ink.length, ink.reduce((sum, p) => sum + p[1], 0) / ink.length]
  if (videoEditQuadOutside([center], container)) return false
  const dx = container[2][0] - container[1][0], dy = container[2][1] - container[1][1], height = Math.hypot(dx, dy)
  if (height === 0) return false
  const projected = ink.map(([x, y]) => (x * dx + y * dy) / height)
  return height >= (Math.max(...projected) - Math.min(...projected)) * .5
}

export function videoEditCanvasBoxes(siblings: Iterable<AuthorElementObservation>): [number, number][][] {
  return [...siblings].flatMap(owner => (owner.canvasReview ?? []).filter(fact => fact.kind === 'box' && fact.retained !== false && fact.opacity * (owner.opacity ?? 1) >= .01).map(fact => fact.quad.map(([x, y]) => codePoint(owner.matrix, x, y)))).filter(quad => area(quad) > 0)
}

/** 框是作者实际画过的矩形或明确的图层 bounds；从不根据数字、片名或图层名猜用途。 */
export function videoEditCanvasIssues(element: AuthorElementObservation, boxes = videoEditCanvasBoxes([element])): VideoEditCanvasIssue[] {
  const facts = element.canvasReview ?? [], issues: VideoEditCanvasIssue[] = []
  const transform = (quad: [number, number][], owner: AuthorElementObservation): [number, number][] => quad.map(([x, y]) => codePoint(owner.matrix, x, y))
  for (const fact of facts) {
    if (fact.opacity < .01) continue
    if (fact.kind === 'shadow_outside_source') issues.push({ kind: fact.kind, key: 'shadow', localQuad: fact.quad, canvas: { inkQuad: transform(fact.quad, element) } })
    if (fact.kind !== 'text' || fact.retained === false || !fact.quad.length) continue
    const ink = transform(fact.quad, element)
    const candidates = boxes.filter(quad => containsInk(ink, quad)).sort((a, b) => area(a) - area(b))
    const container = candidates[0] ?? (element.bounds ? transform(box(element.bounds), element) : [])
    if (area(container) > 0 && videoEditQuadOutside(ink, container)) issues.push({ kind: 'text_box_overflow', key: `text:${fact.text}`, localQuad: fact.quad, canvas: { text: fact.text, inkQuad: ink, boxQuad: container } })
  }
  return issues
}

/** 合并相邻问题，文字要求持续0.3秒；阴影风险即使只出现一帧也需报出。 */
export function videoEditCanvasIssueFacts(samples: Array<{ frame: number; issues: VideoEditCanvasIssue[] }>, fps: number, base: Pick<VideoEditMotionStructureFact, 'sequenceId' | 'path' | 'subjectId' | 'elementPath' | 'label'>): VideoEditMotionStructureFact[] {
  const records: VideoEditMotionStructureFact[] = []
  let active: Array<{ issue: VideoEditCanvasIssue; record: VideoEditMotionStructureFact }> = []
  for (const sample of samples) {
    const next: typeof active = []
    for (const issue of sample.issues) {
      let index = -1, distance = Infinity
      for (const [i, previous] of active.entries()) {
        const quad = previous.issue.localQuad, next = issue.localQuad
        // 绘制 CTM 和 pose 都可能移动正文；用形状而非绝对位置认同一条，再就近配对同文多处绘制。
        if (previous.record.timeline.to !== sample.frame || previous.issue.key !== issue.key || !quad.every((point, i) => Math.hypot(point[0] - quad[0][0] - next[i][0] + next[0][0], point[1] - quad[0][1] - next[i][1] + next[0][1]) <= 4)) continue
        const delta = Math.hypot(quad[0][0] - next[0][0], quad[0][1] - next[0][1])
        if (delta < distance) { index = i; distance = delta }
      }
      let record = index < 0 ? undefined : active.splice(index, 1)[0].record
      if (record) record.timeline.to++
      else { record = { ...base, kind: issue.kind, basis: 'code_structure', timeline: { from: sample.frame, to: sample.frame + 1 }, canvas: issue.canvas }; records.push(record) }
      next.push({ issue, record })
    }
    active = next
  }
  return records.filter(record => record.kind === 'shadow_outside_source' || record.timeline.to - record.timeline.from >= Math.max(3, Math.ceil(.3 * fps))).map(record => ({ ...record,
    detail: `作者图层在序列帧 ${record.timeline.from}–${record.timeline.to}：${record.kind === 'text_box_overflow' ? '文字墨迹超出绘制框或图层范围；增宽卡片、缩小字号或换行。原文见 canvas.text，框关联是几何候选，请取帧核对。' : '源图形完全画在图层栅格外，再用 shadowOffset 投回的写法不受支持，投影可能整体缺失；在层内绘制后使用 blur，或扩大 bounds 包住原图形和投影，再取帧比较。'}`,
  }))
}

/** 场景可以复用同一图层 ID；只将一秒内恢复的中途短空窗作为连续性候选。 */
export function videoEditVisibilityDips(samples: Array<{ frame: number; visibility: number }>, fps: number, base: Pick<VideoEditMotionStructureFact, 'sequenceId' | 'path' | 'subjectId' | 'elementPath' | 'label'>): VideoEditMotionStructureFact[] {
  const records: VideoEditMotionStructureFact[] = []
  let before: number | undefined, start = -1, minimum = 1
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    if (i && sample.frame !== samples[i - 1].frame + 1) { before = undefined; start = -1 }
    if (sample.visibility >= .5) {
      if (start >= 0 && sample.frame - start <= fps && before !== undefined) records.push({ ...base, kind: 'visibility_dip', basis: 'code_structure', timeline: { from: start, to: sample.frame }, canvas: { visibility: { before, minimum, after: sample.visibility } },
        detail: `作者图层在序列帧 ${start}–${sample.frame} 的范围可见度或透明度中途下降后恢复；检查 hidden/opacity、位置轨覆盖和换目标过渡，使高亮持续可见。有意闪烁可保留；此检查不包含像素遮挡或 draw 内部清屏。` })
      before = sample.visibility; start = -1; minimum = 1
    } else if (before !== undefined && sample.visibility < before * .5) { if (start < 0) start = sample.frame; minimum = Math.min(minimum, sample.visibility) }
  }
  return records
}
