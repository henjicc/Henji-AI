import { scaleAuthorCanvasEffect } from './videoEditAuthorCanvasBounds'

/**
 * Canvas 作者图层的绘制指令录制与重放。
 *
 * 图层 `draw(ctx, t)` 每帧都要调用，但多数图层的画面在相邻帧完全不变（节点卡片、文字、截图），只是位姿在动。
 * 先把这一帧的绘制指令录下来：与上一帧录到的指令逐条相同，就直接沿用上一帧已上传的图层纹理，省掉 Canvas 栅格化、
 * 上传和逐帧复制作者图片；不同才在真实画布上重放。相同的指令序列与相同的图片像素得到相同的画面，所以沿用与重画
 * 逐像素一致。作者自己的 ImageBitmap 不可变，按对象身份比对；作者自己的画布、Path2D 等内容可能被改、又无从比对的对象
 * 只重放、不沿用；读回像素等录制不了的用法，该图层改回直接绘制。
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
type Matrix = [number, number, number, number, number, number]

/** 作者自己的位图：ImageBitmap 创建后内容不再变，同一对象跨帧得到同一编号，按编号比对。 */
class ImageRef { constructor(readonly id: number, readonly image: ImageBitmap) {} }
const imageIds = new WeakMap<object, number>()
let lastImageId = 0
const imageRef = (image: ImageBitmap): ImageRef => {
  let id = imageIds.get(image)
  if (id === undefined) imageIds.set(image, id = ++lastImageId)
  return new ImageRef(id, image)
}

/** 正在录制的那一层：作者缓存到模块变量的渐变或图案在这期间被修改（加色标、设图案变换），修改记进这一层。 */
let active: { idOf(value: GradientRecord | PatternRecord): number | undefined; adopt(value: GradientRecord | PatternRecord): number; ops: Value[][] } | undefined

interface Gradient { id: number; kind: string; args: number[] }
// 渐变与图案记下完整定义：作者把它们缓存到模块变量、下一帧再用时，按定义在那一帧的录制或真实画布上重建。
class GradientRecord {
  readonly stops: Array<[number, string]> = []
  constructor(readonly record: Gradient, readonly owner: Value[][]) {}
  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, String(color)])
    const id = active?.idOf(this)
    if (id !== undefined) active!.ops.push(['stop', id, offset, String(color)])
    else active?.adopt(this)
  }
}
class PatternRecord {
  transform?: Matrix
  constructor(readonly id: number, readonly owner: Value[][], readonly source: Value, readonly repetition: string | null) {}
  setTransform(transform?: DOMMatrix2DInit): void {
    this.transform = matrixOf(transform === undefined ? [] : [transform])
    const id = active?.idOf(this)
    if (id !== undefined) active!.ops.push(['patternTransform', id, ...this.transform])
    else active?.adopt(this)
  }
}
const createGradient = (ctx: OffscreenCanvasRenderingContext2D, kind: string, values: number[]): CanvasGradient =>
  kind === 'linear' ? ctx.createLinearGradient(values[0], values[1], values[2], values[3]) : kind === 'radial' ? ctx.createRadialGradient(values[0], values[1], values[2], values[3], values[4], values[5]) : ctx.createConicGradient(values[0], values[1], values[2])
const matrixInit = ([a, b, c, d, e, f]: number[]): DOMMatrix2DInit => ({ a, b, c, d, e, f })
/** 把录制期创建、被作者缓存下来的渐变或图案换成真实画布上的对象。 */
const realize = (ctx: OffscreenCanvasRenderingContext2D, value: Value): Value => {
  if (value instanceof GradientRecord) { const gradient = createGradient(ctx, value.record.kind, value.record.args); for (const [offset, color] of value.stops) gradient.addColorStop(offset, color); return gradient }
  if (value instanceof PatternRecord) {
    const pattern = ctx.createPattern(value.source as CanvasImageSource, value.repetition)
    if (pattern && value.transform) pattern.setTransform(matrixInit(value.transform))
    return pattern
  }
  return value
}

/** 不随变换缩放的状态（Canvas 规范，Chromium 实测一致）。 */
const SCALED_EFFECTS = new Set(['shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'filter'])
const STATE = ['fillStyle', 'strokeStyle', 'globalAlpha', 'globalCompositeOperation', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'lineDashOffset', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'font', 'textAlign', 'textBaseline', 'direction', 'filter', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'letterSpacing', 'wordSpacing', 'fontKerning', 'fontStretch', 'fontVariantCaps', 'textRendering', 'lang'] as const
const TEXT_STATE = ['font', 'letterSpacing', 'wordSpacing', 'fontKerning', 'fontStretch', 'fontVariantCaps', 'textRendering', 'direction', 'lang', 'textAlign', 'textBaseline'] as const
const DRAW = new Set(['beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'drawImage'])
const STATEFUL = new Set(['save', 'restore', 'translate', 'rotate', 'scale', 'transform', 'setTransform', 'resetTransform', 'setLineDash', 'reset'])
/** 往当前路径里加东西的指令：没先 beginPath 就是接着前面（可能是前一层）留下的路径画。 */
const PATH = new Set(['closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect'])
/** 不传 Path2D 时用当前路径的指令。 */
const USES_PATH = new Set(['fill', 'stroke', 'clip'])
/** 往画布上落像素的指令：叠加方式不是 source-over 时会改动下面已有的内容。 */
const PAINT = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage'])
const multiply = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
const invert = (m: Matrix): Matrix => {
  const det = m[0] * m[3] - m[1] * m[2]
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}
/** `setTransform` 的参数（六个数或 DOMMatrix 形状）；不给参数等同单位矩阵。 */
const matrixOf = (args: Value[]): Matrix => {
  const value = args[0]
  if (typeof value === 'object' && value) { const m = value as DOMMatrix2DInit; return [m.a ?? 1, m.b ?? 0, m.c ?? 0, m.d ?? 1, m.e ?? 0, m.f ?? 0] }
  return args.length ? args.slice(0, 6) as Matrix : [1, 0, 0, 1, 0, 0]
}
const isIdentity = (m: Matrix): boolean => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0

export interface AuthorCanvasRecording {
  ops: Value[][]
  /** 指令全部可比对：与上一帧相同即可沿用纹理。 */
  comparable: boolean
  /** 用到的作者图片键。 */
  assets: Set<string>
  /**
   * 只用 source-over 往上叠：不清除、不用别的混合模式、不读画布本身、不接着前一层留下的路径画。这样的层单独栅格后
   * 在 GPU 上按顺序叠，与画在同一张画布上相同（source-over 满足结合律）。
   */
  isolated: boolean
  /** save/restore 成对、没有 reset：画完后画布状态与开始时相同，也出不了包在外面的裁剪。 */
  balanced: boolean
}

/** 两次录制的指令逐条相同（作者位图按身份）。只比指令；作者图片的像素版本由调用方另比。 */
export function sameAuthorCanvasRecording(a: AuthorCanvasRecording, b: AuthorCanvasRecording): boolean {
  return a.comparable && b.comparable && same(a.ops, b.ops)
}
function same(a: Value, b: Value): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (a instanceof ImageRef || b instanceof ImageRef) return a instanceof ImageRef && b instanceof ImageRef && a.id === b.id
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let index = 0; index < a.length; index++) if (!same(a[index], b[index])) return false
    return true
  }
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) if (!same((a as Record<string, Value>)[key], (b as Record<string, Value>)[key])) return false
  return true
}

/**
 * 录下 `draw` 对画布的全部操作。`measure` 是同一 Worker 里的真实 2D 上下文，只用来量文字；`transform` 是运行时
 * 在作者绘制前设好的变换（运动层的栅格缩放与留边）。作者的坐标始终是画布像素：`setTransform`/`resetTransform`
 * 相对这个变换生效，`getTransform` 也按画布像素回答。录下的指令与 `transform` 无关，重放时才用它。
 */
export function recordAuthorCanvas(size: { width: number; height: number }, measure: OffscreenCanvasRenderingContext2D, transform: Matrix, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): AuthorCanvasRecording {
  measure.reset()
  const ops: Value[][] = []
  let comparable = true, isolated = true, balanced = true, ownPath = false, nextId = 0
  const adopted = new Map<object, number>()
  const assets = new Set<string>()
  const objects = new Map<object, number>()
  const live = (value: object): Value => { comparable = false; let id = objects.get(value); if (id === undefined) { id = ++nextId; objects.set(value, id) } return { live: id, value } }
  const state: Record<string, Value> = Object.fromEntries(STATE.map(key => [key, (measure as unknown as Record<string, Value>)[key]]))
  const initial = { ...state }
  let matrix: Matrix = [...transform], dash: number[] = []
  const stack: Array<{ state: Record<string, Value>; matrix: Matrix; dash: number[] }> = []
  const standIn = new CanvasStandIn(size.width, size.height)
  const idOf = (value: GradientRecord | PatternRecord): number | undefined => value.owner === ops ? (value instanceof GradientRecord ? value.record.id : value.id) : adopted.get(value)
  const adopt = (value: GradientRecord | PatternRecord): number => {
    const id = ++nextId
    adopted.set(value, id)
    if (value instanceof GradientRecord) { ops.push(['gradient', id, value.record.kind, ...value.record.args]); for (const [offset, color] of value.stops) ops.push(['stop', id, offset, color]) }
    else { ops.push(['pattern', id, encode(value.source), value.repetition]); if (value.transform) ops.push(['patternTransform', id, ...value.transform]) }
    return id
  }
  const encode = (value: Value): Value => {
    if (value === null || value === undefined || typeof value !== 'object') return value
    if (value instanceof AuthorCanvasAsset) { assets.add(value.key); return { asset: value.key } }
    if (value instanceof GradientRecord) return { gradient: idOf(value) ?? adopt(value) }
    if (value instanceof PatternRecord) return { pattern: idOf(value) ?? adopt(value) }
    // 读画布本身：结果取决于前面画了什么。
    if (value instanceof CanvasStandIn) { isolated = false; return { canvas: true } }
    if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) return imageRef(value)
    if (Array.isArray(value) && value.every(item => typeof item === 'number')) return [...value]
    if (typeof DOMMatrix !== 'undefined' && value instanceof DOMMatrix) return { matrix: [value.a, value.b, value.c, value.d, value.e, value.f] }
    if (typeof value === 'object' && 'a' in value && 'b' in value && 'e' in value) { const m = value as unknown as DOMMatrix2DInit; return { matrix: [m.a ?? 1, m.b ?? 0, m.c ?? 0, m.d ?? 1, m.e ?? 0, m.f ?? 0] } }
    // Path2D, author canvases: they may change without any call on this context, so they cannot be compared; replay the live object.
    return live(value)
  }
  const apply = (name: string, args: Value[]): void => {
    const [a, b, c, d, e, f] = args as number[]
    if (name === 'translate') matrix = multiply(matrix, [1, 0, 0, 1, a, b])
    else if (name === 'scale') matrix = multiply(matrix, [a, 0, 0, b, 0, 0])
    else if (name === 'rotate') matrix = multiply(matrix, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0])
    else if (name === 'transform') matrix = multiply(matrix, [a, b, c, d, e, f])
    else if (name === 'setTransform') matrix = multiply(transform, matrixOf(args))
    else if (name === 'resetTransform') matrix = [...transform]
    else if (name === 'save') stack.push({ state: { ...state }, matrix: [...matrix], dash: [...dash] })
    else if (name === 'restore') { const top = stack.pop(); if (top) { Object.assign(state, top.state); matrix = top.matrix; dash = top.dash } else balanced = false }
    else if (name === 'setLineDash') dash = [...(args[0] as number[])]
    else if (name === 'reset') {
      // 清空画布与全部状态（重放时回到宿主变换）：会擦掉同一画布上前面画的东西。
      Object.assign(state, initial); matrix = [...transform]; dash = []; stack.length = 0
      isolated = false; balanced = false; ownPath = true
    } else if (name === 'beginPath') ownPath = true
    else if (name === 'clearRect') isolated = false
    if (!ownPath && (PATH.has(name) || (USES_PATH.has(name) && (typeof args[0] !== 'object' || args[0] === null)))) isolated = false
    if (PAINT.has(name) && (state.globalCompositeOperation ?? 'source-over') !== 'source-over') isolated = false
  }
  const recorders = new Map<string, (...args: Value[]) => void>()
  const recorder = (name: string): ((...args: Value[]) => void) => {
    let method = recorders.get(name)
    if (!method) {
      method = (...args: Value[]) => {
        apply(name, args)
        const op: Value[] = [name]
        for (const arg of args) op.push(arg !== null && typeof arg === 'object' ? encode(arg) : arg)
        ops.push(op)
      }
      recorders.set(name, method)
    }
    return method
  }
  const methods: Record<string, (...args: Value[]) => Value> = {
    createLinearGradient: (...args) => { const record = { id: ++nextId, kind: 'linear', args: args as number[] }; ops.push(['gradient', record.id, 'linear', ...args]); return new GradientRecord(record, ops) },
    createRadialGradient: (...args) => { const record = { id: ++nextId, kind: 'radial', args: args as number[] }; ops.push(['gradient', record.id, 'radial', ...args]); return new GradientRecord(record, ops) },
    createConicGradient: (...args) => { const record = { id: ++nextId, kind: 'conic', args: args as number[] }; ops.push(['gradient', record.id, 'conic', ...args]); return new GradientRecord(record, ops) },
    createPattern: (source, repetition) => { const id = ++nextId; ops.push(['pattern', id, encode(source), (repetition as string | null) ?? null]); return new PatternRecord(id, ops, source, (repetition as string | null) ?? null) },
    measureText: text => {
      for (const key of TEXT_STATE) (measure as unknown as Record<string, Value>)[key] = state[key]
      return measure.measureText(String(text))
    },
    getLineDash: () => [...dash],
    getTransform: () => new DOMMatrix(multiply(invert(transform), matrix)),
    createImageData: (...args) => (measure.createImageData as (...values: Value[]) => ImageData)(...args),
  }
  const target = {} as Record<string, Value>
  const context = new Proxy(target, {
    get(_, property) {
      if (typeof property !== 'string') return undefined
      if (property === 'canvas') return standIn
      if (property in state) return state[property]
      if (methods[property]) return methods[property]
      if (DRAW.has(property) || STATEFUL.has(property)) return recorder(property)
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
  const outer = active
  active = { idOf, adopt, ops }
  try { draw(context) } finally { active = outer }
  // 多出的 save 没有 restore：画完时状态与裁剪还留在栈上，同样会漏给后面的层。
  if (stack.length) balanced = false
  return { ops, comparable, assets, isolated, balanced }
}

/**
 * 在真实画布上按录制顺序重放；作者图片在用到时才取本帧的位图。`transform` 与录制时相同，作者的 setTransform 相对它生效。
 * `effects`：栅格相对画布像素缩小的比例。阴影与 filter 的长度不随变换缩放，按这个比例换算（见 scaleAuthorCanvasEffect）。
 */
export function replayAuthorCanvas(recording: AuthorCanvasRecording, ctx: OffscreenCanvasRenderingContext2D, asset: (key: string) => CanvasImageSource, transform: Matrix = [1, 0, 0, 1, 0, 0], effects?: { sx: number; sy: number }): void {
  const gradients = new Map<number, CanvasGradient>(), patterns = new Map<number, CanvasPattern | null>()
  const decode = (value: Value): Value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    if (value instanceof ImageRef) return value.image
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
    if (name === 'set') {
      const property = args[0] as string, value = decode(args[1])
      target[property] = effects && SCALED_EFFECTS.has(property) ? scaleAuthorCanvasEffect(property, value, effects.sx, effects.sy) ?? value : value
    }
    else if (name === 'gradient') {
      const [id, kind, ...values] = args as [number, string, ...number[]]
      gradients.set(id, createGradient(ctx, kind, values))
    } else if (name === 'stop') gradients.get(args[0] as number)?.addColorStop(args[1] as number, args[2] as string)
    else if (name === 'pattern') patterns.set(args[0] as number, ctx.createPattern(decode(args[1]) as CanvasImageSource, (args[2] as string | null) ?? null))
    else if (name === 'patternTransform') patterns.get(args[0] as number)?.setTransform(matrixInit(args.slice(1) as number[]))
    else if (name === 'setTransform') ctx.setTransform(...multiply(transform, matrixOf(args.map(decode))))
    else if (name === 'resetTransform') ctx.setTransform(...transform)
    else if (name === 'reset') { ctx.reset(); ctx.setTransform(...transform) }
    else (target[name] as (...values: Value[]) => void).apply(ctx, args.map(decode))
  }
}

/**
 * 直接绘制（录制不了）的图层用：真实画布上同样让作者的 setTransform/resetTransform/getTransform/reset 按画布像素生效，
 * 录制期创建、被作者缓存的渐变与图案换成真实对象。
 */
export function authorCanvasContext(ctx: OffscreenCanvasRenderingContext2D, transform: Matrix): OffscreenCanvasRenderingContext2D {
  const identity = isIdentity(transform), inverse = invert(transform)
  return new Proxy(ctx, {
    get(real, property) {
      if (!identity && property === 'setTransform') return (...args: Value[]) => real.setTransform(...multiply(transform, matrixOf(args)))
      if (!identity && property === 'resetTransform') return () => real.setTransform(...transform)
      if (!identity && property === 'reset') return () => { real.reset(); real.setTransform(...transform) }
      if (!identity && property === 'getTransform') return () => { const m = real.getTransform(); return new DOMMatrix(multiply(inverse, [m.a, m.b, m.c, m.d, m.e, m.f])) }
      const value = Reflect.get(real, property, real)
      return typeof value === 'function' ? value.bind(real) : value
    },
    set(real, property, value) { return Reflect.set(real, property, realize(real, value), real) },
  })
}
