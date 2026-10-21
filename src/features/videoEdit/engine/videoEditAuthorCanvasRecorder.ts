/**
 * Canvas 作者图层的绘制指令录制与重放。
 *
 * 图层 `draw(ctx, t)` 每帧都要调用，但多数图层的画面在相邻帧完全不变（节点卡片、文字、截图），只是位姿在动。
 * 先把这一帧的绘制指令录下来：与上一帧录到的指令逐条相同，就直接沿用上一帧已上传的图层纹理，省掉 Canvas 栅格化、
 * 上传和逐帧复制作者图片；不同才在真实画布上重放。相同的指令序列与相同的图片像素得到相同的画面，所以沿用与重画
 * 逐像素一致。录制不了的用法（读回像素、作者自己的画布或 Path2D 等无法比对内容的对象）只重放、不沿用；
 * 作者代码把图片交给画布以外的地方时，该图层改回直接绘制。
 */

/** 作者图片在录制期间的替身：重放时才换成本帧的位图。 */
export class AuthorCanvasAsset {
  constructor(readonly key: string, readonly width: number, readonly height: number) {}
}
/** `ctx.canvas` 的替身。 */
class CanvasStandIn { constructor(readonly width: number, readonly height: number) {} }
/** 录制不了的读取或对象：调用方改为在真实画布上直接绘制这一图层。 */
export class AuthorCanvasUnrecordable extends Error {}

type Value = unknown
interface Gradient { id: number; kind: string; args: number[] }
class GradientRecord {
  constructor(readonly record: Gradient, private readonly ops: Value[][]) {}
  addColorStop(offset: number, color: string): void { this.ops.push(['stop', this.record.id, offset, String(color)]) }
}
class PatternRecord { constructor(readonly id: number) {} setTransform(): void { throw new AuthorCanvasUnrecordable('图案变换无法录制') } }

const STATE = ['fillStyle', 'strokeStyle', 'globalAlpha', 'globalCompositeOperation', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'lineDashOffset', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'font', 'textAlign', 'textBaseline', 'direction', 'filter', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'letterSpacing', 'wordSpacing', 'fontKerning', 'fontStretch', 'fontVariantCaps', 'textRendering', 'lang'] as const
const TEXT_STATE = ['font', 'letterSpacing', 'wordSpacing', 'fontKerning', 'fontStretch', 'fontVariantCaps', 'textRendering', 'direction', 'lang', 'textAlign', 'textBaseline'] as const
const DRAW = new Set(['beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'drawImage'])
type Matrix = [number, number, number, number, number, number]
const multiply = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]

export interface AuthorCanvasRecording {
  ops: Value[][]
  /** 指令全部可比对：与上一帧相同即可沿用纹理。 */
  comparable: boolean
  signature: string
  /** 用到的作者图片键。 */
  assets: Set<string>
}

/**
 * 录下 `draw` 对画布的全部操作。`measure` 是同一 Worker 里的真实 2D 上下文，只用来量文字；`transform` 是运行时
 * 在作者绘制前设好的变换（`getTransform` 要据此回答）。
 */
export function recordAuthorCanvas(size: { width: number; height: number }, measure: OffscreenCanvasRenderingContext2D, transform: Matrix, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): AuthorCanvasRecording {
  measure.reset()
  const ops: Value[][] = []
  let comparable = true, nextId = 0
  const assets = new Set<string>()
  const objects = new Map<object, number>()
  const live = (value: object): Value => { comparable = false; let id = objects.get(value); if (id === undefined) { id = ++nextId; objects.set(value, id) } return { live: id, value } }
  const state: Record<string, Value> = Object.fromEntries(STATE.map(key => [key, (measure as unknown as Record<string, Value>)[key]]))
  let matrix: Matrix = [...transform], dash: number[] = []
  const stack: Array<{ state: Record<string, Value>; matrix: Matrix; dash: number[] }> = []
  const standIn = new CanvasStandIn(size.width, size.height)
  const encode = (value: Value): Value => {
    if (value === null || value === undefined || typeof value !== 'object') return value
    if (value instanceof AuthorCanvasAsset) { assets.add(value.key); return { asset: value.key } }
    if (value instanceof GradientRecord) return { gradient: value.record.id }
    if (value instanceof PatternRecord) return { pattern: value.id }
    if (value instanceof CanvasStandIn) return { canvas: true }
    if (Array.isArray(value) && value.every(item => typeof item === 'number')) return [...value]
    if (typeof DOMMatrix !== 'undefined' && value instanceof DOMMatrix) return { matrix: [value.a, value.b, value.c, value.d, value.e, value.f] }
    if (typeof value === 'object' && 'a' in value && 'b' in value && 'e' in value) { const m = value as unknown as DOMMatrix2DInit; return { matrix: [m.a ?? 1, m.b ?? 0, m.c ?? 0, m.d ?? 1, m.e ?? 0, m.f ?? 0] } }
    // Path2D, author canvases or bitmaps: content cannot be compared, replay the live object.
    return live(value)
  }
  const apply = (name: string, args: Value[]): void => {
    const [a, b, c, d, e, f] = args as number[]
    if (name === 'translate') matrix = multiply(matrix, [1, 0, 0, 1, a, b])
    else if (name === 'scale') matrix = multiply(matrix, [a, 0, 0, b, 0, 0])
    else if (name === 'rotate') matrix = multiply(matrix, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0])
    else if (name === 'transform') matrix = multiply(matrix, [a, b, c, d, e, f])
    else if (name === 'setTransform') {
      const value = args[0]
      if (typeof value === 'object' && value) { const m = value as DOMMatrix2DInit; matrix = [m.a ?? 1, m.b ?? 0, m.c ?? 0, m.d ?? 1, m.e ?? 0, m.f ?? 0] }
      else matrix = args.length ? [a, b, c, d, e, f] : [1, 0, 0, 1, 0, 0]
    } else if (name === 'resetTransform') matrix = [1, 0, 0, 1, 0, 0]
    else if (name === 'save') stack.push({ state: { ...state }, matrix: [...matrix], dash: [...dash] })
    else if (name === 'restore') { const top = stack.pop(); if (top) { Object.assign(state, top.state); matrix = top.matrix; dash = top.dash } }
    else if (name === 'setLineDash') dash = [...(args[0] as number[])]
    else if (name === 'reset') throw new AuthorCanvasUnrecordable('reset 只能由宿主调用')
  }
  const methods: Record<string, (...args: Value[]) => Value> = {
    createLinearGradient: (...args) => { const record = { id: ++nextId, kind: 'linear', args: args as number[] }; ops.push(['gradient', record.id, 'linear', ...args]); return new GradientRecord(record, ops) },
    createRadialGradient: (...args) => { const record = { id: ++nextId, kind: 'radial', args: args as number[] }; ops.push(['gradient', record.id, 'radial', ...args]); return new GradientRecord(record, ops) },
    createConicGradient: (...args) => { const record = { id: ++nextId, kind: 'conic', args: args as number[] }; ops.push(['gradient', record.id, 'conic', ...args]); return new GradientRecord(record, ops) },
    createPattern: (source, repetition) => { const id = ++nextId; ops.push(['pattern', id, encode(source), repetition ?? null]); return new PatternRecord(id) },
    measureText: text => {
      for (const key of TEXT_STATE) (measure as unknown as Record<string, Value>)[key] = state[key]
      return measure.measureText(String(text))
    },
    getLineDash: () => [...dash],
    getTransform: () => new DOMMatrix(matrix),
    createImageData: (...args) => (measure.createImageData as (...values: Value[]) => ImageData)(...args),
  }
  const target = {} as Record<string, Value>
  const context = new Proxy(target, {
    get(_, property) {
      if (typeof property !== 'string') return undefined
      if (property === 'canvas') return standIn
      if (property in state) return state[property]
      if (methods[property]) return methods[property]
      if (DRAW.has(property) || ['save', 'restore', 'translate', 'rotate', 'scale', 'transform', 'setTransform', 'resetTransform', 'setLineDash'].includes(property)) {
        return (...args: Value[]) => { apply(property, args); ops.push([property, ...args.map(encode)]) }
      }
      if (property in measure) throw new AuthorCanvasUnrecordable(`画布操作 ${property} 无法录制`)
      return undefined
    },
    set(_, property, value) {
      if (typeof property !== 'string' || !(property in state)) throw new AuthorCanvasUnrecordable(`画布属性 ${String(property)} 无法录制`)
      state[property] = value
      ops.push(['set', property, encode(value)])
      return true
    },
  }) as unknown as OffscreenCanvasRenderingContext2D
  draw(context)
  const signature = comparable ? JSON.stringify(ops) : ''
  return { ops, comparable, signature, assets }
}

/** 在真实画布上按录制顺序重放；作者图片在用到时才取本帧的位图。 */
export function replayAuthorCanvas(recording: AuthorCanvasRecording, ctx: OffscreenCanvasRenderingContext2D, asset: (key: string) => CanvasImageSource): void {
  const gradients = new Map<number, CanvasGradient>(), patterns = new Map<number, CanvasPattern | null>()
  const decode = (value: Value): Value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    const record = value as Record<string, Value>
    if ('asset' in record) return asset(record.asset as string)
    if ('gradient' in record) return gradients.get(record.gradient as number)
    if ('pattern' in record) return patterns.get(record.pattern as number)
    if ('canvas' in record) return ctx.canvas
    if ('matrix' in record) { const [a, b, c, d, e, f] = record.matrix as number[]; return { a, b, c, d, e, f } }
    if ('live' in record) return record.value
    return value
  }
  const target = ctx as unknown as Record<string, unknown>
  for (const [name, ...args] of recording.ops as Array<[string, ...Value[]]>) {
    if (name === 'set') target[args[0] as string] = decode(args[1])
    else if (name === 'gradient') {
      const [id, kind, ...values] = args as [number, string, ...number[]]
      gradients.set(id, kind === 'linear' ? ctx.createLinearGradient(values[0], values[1], values[2], values[3]) : kind === 'radial' ? ctx.createRadialGradient(values[0], values[1], values[2], values[3], values[4], values[5]) : ctx.createConicGradient(values[0], values[1], values[2]))
    } else if (name === 'stop') gradients.get(args[0] as number)?.addColorStop(args[1] as number, args[2] as string)
    else if (name === 'pattern') patterns.set(args[0] as number, ctx.createPattern(decode(args[1]) as CanvasImageSource, (args[2] as string | null) ?? null))
    else (target[name] as (...values: Value[]) => void).apply(ctx, args.map(decode))
  }
}
