import type { SpatialPropagationRequest } from './spatialTypes'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from './time'

type TimeMap = SpatialPropagationRequest['sequenceTimeMap'][number]

/** 编辑中的当前时钟映回事务原快照；插入空隙保持切点时刻，删除区间保留来源记录。 */
export class VideoEditTimelineClock {
  private spans: TimeMap[]
  private changed = false

  constructor(private readonly sequenceId: string) {
    this.spans = [{ sequenceId, sourceRange: [0, VIDEO_EDIT_MAX_SEQUENCE_FRAMES + 1], targetRange: [0, VIDEO_EDIT_MAX_SEQUENCE_FRAMES + 1] }]
  }

  sourceFrame(frame: number): number {
    const span = this.spans.find(value => value.targetRange && value.targetRange[0] <= frame && frame < value.targetRange[1])
    if (!span?.targetRange) throw new Error('时间线映射超出可编辑范围。')
    return this.sourceAt(span, frame)
  }

  private sourceAt(span: TimeMap, frame: number): number {
    const [from, to] = span.targetRange!
    return span.sourceRange[0] + (frame - from) * (span.sourceRange[1] - span.sourceRange[0]) / (to - from)
  }

  splice(from: number, to: number, insertedFrames: number): void {
    if (from === to && !insertedFrames) return
    const source = this.sourceFrame(from)
    const shift = insertedFrames - (to - from)
    const next: TimeMap[] = []
    for (const span of this.spans) {
      if (!span.targetRange) { next.push(span); continue }
      const [start, end] = span.targetRange
      const cuts = [...new Set([start, end, Math.max(start, Math.min(end, from)), Math.max(start, Math.min(end, to))])].sort((a, b) => a - b)
      for (let index = 0; index < cuts.length - 1; index++) {
        const left = cuts[index], right = cuts[index + 1]
        next.push({ sequenceId: this.sequenceId, sourceRange: [this.sourceAt(span, left), this.sourceAt(span, right)],
          targetRange: left >= to ? [left + shift, right + shift] : right <= from ? [left, right] : null })
      }
    }
    if (insertedFrames) next.push({ sequenceId: this.sequenceId, sourceRange: [source, source], targetRange: [from, from + insertedFrames] })
    this.spans = next
    this.changed = true
  }

  get maps(): SpatialPropagationRequest['sequenceTimeMap'] { return this.changed ? this.spans : [] }
}
