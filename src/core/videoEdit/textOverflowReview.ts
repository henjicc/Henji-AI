import type { TextDrawObservation } from './textDrawObservation'
import type { VideoEditMotionStructureFact } from './motionStructure'

type Point = [number, number]
export interface VideoEditTextOverflowEvidence {
  drawIndex: number
  constraint: TextDrawObservation['constraint']
  contentSize: TextDrawObservation['contentSize']
  visibleContentSize: TextDrawObservation['visibleContentSize']
  inkBounds: TextDrawObservation['inkBounds']
  appearanceBounds: TextDrawObservation['appearanceBounds']
  boundsKind: TextDrawObservation['boundsKind']
  actualLines: number
  totalLines: number
  omittedRanges: TextDrawObservation['omittedRanges']
  fitFailed: boolean
  truncated: boolean
  visibleOverflow: boolean
  matrix: TextDrawObservation['matrix']
  inkQuad: Point[]
  effectiveClips: Point[][]
  clippedBy: Array<'frame' | 'clip'>
  stability: { basis: 'stable_layout' | 'persistent_clip'; fromFrame: number; toFrame: number; minimumFrames: number }
}
export interface VideoEditTextDrawSample {
  frame: number
  drawIndex: number
  draw: TextDrawObservation
  /** 墨迹与每重裁切均已投影到查询序列的输出像素。 */
  inkQuad: Point[]
  effectiveClips: Point[][]
  frameClips: Point[][]
  opacity: number
}
type Base = Pick<VideoEditMotionStructureFact, 'sequenceId' | 'path' | 'subjectId' | 'elementPath' | 'label'>

/** 只对凸裁切证明包含关系；未知路径不能用外接矩形冒充有效 clip。 */
function outside(points: Point[], polygon: Point[]): boolean {
  if (!points.length) return false
  const area = polygon.reduce((sum, [x, y], i) => { const next = polygon[(i + 1) % polygon.length]; return sum + x * next[1] - y * next[0] }, 0)
  if (Math.abs(area) < 1e-8) return true
  const sign = Math.sign(area)
  return points.some(([x, y]) => polygon.some(([ax, ay], i) => {
    const [bx, by] = polygon[(i + 1) % polygon.length]
    return sign * ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) < -.5 * Math.hypot(bx - ax, by - ay)
  }))
}
function overflow(draw: TextDrawObservation, visible: boolean): boolean {
  const size = visible ? draw.visibleContentSize : draw.contentSize, box = draw.constraint
  const flags = visible ? draw.overflow.visible : draw.overflow.full
  return flags.width || (box.width !== undefined && size.width > box.width + .5)
    || !draw.truncated && (flags.height || flags.lines || box.height !== undefined && size.height > box.height + .5)
}
const layoutSignature = ({ draw }: VideoEditTextDrawSample): string => JSON.stringify([
  draw.sourceText, draw.constraint, draw.contentSize, draw.visibleContentSize, draw.omittedRanges, draw.fit, draw.paintKey, draw.actualLines, draw.totalLines,
])
const ready = (sample: VideoEditTextDrawSample): boolean => sample.opacity >= .01 && sample.draw.revealComplete !== false
  && (!sample.draw.bodyCoverage || sample.draw.bodyCoverage === 'complete')
function clipped(sample: VideoEditTextDrawSample): VideoEditTextOverflowEvidence['clippedBy'] {
  const { draw } = sample
  if (!ready(sample) || draw.retained === false || draw.uncovered.length || draw.boundsKind !== 'measured') return []
  return [...(sample.frameClips.some(clip => outside(sample.inkQuad, clip)) ? ['frame' as const] : []),
    ...(sample.effectiveClips.some(clip => outside(sample.inkQuad, clip)) ? ['clip' as const] : [])]
}

/** 排版稳定与位姿运动无关；裁切按每帧正文和有效裁切判定后合并，不以坐标恒等作为前提。 */
export function videoEditTextOverflowFacts(samples: readonly VideoEditTextDrawSample[], fps: number, base: Base): VideoEditMotionStructureFact[] {
  const minimumFrames = Math.max(3, Math.ceil(.3 * fps)), records: VideoEditMotionStructureFact[] = []
  const append = (first: VideoEditTextDrawSample, last: VideoEditTextDrawSample, kind: VideoEditMotionStructureFact['kind'], clippedBy: VideoEditTextOverflowEvidence['clippedBy'], detail: string): void => {
    const draw = first.draw, timeline = { from: first.frame, to: last.frame + 1 }
    const textOverflow: VideoEditTextOverflowEvidence = {
      drawIndex: first.drawIndex, constraint: draw.constraint, contentSize: draw.contentSize, visibleContentSize: draw.visibleContentSize,
      inkBounds: draw.inkBounds, appearanceBounds: draw.appearanceBounds, boundsKind: draw.boundsKind,
      actualLines: draw.actualLines, totalLines: draw.totalLines, omittedRanges: draw.omittedRanges.filter(range => range.reason !== 'trim'),
      fitFailed: draw.fit.failed, truncated: draw.truncated, visibleOverflow: overflow(draw, true),
      matrix: draw.matrix, inkQuad: first.inkQuad, effectiveClips: [...first.effectiveClips, ...first.frameClips], clippedBy,
      stability: { basis: kind === 'text_clipped' ? 'persistent_clip' : 'stable_layout', fromFrame: timeline.from, toFrame: timeline.to, minimumFrames },
    }
    records.push({ ...base, basis: 'text_layout', timeline, kind, textOverflow,
      detail: `${base.label || '文字'}在序列帧 ${timeline.from}–${timeline.to}（末帧不含）${kind === 'text_clipped' ? '逐帧均被裁切' : '排版内容持续稳定（位姿运动不影响判定）'}：${detail} 若为有意的设计可保留。` })
  }
  let start = 0
  for (let end = 0; end <= samples.length; end++) {
    if (end < samples.length && (end === start || samples[end].frame === samples[end - 1].frame + 1 && ready(samples[end]) === ready(samples[start]) && layoutSignature(samples[end]) === layoutSignature(samples[start]))) continue
    const first = samples[start], last = samples[end - 1]
    if (first && ready(first) && end - start >= minimumFrames) {
      const draw = first.draw, truncated = draw.omittedRanges.some(range => range.reason !== 'trim')
      if (overflow(draw, false) || !truncated && draw.fit.failed) append(first, last, 'text_overflow', [], '完整内容超出文字约束框；增大文字框、减少内容，或启用自动缩字号（fit）；fit 已失败时降低最小字号。')
      if (truncated) append(first, last, 'text_truncated', [], `第 ${draw.actualLines + 1} 行起未显示（共 ${draw.totalLines} 行，实际 ${draw.actualLines} 行）；增高文字框、放宽 maxLines、减少内容，或启用自动缩字号（fit）。遗漏原文范围见结构化证据。`)
      let clipStart = start
      for (let at = start + 1; at <= end; at++) {
        const reasons = clipped(samples[clipStart])
        if (at < end && Boolean(clipped(samples[at]).length) === Boolean(reasons.length)) continue
        // 入场遮罩在同一段排版内完全揭开时，不把开场的局部遮挡报成缺字。
        const revealed = clipStart === start && at < end && !clipped(samples[at]).length
        if (reasons.length && at - clipStart >= minimumFrames && !revealed) append(samples[clipStart], samples[at - 1], 'text_clipped', [...new Set(samples.slice(clipStart, at).flatMap(clipped))],
          `正文墨迹落在${reasons.includes('frame') ? '画幅' : ''}${reasons.length === 2 ? '或' : ''}${reasons.includes('clip') ? '有效 clip' : ''}外；向内移动文字、缩小字号，或扩大裁切范围。阴影越界未计入正文缺失。`)
        clipStart = at
      }
    }
    start = end
  }
  return records
}
