import type { AuthorCanvasRecording } from './videoEditAuthorCanvasRecorder'

/**
 * Canvas 作者图层录下的指令画到了哪一块（录制坐标，即画布像素），用来只栅格、上传有内容的范围。
 *
 * 每条落像素的指令按当时的变换、线宽、阴影与滤镜保守外扩，再并起来；只会偏大、不会偏小：清除、裁剪与混合模式只会让
 * 内容变少。推不出的（Path2D、量不了的文字、读不到尺寸的图片、认不出的滤镜）整层记为未知，调用方按整幅处理。
 * 只在图层要重画时才分析，结果按录制对象缓存：沿用的图层不再分析。
 */
export type AuthorCanvasBox = [number, number, number, number]
type Matrix = [number, number, number, number, number, number]
type Value = unknown
export interface AuthorCanvasContent {
  /** 画到的范围；undefined 表示推不出，null 表示什么也没画。 */
  bounds: AuthorCanvasBox | null | undefined
  /** 把画布本身当图片用（drawImage / createPattern 读 ctx.canvas）：结果依赖画布的尺寸与已有内容，只能按原尺寸整幅画。 */
  readsCanvas: boolean
  /** 用到的阴影、滤镜都能按比例换算（见 scaleAuthorCanvasEffect）：缩小栅格时画面与原尺寸一致。 */
  scalable: boolean
}

/** 抗锯齿、字形微调留出的设备像素。 */
const EDGE = 2
const TEXT_STATE = ['font', 'letterSpacing', 'wordSpacing', 'fontKerning', 'fontStretch', 'fontVariantCaps', 'textRendering', 'direction', 'lang', 'textAlign', 'textBaseline'] as const
/** 分析用到的状态：开始时取 `measure.reset()` 后的默认值。 */
const TRACKED = [...TEXT_STATE, 'lineWidth', 'lineJoin', 'miterLimit', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'filter'] as const
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const COLOR_FILTERS = new Set(['brightness', 'contrast', 'grayscale', 'hue-rotate', 'invert', 'opacity', 'saturate', 'sepia'])
const multiply = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
const at = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
const number = (value: Value, fallback = 0): number => { const result = Number(value); return Number.isFinite(result) ? result : fallback }
const expand = (box: AuthorCanvasBox, by: number): AuthorCanvasBox => [box[0] - by, box[1] - by, box[2] + by, box[3] + by]
const union = (a: AuthorCanvasBox | null, b: AuthorCanvasBox): AuthorCanvasBox => a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b
const intersect = (a: AuthorCanvasBox, b: AuthorCanvasBox): AuthorCanvasBox => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]
const empty = (box: AuthorCanvasBox): boolean => !(box[2] > box[0] && box[3] > box[1])
/** 局部矩形四角经变换后的外接框。 */
const corners = (m: Matrix, x0: number, y0: number, x1: number, y1: number): AuthorCanvasBox | undefined => {
  let box: AuthorCanvasBox | null = null
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const [px, py] = at(m, x, y)
    if (!Number.isFinite(px) || !Number.isFinite(py)) return undefined
    box = union(box, [px, py, px, py])
  }
  return box!
}
const decodeMatrix = (args: Value[]): Matrix | undefined => {
  const value = args[0]
  const values = value && typeof value === 'object' && 'matrix' in value ? (value as { matrix: number[] }).matrix : args.length ? args.slice(0, 6) : IDENTITY
  return values.length === 6 && values.every(item => typeof item === 'number') ? values as Matrix : undefined
}

interface FilterFunction { name: string; inner: string }
/** 拆开 CSS 滤镜串的顶层函数；认不出的写法（url()、非函数）返回 undefined。 */
function filterFunctions(filter: string): FilterFunction[] | undefined {
  const text = filter.trim()
  if (text === '' || text === 'none') return []
  const result: FilterFunction[] = []
  let index = 0
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index++
    if (index >= text.length) break
    const name = /^[a-z-]+\(/i.exec(text.slice(index))
    if (!name) return undefined
    const open = index + name[0].length - 1
    let depth = 0, close = -1
    for (let cursor = open; cursor < text.length; cursor++) {
      if (text[cursor] === '(') depth++
      else if (text[cursor] === ')' && --depth === 0) { close = cursor; break }
    }
    if (close < 0) return undefined
    const fn = name[0].slice(0, -1).toLowerCase()
    if (fn !== 'blur' && fn !== 'drop-shadow' && !COLOR_FILTERS.has(fn)) return undefined
    result.push({ name: fn, inner: text.slice(open + 1, close) })
    index = close + 1
  }
  return result
}
/** 只认像素长度（和 0）：em、百分比等别的单位换算不了。 */
const length = (token: string): number | undefined => {
  if (token === '0') return 0
  const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)px$/i.exec(token)
  return match ? Number(match[1]) : undefined
}
/** 按顶层空白拆参数（颜色函数里的空格与逗号不拆）。 */
const tokens = (inner: string): string[] => {
  const result: string[] = []
  let depth = 0, current = ''
  for (const char of inner) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth === 0 && /\s/.test(char)) { if (current) result.push(current); current = '' } else current += char
  }
  if (current) result.push(current)
  return result
}
interface DropShadow { x: number; y: number; blur: number; lengths: number[] }
const dropShadow = (inner: string): DropShadow | undefined => {
  const parts = tokens(inner), lengths: number[] = []
  let colors = 0
  for (const part of parts) { const value = length(part); if (value === undefined) colors++; else lengths.push(value) }
  if (lengths.length < 2 || lengths.length > 3 || colors > 1) return undefined
  return { x: lengths[0], y: lengths[1], blur: Math.max(0, lengths[2] ?? 0), lengths }
}
const blurRadius = (inner: string): number | undefined => inner.trim() === '' ? 0 : length(inner.trim())

/** 滤镜作用后的范围：blur 按 3.5 倍标准差外扩，drop-shadow 并上平移、外扩后的影子。认不出返回 undefined。 */
function filtered(filter: string, box: AuthorCanvasBox): AuthorCanvasBox | undefined {
  const functions = filterFunctions(filter)
  if (!functions) return undefined
  for (const fn of functions) {
    if (fn.name === 'blur') {
      const radius = blurRadius(fn.inner)
      if (radius === undefined || radius < 0) return undefined
      box = expand(box, radius * 3.5)
    } else if (fn.name === 'drop-shadow') {
      const shadow = dropShadow(fn.inner)
      if (!shadow) return undefined
      box = union(box, expand([box[0] + shadow.x, box[1] + shadow.y, box[2] + shadow.x, box[3] + shadow.y], shadow.blur * 3.5))
    }
  }
  return box
}

/**
 * Canvas 的阴影（shadowBlur、shadowOffsetX/Y）和 filter 里的长度不随变换缩放（Chromium 实测与规范一致）。按 `sx`、`sy`
 * 缩小栅格时把它们按同一比例换算，画面才与原尺寸栅格后缩小一致。不需要换算的属性原样返回；换算不了返回 undefined。
 */
export function scaleAuthorCanvasEffect(property: string, value: Value, sx: number, sy: number): Value {
  const scale = (sx + sy) / 2
  if (property === 'shadowBlur') { const blur = Number(value); return Number.isFinite(blur) ? blur * scale : value }
  if (property === 'shadowOffsetX') { const offset = Number(value); return Number.isFinite(offset) ? offset * sx : value }
  if (property === 'shadowOffsetY') { const offset = Number(value); return Number.isFinite(offset) ? offset * sy : value }
  if (property !== 'filter') return value
  const functions = filterFunctions(String(value))
  if (!functions) return undefined
  const parts: string[] = []
  for (const fn of functions) {
    if (fn.name === 'blur') {
      const radius = blurRadius(fn.inner)
      if (radius === undefined) return undefined
      parts.push(`blur(${radius * scale}px)`)
    } else if (fn.name === 'drop-shadow') {
      const shadow = dropShadow(fn.inner)
      if (!shadow) return undefined
      const factors = [sx, sy, scale]
      let next = 0
      parts.push(`drop-shadow(${tokens(fn.inner).map(token => { const value = length(token); return value === undefined ? token : `${value * factors[next++]}px` }).join(' ')})`)
    } else parts.push(`${fn.name}(${fn.inner})`)
  }
  return parts.length ? parts.join(' ') : String(value).trim() || 'none'
}

/** 图片参数的宽高：作者位图、画布、录制替身都有 width/height；视频帧用 displayWidth/displayHeight。 */
const imageSize = (value: Value, assetSize: (key: string) => readonly [number, number] | undefined): readonly [number, number] | undefined => {
  if (value && typeof value === 'object' && 'asset' in value) return assetSize(String((value as { asset: unknown }).asset))
  const image = value && typeof value === 'object' && 'live' in value ? (value as unknown as { value: unknown }).value : value
  if (!image || typeof image !== 'object') return undefined
  const source = image as { width?: unknown; height?: unknown; displayWidth?: unknown; displayHeight?: unknown; image?: { width?: unknown; height?: unknown } }
  for (const [width, height] of [[source.width, source.height], [source.displayWidth, source.displayHeight], [source.image?.width, source.image?.height]]) {
    if (typeof width === 'number' && typeof height === 'number' && Number.isFinite(width) && Number.isFinite(height)) return [width, height]
  }
  return undefined
}
const readsCanvasValue = (value: Value): boolean => !!value && typeof value === 'object' && 'canvas' in value && (value as { canvas: unknown }).canvas === true

const cache = new WeakMap<AuthorCanvasRecording, AuthorCanvasContent>()
/**
 * 分析一份录制画到的范围（坐标与录制时相同：静止层就是画布像素）。`measure` 是同一 Worker 里的真实 2D 上下文，
 * 只用来量文字；`measure.reset()` 后读到的状态就是图层开始绘制时的默认状态（与录制相同）。
 */
export function authorCanvasContent(recording: AuthorCanvasRecording, measure: OffscreenCanvasRenderingContext2D, assetSize: (key: string) => readonly [number, number] | undefined = () => undefined): AuthorCanvasContent {
  const cached = cache.get(recording)
  if (cached) return cached
  const result = analyze(recording, measure, assetSize)
  cache.set(recording, result)
  return result
}

function analyze(recording: AuthorCanvasRecording, measure: OffscreenCanvasRenderingContext2D, assetSize: (key: string) => readonly [number, number] | undefined): AuthorCanvasContent {
  let readsCanvas = false, scalable = true, unknown = false
  measure.reset()
  const real = measure as unknown as Record<string, Value>
  const initial: Record<string, Value> = Object.fromEntries(TRACKED.map(key => [key, real[key]]))
  const state: Record<string, Value> = {}
  const read = (key: string): Value => key in state ? state[key] : initial[key]
  let matrix: Matrix = [...IDENTITY]
  let clip: AuthorCanvasBox | undefined
  const stack: Array<{ state: Record<string, Value>; matrix: Matrix; clip?: AuthorCanvasBox }> = []
  let path: AuthorCanvasBox | null = null, pathKnown = true
  let last: [number, number] | undefined, start: [number, number] | undefined
  let painted: AuthorCanvasBox | null = null
  const beginPath = (): void => { path = null; pathKnown = true; last = start = undefined }
  const point = (x: number, y: number): [number, number] | undefined => {
    const [px, py] = at(matrix, x, y)
    if (!Number.isFinite(px) || !Number.isFinite(py)) { pathKnown = false; return undefined }
    path = union(path, [px, py, px, py])
    return [px, py]
  }
  const begin = (x: number, y: number): void => { if (!last) { start = last = point(x, y) } }
  const strokeWidth = (): number => {
    const half = Math.abs(number(read('lineWidth'), 1)) / 2
    const norm = Math.hypot(matrix[0], matrix[1], matrix[2], matrix[3])
    const join = (read('lineJoin') ?? 'miter') === 'miter' ? Math.max(number(read('miterLimit'), 10), Math.SQRT2) : Math.SQRT2
    return half * norm * join
  }
  /** 一次落像素：加上阴影、滤镜、抗锯齿外扩，限在裁剪框里，并进总范围。 */
  const paint = (box: AuthorCanvasBox | undefined): void => {
    if (!box || !box.every(Number.isFinite)) { unknown = true; return }
    const blur = Math.max(0, number(read('shadowBlur'))), dx = number(read('shadowOffsetX')), dy = number(read('shadowOffsetY'))
    if (blur > 0 || dx !== 0 || dy !== 0) box = union(box, expand([box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy], blur * 2))
    const filter = read('filter')
    const withFilter = filter === undefined || filter === 'none' ? box : filtered(String(filter), box)
    if (!withFilter) { unknown = true; return }
    let result = expand(withFilter, EDGE)
    if (clip) result = intersect(result, expand(clip, 1))
    if (!empty(result)) painted = union(painted, result)
  }
  const pathBox = (args: Value[]): AuthorCanvasBox | null | undefined => {
    // Path2D（录成 live 对象）：内容不可见，推不出。
    if (args[0] !== null && typeof args[0] === 'object') return undefined
    return pathKnown ? path : undefined
  }
  const text = (value: Value, x: number, y: number, stroke: boolean): void => {
    for (const key of TEXT_STATE) real[key] = read(key)
    let metrics: TextMetrics | undefined
    try { metrics = measure.measureText(String(value)) } catch { metrics = undefined }
    const left = metrics?.actualBoundingBoxLeft, right = metrics?.actualBoundingBoxRight, ascent = metrics?.actualBoundingBoxAscent, descent = metrics?.actualBoundingBoxDescent
    if (![left, right, ascent, descent, x, y].every(item => typeof item === 'number' && Number.isFinite(item))) { unknown = true; return }
    // maxWidth 只会把字压窄（以对齐点为基准），仍在不压时的范围内。
    const margin = Math.max(EDGE, ((ascent as number) + (descent as number)) * .1)
    const box = corners(matrix, x - left! - margin, y - ascent! - margin, x + right! + margin, y + descent! + margin)
    paint(box && (stroke ? expand(box, strokeWidth()) : box))
  }
  for (const [name, ...args] of recording.ops as Array<[string, ...Value[]]>) {
    if (args.some(readsCanvasValue)) readsCanvas = true
    if (unknown) {
      if (name === 'set' && args[0] === 'filter' && filterFunctions(String(args[1])) === undefined) scalable = false
      continue
    }
    const [a, b, c, d, e, f, g] = args as number[]
    switch (name) {
      case 'set':
        state[args[0] as string] = args[1]
        if (args[0] === 'filter' && filterFunctions(String(args[1])) === undefined) scalable = false
        break
      case 'save': stack.push({ state: { ...state }, matrix: [...matrix], clip }); break
      case 'restore': { const top = stack.pop(); if (top) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, top.state); matrix = top.matrix; clip = top.clip } break }
      case 'reset': for (const key of Object.keys(state)) delete state[key]; matrix = [...IDENTITY]; clip = undefined; stack.length = 0; beginPath(); break
      case 'translate': matrix = multiply(matrix, [1, 0, 0, 1, a, b]); break
      case 'scale': matrix = multiply(matrix, [a, 0, 0, b, 0, 0]); break
      case 'rotate': matrix = multiply(matrix, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); break
      case 'transform': matrix = multiply(matrix, [a, b, c, d, e, f]); break
      case 'setTransform': { const next = decodeMatrix(args); if (next) matrix = [...next]; else unknown = true; break }
      case 'resetTransform': matrix = [...IDENTITY]; break
      case 'beginPath': beginPath(); break
      case 'moveTo': start = last = point(a, b); break
      case 'lineTo': begin(a, b); last = point(a, b); break
      case 'quadraticCurveTo': begin(a, b); point(a, b); last = point(c, d); break
      case 'bezierCurveTo': begin(a, b); point(a, b); point(c, d); last = point(e, f); break
      case 'rect': case 'roundRect': point(a, b); point(a + c, b); point(a, b + d); point(a + c, b + d); start = last = at(matrix, a, b); break
      case 'closePath': last = start; break
      case 'arc': {
        // 圆弧在外接正方形里；接到前一点的线段两端都已计入。
        const radius = Math.abs(c)
        point(a - radius, b - radius); point(a + radius, b - radius); point(a - radius, b + radius); point(a + radius, b + radius)
        const end = at(matrix, a + radius * Math.cos(e), b + radius * Math.sin(e))
        if (!last) start = at(matrix, a + radius * Math.cos(d), b + radius * Math.sin(d))
        last = end; break
      }
      case 'ellipse': {
        const cos = Math.cos(e), sin = Math.sin(e), rx = Math.abs(c), ry = Math.abs(d)
        const local = (u: number, v: number): [number, number] => [a + u * cos - v * sin, b + u * sin + v * cos]
        for (const [u, v] of [[-rx, -ry], [rx, -ry], [-rx, ry], [rx, ry]]) point(...local(u, v))
        if (!last) start = at(matrix, ...local(rx * Math.cos(f), ry * Math.sin(f)))
        last = at(matrix, ...local(rx * Math.cos(g), ry * Math.sin(g))); break
      }
      case 'arcTo': {
        if (!last) { start = last = point(a, b); break }
        // 圆角弧在两个切点与拐点围成的三角形里（切点可能落在线段延长线上）。
        const det = matrix[0] * matrix[3] - matrix[1] * matrix[2]
        if (!det || !Number.isFinite(det)) { pathKnown = false; break }
        const inverse: Matrix = [matrix[3] / det, -matrix[1] / det, -matrix[2] / det, matrix[0] / det, (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / det, (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / det]
        const [x0, y0] = at(inverse, last[0], last[1])
        const v1x = x0 - a, v1y = y0 - b, v2x = c - a, v2y = d - b
        const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y), radius = Math.abs(e)
        point(a, b)
        if (!l1 || !l2 || !radius || Math.abs(v1x * v2y - v1y * v2x) < 1e-9 * l1 * l2) { last = at(matrix, a, b); break }
        const angle = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2))))
        const distance = radius / Math.tan(angle / 2)
        point(a + v1x / l1 * distance, b + v1y / l1 * distance)
        last = point(a + v2x / l2 * distance, b + v2y / l2 * distance); break
      }
      case 'clip': {
        const box = pathBox(args)
        // 裁剪到 Path2D 推不出范围：不收紧（只会偏大）。
        if (box !== undefined) clip = box ? (clip ? intersect(clip, box) : [...box]) : [0, 0, 0, 0]
        break
      }
      case 'fill': { const box = pathBox(args); if (box !== null) paint(box); break }
      case 'stroke': { const box = pathBox(args); if (box !== null) paint(box && expand(box, strokeWidth())); break }
      case 'fillRect': paint(corners(matrix, a, b, a + c, b + d)); break
      case 'strokeRect': { const box = corners(matrix, a, b, a + c, b + d); paint(box && expand(box, strokeWidth())); break }
      case 'fillText': text(args[0], b, c, false); break
      case 'strokeText': text(args[0], b, c, true); break
      case 'drawImage': {
        const rest = args.slice(1) as number[]
        if (rest.length === 2) { const size = imageSize(args[0], assetSize); paint(size && corners(matrix, rest[0], rest[1], rest[0] + size[0], rest[1] + size[1])) }
        else if (rest.length === 4) paint(corners(matrix, rest[0], rest[1], rest[0] + rest[2], rest[1] + rest[3]))
        else if (rest.length === 8) paint(corners(matrix, rest[4], rest[5], rest[4] + rest[6], rest[5] + rest[7]))
        else unknown = true
        break
      }
      default: break
    }
  }
  return { bounds: unknown ? undefined : painted, readsCanvas, scalable }
}
