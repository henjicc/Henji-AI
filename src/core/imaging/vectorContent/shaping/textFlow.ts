/** 绕排区域，坐标相对放置盒左上；竖排时由调用方换算成行内方向与行堆叠方向。 */
export interface TextExclusion { x: number; y: number; width: number; height: number; shape?: 'rect' | 'ellipse'; margin?: number }
export interface TextFlowFrame { inlineStart: number; inlineSize: number; blockStart: number; blockSize?: number }
export interface TextFlowSlot { inlineStart: number; inlineSize: number; block: number }
interface LogicalExclusion { inline: number; block: number; inlineSize: number; blockSize: number; ellipse: boolean; margin: number }

const blockedSpan = (exclusion: LogicalExclusion, top: number, bottom: number): [number, number] | null => {
  const { inline, block, inlineSize, blockSize, margin } = exclusion
  if (bottom <= block - margin || top >= block + blockSize + margin) return null
  if (!exclusion.ellipse) return [inline - margin, inline + inlineSize + margin]
  // 椭圆按这一行里最靠近圆心的高度算，字才不会压到弧线上。
  const centerBlock = block + blockSize / 2, radiusBlock = blockSize / 2, radiusInline = inlineSize / 2, center = inline + radiusInline
  const distance = top <= centerBlock && bottom >= centerBlock ? 0 : Math.min(Math.abs(top - centerBlock), Math.abs(bottom - centerBlock))
  if (distance >= radiusBlock) return margin ? [center - margin, center + margin] : null
  const half = radiusInline * Math.sqrt(1 - (distance / radiusBlock) ** 2)
  return [center - half - margin, center + half + margin]
}

/** 把绕排区域换成行内方向在前、行堆叠方向在后的逻辑坐标。竖排的第一列在最右边，所以行堆叠方向从盒子右边量起。 */
export function logicalExclusions(exclusions: readonly TextExclusion[], vertical: boolean, physicalWidth: number | undefined): LogicalExclusion[] {
  return exclusions.map(item => {
    const margin = item.margin ?? 0, ellipse = item.shape === 'ellipse'
    if (!vertical) return { inline: item.x, block: item.y, inlineSize: item.width, blockSize: item.height, ellipse, margin }
    if (physicalWidth === undefined) throw new Error('竖排的绕排区域需要放置盒宽度（box.width）')
    return { inline: item.y, block: physicalWidth - item.x - item.width, inlineSize: item.height, blockSize: item.width, ellipse, margin }
  })
}

/** 一行一行地给出位置：先在当前高度从左到右用完被绕排切开的各段，再往下；当前栏放不下就换下一栏。 */
export class TextFlow {
  private frame = 0
  private block: number
  private pending: Array<[number, number]> = []
  private lineBlock = 0
  private rowHeight = 0
  private readonly clearBlock: number
  constructor(private readonly frames: readonly TextFlowFrame[], private readonly exclusions: readonly LogicalExclusion[], private readonly minimumSize: number) {
    this.block = frames[0]?.blockStart ?? 0
    this.clearBlock = Math.max(-Infinity, ...exclusions.map(item => item.block + item.blockSize + item.margin))
  }
  next(height: number, indentStart: number, indentEnd: number): TextFlowSlot | null {
    if (this.pending.length) return this.take()
    for (;;) {
      const frame = this.frames[this.frame]
      if (!frame) return null
      const end = frame.blockSize === undefined ? Infinity : frame.blockStart + frame.blockSize
      if (this.block + height > end + 1e-6) {
        this.frame++
        this.block = this.frames[this.frame]?.blockStart ?? 0
        continue
      }
      const spans = this.free(frame, this.block, this.block + height, indentStart, indentEnd)
      if (spans.length) { this.pending = spans; this.lineBlock = this.block; this.rowHeight = 0; return this.take() }
      if (this.block >= this.clearBlock) {
        // 绕排区域都过去了还放不下，是栏本身比一个字还窄，再往下也不会变宽：照样排，字伸出栏外总好过排不下。
        const start = frame.inlineStart + indentStart
        this.pending = [[start, Math.max(start + this.minimumSize, frame.inlineStart + frame.inlineSize - indentEnd)]]; this.lineBlock = this.block; this.rowHeight = 0
        return this.take()
      }
      // 这一高度整行都被挡住：往下挪一点再试，不跳一整行，字能尽量贴着绕排区域底边。
      this.block += Math.max(1, height / 4)
    }
  }
  /** 一行排好后调用；本行高度的剩余段还没用完时不换行。 */
  placed(height: number): void {
    this.rowHeight = Math.max(this.rowHeight, height)
    if (!this.pending.length) this.block = this.lineBlock + this.rowHeight
  }
  /** 段落结束：被切开的剩余段不再用。 */
  endParagraph(space: number): void {
    if (this.pending.length) this.block = this.lineBlock + this.rowHeight
    this.pending = []
    this.block += space
  }
  skip(space: number): void { this.block += space }
  get extent(): number { return this.block }
  private take(): TextFlowSlot {
    const [start, end] = this.pending.shift()!
    return { inlineStart: start, inlineSize: end - start, block: this.lineBlock }
  }
  private free(frame: TextFlowFrame, top: number, bottom: number, indentStart: number, indentEnd: number): Array<[number, number]> {
    let spans: Array<[number, number]> = [[frame.inlineStart + indentStart, frame.inlineStart + frame.inlineSize - indentEnd]]
    for (const exclusion of this.exclusions) {
      const blocked = blockedSpan(exclusion, top, bottom)
      if (!blocked) continue
      spans = spans.flatMap(([start, end]): Array<[number, number]> => {
        if (blocked[1] <= start || blocked[0] >= end) return [[start, end]]
        return [...(blocked[0] > start ? [[start, blocked[0]] as [number, number]] : []), ...(blocked[1] < end ? [[blocked[1], end] as [number, number]] : [])]
      })
    }
    return spans.filter(([start, end]) => end - start >= this.minimumSize)
  }
}
