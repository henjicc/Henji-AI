import { evaluateRegionProgram, type RegionGrid, type RegionRect } from '@/core/imaging/regions'
import { PaintDabGenerator, paintDabBounds, rasterizePaintDabs, type PaintBrush, type PaintDab } from '@/core/imaging/paint'
import { isMaskStroke, resolveMaskShapeBounds } from './maskDocument'
import { quickMaskRegionProgram, scaleDabsToGrid } from './regionAdapter'
import type { MaskEditorDocument, MaskMark } from './types'

/** 显示用遮罩栅格的最长边：不超过原图，超过就按比例缩到这里，放大看时仍按这张整图缩放显示。 */
const MAX_GRID_EDGE = 2048

export function maskDisplayGrid(width: number, height: number): RegionGrid {
  const scale = Math.min(1, MAX_GRID_EDGE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

type Rect = { x: number; y: number; width: number; height: number }

function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

function clampRect(rect: Rect, grid: RegionGrid): RegionRect | null {
  const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y))
  const right = Math.min(grid.width, Math.ceil(rect.x + rect.width)), bottom = Math.min(grid.height, Math.ceil(rect.y + rect.height))
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

function dabsRect(dabs: readonly PaintDab[]): Rect | null {
  let rect: Rect | null = null
  for (const dab of dabs) rect = unionRect(rect, paintDabBounds(dab))
  return rect
}

interface LiveStroke {
  mark: MaskMark
  /** 这一笔开始前的整张遮罩：笔画内重叠不叠加，按“开始前 + 这一笔的覆盖”合成，与最终求值同一规则。 */
  before: Float32Array
  coverage: Float32Array
  generator: PaintDabGenerator | null
  brush: PaintBrush | null
  fedPoints: number
  /** 形状上一次画到的范围：形状每次整体重算，旧范围里多出来的部分要还原成开始前的样子。 */
  shapeRect: RegionRect | null
}

/**
 * 整张遮罩的显示栅格：缩放、平移只是换个尺度显示这张图，不需要重算；正在画的一笔用与最终求值相同的笔刷
 * 与形状算法，只算这一笔扫过的那一小块，直接合进同一张遮罩。所以画的过程就是最终效果（软边、重叠不变深），
 * 笔画再多也只算新扫过的地方。整张的权威结果仍由 Worker 按文档求值后替换进来。
 */
export class MaskLiveRaster {
  readonly grid: RegionGrid
  readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly pixels: ImageData
  private readonly output: Float32Array
  private stroke: LiveStroke | null = null

  constructor(
    private readonly documentWidth: number,
    private readonly documentHeight: number,
    private readonly color: readonly [number, number, number],
    private readonly opacity: number,
  ) {
    this.grid = maskDisplayGrid(documentWidth, documentHeight)
    this.canvas = window.document.createElement('canvas')
    this.canvas.width = this.grid.width
    this.canvas.height = this.grid.height
    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('无法初始化遮罩显示')
    this.context = context
    this.pixels = context.createImageData(this.grid.width, this.grid.height)
    this.output = new Float32Array(this.grid.width * this.grid.height)
    for (let i = 0; i < this.output.length; i++) {
      this.pixels.data[i * 4] = color[0]; this.pixels.data[i * 4 + 1] = color[1]; this.pixels.data[i * 4 + 2] = color[2]
    }
  }

  get drawing(): boolean { return this.stroke !== null }

  /** 换成 Worker 按文档求出的整张遮罩。 */
  setCoverage(coverage: Float32Array): void {
    if (coverage.length !== this.output.length) return
    this.output.set(coverage)
    this.repaint({ x: 0, y: 0, width: this.grid.width, height: this.grid.height })
  }

  begin(mark: MaskMark): void {
    const brush = isMaskStroke(mark) ? { size: mark.size, hardness: mark.hardness ?? 1, opacity: 1, flow: 1, pressureSize: false } : null
    this.stroke = {
      mark, before: new Float32Array(this.output), coverage: new Float32Array(this.output.length),
      brush, generator: brush ? new PaintDabGenerator(brush) : null, fedPoints: 0, shapeRect: null,
    }
    this.update(mark)
  }

  /** 这一笔有了新的点（画笔）或新的终点（形状）：只重算受影响的那一块。 */
  update(mark: MaskMark): void {
    const stroke = this.stroke
    if (!stroke) return
    stroke.mark = mark
    if (stroke.generator && stroke.brush) {
      const fresh = mark.points.slice(stroke.fedPoints)
      stroke.fedPoints = mark.points.length
      this.paintDabs(stroke, stroke.generator.append(fresh))
      return
    }
    this.paintShape(stroke)
  }

  /** 收尾：画笔补上落笔末端的笔触，然后结束这一笔（结果留在遮罩上，等 Worker 的权威结果替换）。 */
  end(): void {
    const stroke = this.stroke
    if (stroke?.generator) this.paintDabs(stroke, stroke.generator.finish())
    this.stroke = null
  }

  /** 放弃这一笔：还原成开始前的样子。 */
  cancel(): void {
    const stroke = this.stroke
    if (!stroke) return
    this.output.set(stroke.before)
    this.stroke = null
    this.repaint({ x: 0, y: 0, width: this.grid.width, height: this.grid.height })
  }

  private paintDabs(stroke: LiveStroke, dabs: PaintDab[]): void {
    if (!dabs.length || !stroke.brush) return
    const scaled = scaleDabsToGrid(dabs, this.grid.width / this.documentWidth, this.grid.height / this.documentHeight)
    const erase = stroke.mark.mode === 'erase'
    rasterizePaintDabs({ width: this.grid.width, height: this.grid.height, originX: 0, originY: 0,
      before: stroke.before, output: this.output, coverage: stroke.coverage }, scaled, stroke.brush,
    { kind: 'mask', value: 1 }, erase ? 'eraser' : 'brush')
    const rect = dabsRect(scaled)
    const dirty = rect ? clampRect(rect, this.grid) : null
    if (dirty) this.repaint(dirty)
  }

  private paintShape(stroke: LiveStroke): void {
    const operation = quickMaskRegionProgram({ version: 1, sourceRef: '', width: this.documentWidth, height: this.documentHeight, strokes: [stroke.mark] } as MaskEditorDocument).operations[0]
    const previous = stroke.shapeRect
    let next: RegionRect | null = null
    if (operation?.kind === 'region') {
      const mark = stroke.mark
      const sx = this.grid.width / this.documentWidth, sy = this.grid.height / this.documentHeight
      let bounds: Rect | null = null
      if (mark.kind === 'rectangle' || mark.kind === 'circle') {
        bounds = resolveMaskShapeBounds(mark.kind, mark.points[0], mark.points[1])
      } else {
        for (const point of mark.points) bounds = unionRect(bounds, { x: point.x, y: point.y, width: 0, height: 0 })
      }
      next = bounds ? clampRect({ x: bounds.x * sx - 1, y: bounds.y * sy - 1, width: bounds.width * sx + 2, height: bounds.height * sy + 2 }, this.grid) : null
    }
    const dirty = unionRect(previous, next)
    const region = dirty ? clampRect(dirty, this.grid) : null
    if (!region) return
    const coverage = operation?.kind === 'region' && next ? evaluateRegionProgram(operation.program, this.grid, region) : null
    const erase = stroke.mark.mode === 'erase'
    for (let row = 0; row < region.height; row++) {
      for (let column = 0; column < region.width; column++) {
        const index = (region.y + row) * this.grid.width + region.x + column
        const base = stroke.before[index]
        const amount = coverage ? coverage[row * region.width + column] : 0
        this.output[index] = erase ? base * (1 - amount) : base + (1 - base) * amount
      }
    }
    stroke.shapeRect = next
    this.repaint(region)
  }

  private repaint(rect: RegionRect): void {
    const { data } = this.pixels
    for (let row = rect.y; row < rect.y + rect.height; row++) {
      for (let column = rect.x; column < rect.x + rect.width; column++) {
        const index = row * this.grid.width + column
        data[index * 4 + 3] = Math.round(this.output[index] * this.opacity * 255)
      }
    }
    this.context.putImageData(this.pixels, 0, 0, rect.x, rect.y, rect.width, rect.height)
  }
}
