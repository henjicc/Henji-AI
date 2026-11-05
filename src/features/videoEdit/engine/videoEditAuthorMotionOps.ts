import type { AuthorCanvasRecording, AuthorTextRun } from './videoEditAuthorCanvasRecorder'

/**
 * 从绘制指令算运动：把相邻帧录制的绘制动作逐个对齐，就知道每个字、每个形状这一帧走了多远，不用猜，也不用看像素。
 * 比较用的都是已经录好的帧：连续播放时不需要为运动模糊多跑一次作者代码。
 *
 * 判断规则：东西真的在动才模糊，内容变了或排版重排了都不算动。
 * - 只变颜色、透明度、数字：位置没变，自然没有位移。
 * - 跳变（换行、切换）：速度和上一帧接不上。
 * - 排版变化：文字换了一份版面，字号没变，每个字走的路又不一样。整段走一样的路是整块在移动，要模糊。
 * - 同一份版面上逐字飞行是动画，要模糊。
 * - 连续的位移、缩放、旋转、形变都模糊。
 * 这些都可以被开关改掉：强制打开时不看跳变和排版变化，关掉时什么都不糊。
 */

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const multiply = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** 一次绘制动作：画到哪（锚点）、多大（范围），身份用来跨录制对齐。 */
interface Paint { index: number; run?: AuthorTextRun; kind: string; key: string; x: number; y: number; width: number; height: number; angle: number; clipped: boolean; shadowed: boolean }
const PATH_POINTS: Record<string, (args: number[]) => Array<[number, number]>> = {
  moveTo: ([x, y]) => [[x, y]], lineTo: ([x, y]) => [[x, y]],
  quadraticCurveTo: ([a, b, x, y]) => [[a, b], [x, y]], bezierCurveTo: ([a, b, c, d, x, y]) => [[a, b], [c, d], [x, y]],
  arcTo: ([a, b, x, y]) => [[a, b], [x, y]],
  rect: ([x, y, w, h]) => [[x, y], [x + w, y + h]], roundRect: ([x, y, w, h]) => [[x, y], [x + w, y + h]],
  arc: ([x, y, r]) => [[x - r, y - r], [x + r, y + r]], ellipse: ([x, y, a, b]) => [[x - a, y - b], [x + a, y + b]],
}
// 旧排版库的轮廓不带字身单位，按常见的 1000 估。
const OUTLINE_UNITS = 1000

// 同一份录制要跟前后两帧各比一次。
const paintLists = new WeakMap<AuthorCanvasRecording, Paint[]>()
const SHADOW_STATE = new Set(['shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'filter'])
function paintsOf(recording: AuthorCanvasRecording): Paint[] {
  const held = paintLists.get(recording)
  if (held) return held
  const paints: Paint[] = [], stack: Array<{ matrix: Matrix; clips: number; fontSize: number; shadowed: boolean; shadow: Record<string, unknown> }> = []
  let shadow: Record<string, unknown> = {}, shadowed = false
  let matrix: Matrix = [...IDENTITY], clips = 0, fontSize = 0, left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  const angle = (): number => Math.atan2(matrix[1], matrix[0])
  const include = (x: number, y: number): void => { const [a, b] = apply(matrix, x, y); left = Math.min(left, a); top = Math.min(top, b); right = Math.max(right, a); bottom = Math.max(bottom, b) }
  const box = (index: number, key: string, x: number, y: number, width: number, height: number): void => {
    const corners = [apply(matrix, x, y), apply(matrix, x + width, y), apply(matrix, x, y + height), apply(matrix, x + width, y + height)]
    const xs = corners.map(point => point[0]), ys = corners.map(point => point[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    paints.push({ index, kind: key.split(':')[0], key, x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY, angle: 0, clipped: clips > 0, shadowed })
  }
  for (const [index, op] of recording.ops.entries()) {
    const name = op[0] as string, args = op.slice(1) as number[]
    if (name === 'translate') matrix = multiply(matrix, [1, 0, 0, 1, args[0], args[1]])
    else if (name === 'scale') matrix = multiply(matrix, [args[0], 0, 0, args[1], 0, 0])
    else if (name === 'rotate') matrix = multiply(matrix, [Math.cos(args[0]), Math.sin(args[0]), -Math.sin(args[0]), Math.cos(args[0]), 0, 0])
    else if (name === 'transform') matrix = multiply(matrix, args as unknown as Matrix)
    else if (name === 'setTransform') matrix = typeof args[0] === 'number' ? args.slice(0, 6) as unknown as Matrix : matrixFrom(args[0])
    else if (name === 'resetTransform') matrix = [...IDENTITY]
    else if (name === 'save') stack.push({ matrix, clips, fontSize, shadowed, shadow })
    else if (name === 'restore') { const top = stack.pop(); if (top) { matrix = top.matrix; clips = top.clips; fontSize = top.fontSize; shadowed = top.shadowed; shadow = top.shadow } }
    else if (name === 'clip') clips++
    else if (name === 'set' && (typeof op[1] === 'string' && SHADOW_STATE.has(op[1]))) {
      shadow = { ...shadow, [op[1]]: op[2] }
      shadowed = !!shadow.filter && shadow.filter !== 'none' || !!shadow.shadowColor && (!!shadow.shadowBlur || !!shadow.shadowOffsetX || !!shadow.shadowOffsetY)
    } else if (name === 'set' && op[1] === 'font') fontSize = Number(/([\d.]+)px/.exec(String(op[2]))?.[1] ?? 0)
    else if (name === 'beginPath') { left = top = Infinity; right = bottom = -Infinity }
    else if (PATH_POINTS[name]) for (const [x, y] of PATH_POINTS[name](args)) include(x, y)
    else if (name === 'fillRect' || name === 'strokeRect') box(index, name, args[0], args[1], args[2], args[3])
    else if (name === 'textAppearance') box(index, `${name}:${identityOf(op[1])}`, args[1], args[2], args[3], args[4])
    else if (name === 'drawImage') {
      const image = op[1] as { width?: number; height?: number } | null, rest = op.slice(2) as number[]
      const [x, y, width, height] = rest.length === 8 ? rest.slice(4) : rest.length === 4 ? rest : [rest[0], rest[1], image?.width ?? 0, image?.height ?? 0]
      box(index, `${name}:${identityOf(op[1])}`, x, y, width, height)
    } else if (name === 'fillText' || name === 'strokeText') box(index, `${name}:${String(op[1])}`, Number(op[2]), Number(op[3]), fontSize, fontSize)
    else if (name === 'fill' || name === 'stroke') {
      const outline = op[1] !== null && typeof op[1] === 'object' ? identityOf(op[1]) : undefined
      if (outline !== undefined) {
        const [x, y] = apply(matrix, 0, 0), em = (op[1] as { em?: number }).em ?? OUTLINE_UNITS
        paints.push({ index, kind: `${name}:outline`, key: `${name}:${outline}`, x, y, width: Math.hypot(matrix[0], matrix[1]) * em, height: Math.hypot(matrix[2], matrix[3]) * em, angle: angle(), clipped: clips > 0, shadowed })
      } else if (right >= left) paints.push({ index, kind: name, key: name, x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top, angle: 0, clipped: clips > 0, shadowed })
      else paints.push({ index, kind: name, key: name, x: 0, y: 0, width: 0, height: 0, angle: 0, clipped: clips > 0, shadowed })
    }
  }
  for (const run of recording.textRuns ?? []) for (const paint of paints) if (paint.index >= run.start && paint.index < run.end) paint.run = run
  paintLists.set(recording, paints)
  return paints
}
const matrixFrom = (value: unknown): Matrix => {
  const m = (value as { matrix?: Matrix } | undefined)?.matrix
  return m ? [...m] as Matrix : [...IDENTITY]
}
// Path2D 每帧新建也是同一个形状：不比身份，只按顺序对齐，位移看变换。
const identityOf = (value: unknown): string => {
  const record = value as { outline?: string; appearance?: string; id?: number; asset?: string } | null
  return String(record?.outline ?? record?.appearance ?? record?.asset ?? record?.id ?? '')
}
const readsLiveCanvas = (op: readonly unknown[]): boolean => (op[0] === 'drawImage' && !!(op[1] as { live?: unknown } | null)?.live) || (op[0] === 'pattern' && !!(op[2] as { live?: unknown } | null)?.live)
/** 作者自己的离屏画布按活引用录制，重放时才读内容；为比较多录一遍会把它改到别的时刻，这种图层不比较。 */
export const authorRecordingMeasurable = (recording: AuthorCanvasRecording): boolean => !recording.ops.some(readsLiveCanvas)

/** 换了内容还算同一个：同类动作、大小相近（滚动的数字）。换一张大小悬殊的图是换画面，不是在动。 */
const sameSlot = (a: Paint, b: Paint): boolean => {
  if (a.key === b.key) return true
  if (a.kind !== b.kind) return false
  const near = (x: number, y: number): boolean => Math.max(x, y) <= Math.min(x, y) * 1.5 + 1
  return near(a.width, b.width) && near(a.height, b.height)
}
/** 两张绘制清单逐个对齐：相同身份按顺序配对；错峰显现时一边多几个字，往后找一小段再接上；都找不到是这个位置换了内容（滚动的数字），还算同一个。 */
function align(from: readonly Paint[], to: readonly Paint[]): Map<Paint, Paint> {
  const pairs = new Map<Paint, Paint>()
  // 个数相同就是同一批内容，按顺序对应：滚动的数字每帧换字形，按身份找会错位到别的数字上。
  if (from.length === to.length) {
    from.forEach((paint, index) => { if (sameSlot(paint, to[index])) pairs.set(paint, to[index]) })
    return pairs
  }
  let i = 0, j = 0
  const WINDOW = 64
  while (i < from.length && j < to.length) {
    if (from[i].key === to[j].key) { pairs.set(from[i], to[j]); i++; j++; continue }
    let skipTo = -1, skipFrom = -1
    for (let step = 1; step <= WINDOW; step++) {
      if (skipTo < 0 && j + step < to.length && to[j + step].key === from[i].key) skipTo = step
      if (skipFrom < 0 && i + step < from.length && from[i + step].key === to[j].key) skipFrom = step
      if (skipTo >= 0 || skipFrom >= 0) break
    }
    if (skipTo >= 0 && (skipFrom < 0 || skipTo <= skipFrom)) j += skipTo
    else if (skipFrom >= 0) i += skipFrom
    else { if (sameSlot(from[i], to[j])) pairs.set(from[i], to[j]); i++; j++ }
  }
  return pairs
}

/**
 * 真正的运动是连续的：这一帧的速度和上一帧差不多。文字重新折行时，字一下跳到别的行，速度毫无连续性，那是排版变了，
 * 不是东西在飞；照位移拖影，整段字就会朝四面八方糊开。差得太多的不算运动。起步那一帧因此不拖影，看不出来。
 */
const CONTINUITY = .66
/**
 * 字的拖影不超过自身大小的这个比例。物理上一个字飞快走时拖得比自己长得多，单看是对的，但一整段字各走各的，拖影交错，
 * 画面就成了一团乱飞的线；压到比字短，字形还在，只是带一点方向感。卡片、图片不会这样，按真实速度走。
 */
const STREAK_LIMIT = .35
const isText = (paint: Paint): boolean => !!paint.run || paint.kind.endsWith(':outline') || paint.kind === 'fillText' || paint.kind === 'strokeText' || paint.kind === 'textAppearance'
/** 排版变化时每个字走的路差得比这多（像素、比例取大的），才算不是整段一起走。 */
const UNIFORM_PX = 1
const UNIFORM_RATIO = .1
/** 比这短的路看不出拖影，只会把字弄软。 */
const MOVING = 1
/** 走这么点路不用查连续性：缓动的开头和结尾速度比例变化大，但本来就糊不到哪去。 */
const ALWAYS_CONTINUOUS = 4

export interface AuthorPaintMotion {
  /** 绘制动作在录制里的指令序号 → 这次曝光里走过的位移（画布像素）。不在表里的是静止的。 */
  moves: Map<number, readonly [number, number]>
  /** 全部绘制动作的指令序号，按绘制顺序。 */
  paints: number[]
  /** 不能当成整块平移：形状在变形（缩放、拉伸、旋转），动的内容被裁剪着（拖影不能越过裁剪），或者带阴影、滤镜（它们得一起拖）。 */
  deforming: boolean
  /** 走得最远的距离。 */
  longest: number
  /** 一帧之内内容可能超出当前范围多远（画布像素）。 */
  reach: number
  /** 拖影短于物理长度的绘制动作 → 比例：限了长的按比例缩，跳过去的（文字折行）是 0。不在表里的按 1。 */
  scales: Map<number, number>
  /** 边缘这次曝光最远走了多远（含变形），决定累加几次。 */
  span: number
}

/** 这一层的开关：`on` 不开时只有单独声明要模糊的文字才算；`forced` 强制打开，不看跳变和排版变化。 */
export interface AuthorMotionPolicy { on: boolean; forced: boolean }
const AUTO_POLICY: AuthorMotionPolicy = { on: true, forced: false }
/** 换了版面的文字段里，哪些是真的重新排版：字号没变，每个字走的路不一样。 */
function relaidRuns(paints: readonly Paint[], pairs: Map<Paint, Paint>, gap: number): Set<AuthorTextRun> {
  const speeds = new Map<AuthorTextRun, Array<readonly [number, number]>>(), scaled = new Set<AuthorTextRun>()
  for (const paint of paints) {
    const before = pairs.get(paint), run = paint.run
    if (!run || !before?.run || before.run.layout === run.layout) continue
    if (Math.abs(before.width - paint.width) + Math.abs(before.height - paint.height) > UNIFORM_PX) scaled.add(run)
    const list = speeds.get(run) ?? []
    list.push([(paint.x - before.x) / gap, (paint.y - before.y) / gap]); speeds.set(run, list)
  }
  const relaid = new Set<AuthorTextRun>()
  for (const [run, list] of speeds) {
    if (scaled.has(run)) continue
    const middle = (axis: 0 | 1): number => list.map(value => value[axis]).sort((a, b) => a - b)[list.length >> 1]
    const x = middle(0), y = middle(1), allowed = Math.max(UNIFORM_PX, Math.hypot(x, y) * UNIFORM_RATIO)
    if (list.some(value => Math.hypot(value[0] - x, value[1] - y) > allowed)) relaid.add(run)
  }
  return relaid
}

/**
 * `previous`、`older`：更早两个时刻的录制（older 只用来看速度连不连续）；`exposure`：快门占一帧的比例。
 * `gap`、`olderGap`：它们离这一帧几帧。掉帧时隔的不止一帧，倒放时是负数，按帧数折算成每帧的速度。
 */
export function authorPaintMotion(center: AuthorCanvasRecording, previous: AuthorCanvasRecording, older: AuthorCanvasRecording | undefined, exposure: number, gap = 1, olderGap = 2, policy: AuthorMotionPolicy = AUTO_POLICY): AuthorPaintMotion {
  const paints = paintsOf(center), earlier = paintsOf(previous), toPrevious = align(paints, earlier), toOlder = older ? align(earlier, paintsOf(older)) : undefined
  const moves = new Map<number, readonly [number, number]>()
  const scales = new Map<number, number>(), relaid = policy.forced ? new Set<AuthorTextRun>() : relaidRuns(paints, toPrevious, gap)
  let deforming = false, longest = 0, reach = 0, span = 0
  for (const paint of paints) {
    const before = toPrevious.get(paint)
    const on = paint.run?.motionBlur ?? policy.on, forced = paint.run?.motionBlur === true || policy.forced && paint.run?.motionBlur !== false
    if (!on) { scales.set(paint.index, 0); continue }
    if (!before) continue
    if (!forced && paint.run && relaid.has(paint.run)) { scales.set(paint.index, 0); continue }
    const speedX = (paint.x - before.x) / gap, speedY = (paint.y - before.y) / gap, framePath = Math.hypot(speedX, speedY)
    const turn = Math.abs(Math.atan2(Math.sin(paint.angle - before.angle), Math.cos(paint.angle - before.angle)))
    const growth = (Math.abs(before.width - paint.width) + Math.abs(before.height - paint.height) + turn * Math.max(paint.width, paint.height) / 2) / Math.abs(gap)
    // 作者函数在片段开头之前可能算出 NaN：那一刻不算有内容。
    if (!Number.isFinite(framePath) || !Number.isFinite(growth)) continue
    const oldest = toOlder?.get(before)
    // 换了内容又没有更早的一帧可比，分不出是在动还是换了个地方。
    if (!forced && !oldest && paint.key !== before.key) { scales.set(paint.index, 0); continue }
    if (!forced && oldest && framePath >= ALWAYS_CONTINUOUS && Math.hypot(speedX - (before.x - oldest.x) / (olderGap - gap), speedY - (before.y - oldest.y) / (olderGap - gap)) > framePath * CONTINUITY) { scales.set(paint.index, 0); continue }
    const physical = framePath * exposure, size = Math.max(paint.width, paint.height), limit = isText(paint) && size > 0 ? size * STREAK_LIMIT : Infinity
    const scale = physical > limit ? limit / physical : 1, distance = physical * scale
    reach = Math.max(reach, framePath + growth)
    if (scale < 1) scales.set(paint.index, scale)
    span = Math.max(span, distance + growth * exposure)
    // 边缘多走的路比整块位移还长，就是在变形。
    if (growth * exposure > Math.max(3, distance)) deforming = true
    if (distance < MOVING) continue
    if (paint.clipped || paint.shadowed) deforming = true
    moves.set(paint.index, [speedX * exposure * scale, speedY * exposure * scale]); longest = Math.max(longest, distance)
  }
  return { moves, scales, paints: paints.map(paint => paint.index), deforming, longest, reach, span }
}

// 只有几何是连续的；渐变色标、颜色、文字这些取 b 的。外插出的数字不能抛错：透明度越界会被忽略，半径为负会抛错。
const GEOMETRY_OPS = new Set(['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage', 'textAppearance', 'translate', 'scale', 'rotate', 'transform', 'setTransform'])
const NON_NEGATIVE: Record<string, readonly number[]> = { arc: [3], ellipse: [3, 4], arcTo: [5], roundRect: [5] }

/** 两次录制逐条相同形状时，几何线性插值就是快门内任意时刻的指令，不必再跑作者代码。`amount` 可以略超出 0 到 1；图片、颜色等都按 b。 */
export function authorInterpolateRecording(a: AuthorCanvasRecording, b: AuthorCanvasRecording, amountAt: number | ((op: number) => number)): AuthorCanvasRecording | undefined {
  if (a.ops.length !== b.ops.length) return undefined
  const ops: AuthorCanvasRecording['ops'] = []
  let amount = typeof amountAt === 'number' ? amountAt : 1
  const mix = (left: unknown, right: unknown): unknown => {
    if (typeof left === 'number' && typeof right === 'number') { const value = left + (right - left) * amount; return Number.isFinite(value) ? value : right }
    const m = (left as { matrix?: number[] } | null)?.matrix, n = (right as { matrix?: number[] } | null)?.matrix
    return m && n ? { matrix: m.map((value, index) => value + (n[index] - value) * amount) } : right
  }
  for (let index = 0; index < a.ops.length; index++) {
    const left = a.ops[index], right = b.ops[index], name = right[0] as string
    if (typeof amountAt === 'function') amount = amountAt(index)
    if (left[0] !== name || left.length !== right.length) return undefined
    if (name === 'set' && right[1] === 'globalAlpha') { ops.push(['set', 'globalAlpha', Math.max(0, Math.min(1, mix(left[2], right[2]) as number))]); continue }
    if (!GEOMETRY_OPS.has(name)) { ops.push(right); continue }
    const op = right.map((value, arg) => arg === 0 ? value : mix(left[arg], value)) as typeof right
    for (const arg of NON_NEGATIVE[name] ?? []) if (typeof op[arg] === 'number') op[arg] = Math.max(0, op[arg] as number)
    ops.push(op)
  }
  return { ...b, ops }
}

/**
 * 快门内 `offset` 帧处的录制：每个绘制动作按自己的比例走，变换和路径指令跟着它后面那个绘制动作。
 * 同一组里字限了长、卡片没限，字折行时不动而卡片照样糊，都靠这个。drawText 每个字有自己的变换；作者把一个变换共用给大小悬殊的内容时，按它后面第一个动作算。
 */
export function authorSampleRecording(previous: AuthorCanvasRecording, center: AuthorCanvasRecording, motion: Pick<AuthorPaintMotion, 'paints' | 'scales'>, offset: number, gap: number): AuthorCanvasRecording | undefined {
  const scaleOf = new Float64Array(center.ops.length).fill(1)
  let start = 0
  for (const paint of motion.paints) { scaleOf.fill(motion.scales.get(paint) ?? 1, start, paint + 1); start = paint + 1 }
  return authorInterpolateRecording(previous, center, op => 1 + offset * scaleOf[op] / gap)
}

/** 按绘制顺序切成静止段和运动段，每段单独栅格：运动的字才不会把压在下面的静止内容带走。段数有上限，多出来的并进最后一段。 */
export function authorMotionRuns(motion: Pick<AuthorPaintMotion, 'moves' | 'paints'>, limit: number): Array<{ moving: boolean; paints: Set<number> }> {
  const runs: Array<{ moving: boolean; paints: Set<number> }> = []
  for (const paint of motion.paints) {
    const moving = motion.moves.has(paint), last = runs.at(-1)
    if (last && (last.moving === moving || runs.length >= limit)) { last.paints.add(paint); last.moving ||= moving }
    else runs.push({ moving, paints: new Set([paint]) })
  }
  return runs
}
