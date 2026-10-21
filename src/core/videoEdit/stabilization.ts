import { z } from 'zod'
import type { Highs, ModelData } from 'highs'
import { applyVideoEditSimilarity, composeVideoEditSimilarity, invertVideoEditSimilarity, videoEditSimilarityAngle, videoEditSimilarityScale, type VideoEditSimilarity } from './trackTransform'
import type { VideoEditClipPlacement, VideoEditSize } from './clipGeometry'

/*
 * 防抖（对标 PR 变形稳定器的“平滑运动 / 无运动”）：
 * 1. 相机运动：后台跟踪进程逐帧估计背景的相似变换（RANSAC 跳过前景运动物体），累计成相机路径，按素材内容缓存；
 * 2. 平滑：L1 最优相机路径（Grundmann、Kwatra、Essa 2011，YouTube 防抖）——最小化平滑路径一、二、三阶差分的 L1 范数，
 *    约束是裁切窗口的四角经修正后仍落在原画面内（不出黑边），用 HiGHS 线性规划求解；
 * 3. 补偿：每帧按“平滑路径 ∘ 原路径⁻¹”反向变换画面，再统一放大到恰好不露黑边（不超过允许的最大裁切）。
 * 修正是一组相似变换，渲染时与片段自己的位置、缩放、旋转合成，不重新编码素材。
 * 坐标：画面中心为原点、画面高度为单位、y 向下；角度顺时针为正，与合成器一致。
 * 被主进程引用的可能：只用相对路径导入，不依赖 DOM。
 */

export const VIDEO_EDIT_STABILIZATION_SMOOTHNESS = ['subtle', 'natural', 'locked'] as const
export type VideoEditStabilizationSmoothness = (typeof VIDEO_EDIT_STABILIZATION_SMOOTHNESS)[number]
export const VIDEO_EDIT_STABILIZATION_SMOOTHNESS_LABELS: Readonly<Record<VideoEditStabilizationSmoothness, string>> = { subtle: '轻微', natural: '自然', locked: '锁定（无运动）' }

/** 片段上的防抖参数（意图语义）；分析结果按素材内容缓存，不进工程文件。 */
export const videoEditClipStabilizationSchema = z.object({
  /** 平滑程度：subtle 只去掉抖动、保留镜头运动；natural 平滑运动；locked 尽量锁死机位（无运动）。 */
  smoothness: z.enum(VIDEO_EDIT_STABILIZATION_SMOOTHNESS),
  /** 允许的最大裁切比例（画面边长被裁掉的比例，0.02–0.5）；实际只裁到不露黑边为止。 */
  maxCrop: z.number().finite().min(0.02).max(0.5),
  /** 是否校正旋转。 */
  rotation: z.boolean(),
  /** 是否校正缩放（推拉抖动）。 */
  scale: z.boolean(),
}).strict()
export type VideoEditClipStabilization = z.infer<typeof videoEditClipStabilizationSchema>
export const VIDEO_EDIT_STABILIZATION_DEFAULTS: VideoEditClipStabilization = Object.freeze({ smoothness: 'natural', maxCrop: 0.1, rotation: true, scale: true })

/** 一帧的累计相机变换（该帧画面坐标 → 锚定帧坐标）与可信度（背景内点比例）。 */
export interface VideoEditCameraSample { transform: VideoEditSimilarity; confidence: number }
export function videoEditCameraSamples(camera: ReadonlyArray<readonly [number, number, number, number, number]>): VideoEditCameraSample[] {
  return camera.map(([a, b, tx, ty, confidence]) => ({ transform: { a, b, tx, ty }, confidence }))
}

/** 每种平滑程度的 L1 权重：一、二、三阶差分与贴近原路径（fidelity）。 */
const WEIGHTS: Readonly<Record<VideoEditStabilizationSmoothness, { w1: number; w2: number; w3: number; fidelity: number }>> = {
  // 贴近原路径的代价让慢速的镜头运动保留下来，只有高频抖动被削掉。
  subtle: { w1: 1, w2: 10, w3: 100, fidelity: 2 },
  natural: { w1: 1, w2: 20, w3: 200, fidelity: 0.2 },
  locked: { w1: 100, w2: 1, w3: 1, fidelity: 0 },
}
/** 参数分量权重：a、b（缩放与旋转）相对平移的权重；角点距中心约一个画面高度，二者对画面的影响相当。 */
const COMPONENT_WEIGHT = [2, 2, 1, 1]
/** 长片段分窗求解（窗口与重叠，帧）：每窗约 2 万个变量，接缝处固定前一窗的三帧，导数连续。 */
const WINDOW = 900
const OVERLAP = 150

export interface VideoEditStabilizationSolution {
  /** 每帧的修正 B（输出画面坐标 → 原画面坐标，窗口未放大）。 */
  corrections: VideoEditSimilarity[]
  /** 统一放大前的窗口比例：输出画面坐标先乘它再经 B 取原画面。 */
  zoom: number
  /** 实际裁掉的边长比例（各帧最大值）。 */
  crop: number
  /** 线性规划耗时（毫秒）。 */
  solveMs: number
}

/**
 * 求平滑路径。samples 是片段用到的连续帧（≥ 2）；aspect 是画面宽高比。
 * 关闭旋转或缩放校正时，修正不含该分量（原镜头的旋转或缩放原样保留）。
 */
export function solveVideoEditStabilization(highs: Highs, samples: readonly VideoEditCameraSample[], aspect: number, params: VideoEditClipStabilization, now: () => number = () => performance.now()): VideoEditStabilizationSolution {
  const started = now()
  const n = samples.length
  if (n < 2) return { corrections: samples.map(() => ({ a: 1, b: 0, tx: 0, ty: 0 })), zoom: 1, crop: 0, solveMs: 0 }
  // 帧间运动 F_{t+1} = C_t⁻¹ ∘ C_{t+1}（t+1 帧坐标 → t 帧坐标）。
  const motions: VideoEditSimilarity[] = [{ a: 1, b: 0, tx: 0, ty: 0 }]
  for (let t = 1; t < n; t++) motions.push(composeVideoEditSimilarity(invertVideoEditSimilarity(samples[t - 1].transform), samples[t].transform))
  const window = 1 - params.maxCrop
  const corrections: VideoEditSimilarity[] = new Array(n)
  let start = 0; let previous: { start: number; solved: VideoEditSimilarity[] } | undefined
  for (;;) {
    const end = Math.min(n, start + WINDOW)
    const fixed = previous ? previous.solved.slice(start - previous.start, start - previous.start + 3) : []
    const solved = solveWindow(highs, motions.slice(start, end), aspect, window, params, fixed)
    const keep = end === n ? end : end - OVERLAP
    for (let t = start; t < keep; t++) corrections[t] = solved[t - start]
    if (end === n) break
    previous = { start, solved }; start = keep
  }
  // 统一放大到恰好不露黑边：最大的 z 使每帧 B(z·四角) 仍在原画面内（线性规划已保证 z = 1 − maxCrop 可行）。
  let zoom = 1
  const halfW = aspect / 2
  for (const b of corrections) for (const [qx, qy] of [[-halfW, -0.5], [halfW, -0.5], [halfW, 0.5], [-halfW, 0.5]]) {
    const lx = b.a * qx - b.b * qy; const ly = b.b * qx + b.a * qy
    for (const [l, t, limit] of [[lx, b.tx, halfW], [ly, b.ty, 0.5]]) {
      if (l > 1e-12) zoom = Math.min(zoom, (limit - t) / l)
      else if (l < -1e-12) zoom = Math.min(zoom, (-limit - t) / l)
    }
  }
  zoom = Math.max(window - 1e-6, Math.min(1, zoom))
  const crop = Math.max(0, ...corrections.map(b => 1 - zoom * videoEditSimilarityScale(b)))
  return { corrections, zoom, crop: Math.min(1, crop), solveMs: Math.round(now() - started) }
}

/**
 * 一窗线性规划（Grundmann 2011 式 (6)–(8)）：变量为每帧修正 B_t = (a, b, tx, ty)，残差 R_t = F_{t+1}·B_{t+1} − B_t，
 * 最小化 w1·|R| + w2·|ΔR| + w3·|Δ²R|（加贴近原路径项 |B − I|），约束为裁切窗口四角经 B_t 落在原画面内。
 */
function solveWindow(highs: Highs, motions: readonly VideoEditSimilarity[], aspect: number, window: number, params: VideoEditClipStabilization, fixed: readonly VideoEditSimilarity[]): VideoEditSimilarity[] {
  const n = motions.length
  const weights = WEIGHTS[params.smoothness]
  const columns: { cost: number; lower: number; upper: number }[] = []
  const rows: { entries: Array<[number, number]>; lower: number; upper: number }[] = []
  const inf = highs.infinity
  const addColumn = (cost: number, lower: number, upper: number): number => { columns.push({ cost, lower, upper }); return columns.length - 1 }
  // 修正参数的界：旋转约 ±11°；关闭某项校正时固定。
  // 缩放下限 1：裁切窗口经修正后覆盖的画面不小于 1 − 最大裁切（不会为了凑平滑而越裁越多）。
  const bounds = [params.scale ? [1, 1 / window] : [1, 1], params.rotation ? [-0.2, 0.2] : [0, 0], [-inf, inf], [-inf, inf]]
  const p: number[][] = []
  for (let t = 0; t < n; t++) p.push(bounds.map(([lower, upper], k) => t < fixed.length ? addColumn(0, [fixed[t].a, fixed[t].b, fixed[t].tx, fixed[t].ty][k], [fixed[t].a, fixed[t].b, fixed[t].tx, fixed[t].ty][k]) : addColumn(0, lower, upper)))
  /** 残差 R_t 第 k 个分量的线性式：系数表与常数。 */
  const residual = (t: number, k: number): { entries: Array<[number, number]>; constant: number } => {
    const f = motions[t + 1]; const next = p[t + 1]; const current = p[t]
    switch (k) {
      case 0: return { entries: [[next[0], f.a], [next[1], -f.b], [current[0], -1]], constant: 0 }
      case 1: return { entries: [[next[0], f.b], [next[1], f.a], [current[1], -1]], constant: 0 }
      case 2: return { entries: [[next[2], f.a], [next[3], -f.b], [current[2], -1]], constant: f.tx }
      default: return { entries: [[next[2], f.b], [next[3], f.a], [current[3], -1]], constant: f.ty }
    }
  }
  const combine = (terms: Array<{ entries: Array<[number, number]>; constant: number }>, factors: number[]): { entries: Array<[number, number]>; constant: number } => {
    const merged = new Map<number, number>(); let constant = 0
    terms.forEach((term, i) => { constant += term.constant * factors[i]; for (const [column, value] of term.entries) merged.set(column, (merged.get(column) ?? 0) + value * factors[i]) })
    return { entries: [...merged].filter(([, value]) => value !== 0), constant }
  }
  /** |expr| ≤ e：e ≥ 0 的松弛变量，代价 weight。 */
  const absolute = (expr: { entries: Array<[number, number]>; constant: number }, weight: number): void => {
    const e = addColumn(weight, 0, inf)
    rows.push({ entries: [...expr.entries, [e, -1]], lower: -inf, upper: -expr.constant })
    rows.push({ entries: [...expr.entries, [e, 1]], lower: -expr.constant, upper: inf })
  }
  for (let k = 0; k < 4; k++) {
    const c = COMPONENT_WEIGHT[k]
    for (let t = 0; t + 1 < n; t++) absolute(residual(t, k), weights.w1 * c)
    for (let t = 0; t + 2 < n; t++) absolute(combine([residual(t + 1, k), residual(t, k)], [1, -1]), weights.w2 * c)
    for (let t = 0; t + 3 < n; t++) absolute(combine([residual(t + 2, k), residual(t + 1, k), residual(t, k)], [1, -2, 1]), weights.w3 * c)
    if (weights.fidelity) for (let t = 0; t < n; t++) absolute({ entries: [[p[t][k], 1]], constant: k === 0 ? -1 : 0 }, weights.fidelity * c)
  }
  // 裁切窗口四角经 B_t 后在原画面内：|a·qx − b·qy + tx| ≤ A/2，|b·qx + a·qy + ty| ≤ 1/2。
  const qx = aspect / 2 * window; const qy = 0.5 * window
  for (let t = 0; t < n; t++) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = sx * qx; const y = sy * qy
    rows.push({ entries: [[p[t][0], x], [p[t][1], -y], [p[t][2], 1]], lower: -aspect / 2, upper: aspect / 2 })
    rows.push({ entries: [[p[t][0], y], [p[t][1], x], [p[t][3], 1]], lower: -0.5, upper: 0.5 })
  }
  // 按行压缩（CSR）。
  const starts = [0]; const indices: number[] = []; const values: number[] = []
  for (const row of rows) { for (const [column, value] of row.entries) { indices.push(column); values.push(value) } starts.push(indices.length) }
  const model: ModelData = {
    numCols: columns.length, numRows: rows.length,
    colCost: columns.map(c => c.cost), colLower: columns.map(c => c.lower), colUpper: columns.map(c => c.upper),
    rowLower: rows.map(r => r.lower), rowUpper: rows.map(r => r.upper),
    matrix: { format: 'csr', numRows: rows.length, numCols: columns.length, starts, indices, values },
  }
  return highs.withModel(model, solver => {
    solver.options.set({ output_flag: false, presolve: 'on', solver: 'choose' })
    solver.run()
    const status = solver.getModelStatus()
    if (status !== highs.constants.modelStatus.optimal) throw new Error('防抖路径求解失败：允许的裁切不够容纳镜头运动，请加大最大裁切或改用“轻微”。')
    const x = solver.getSolution().colValue
    return p.map(([a, b, tx, ty]) => ({ a: x[a], b: x[b], tx: x[tx], ty: x[ty] }))
  })
}

/** 修正在某一跟踪帧位置（可为小数）的值：相邻两帧线性插值。 */
export function videoEditStabilizationAt(solution: Pick<VideoEditStabilizationSolution, 'corrections'>, position: number): VideoEditSimilarity {
  const list = solution.corrections
  const clamped = Math.max(0, Math.min(list.length - 1, position))
  const i = Math.floor(clamped); const j = Math.min(list.length - 1, i + 1); const t = clamped - i
  const a = list[i]; const b = list[j]
  return { a: a.a + (b.a - a.a) * t, b: a.b + (b.b - a.b) * t, tx: a.tx + (b.tx - a.tx) * t, ty: a.ty + (b.ty - a.ty) * t }
}

/**
 * 画面上的修正 M = (B ∘ 放大)⁻¹（原画面坐标 → 稳定后的画面坐标），关闭缩放校正时缩放归一。
 * 输出点 q 显示原画面 B(zoom·q) 处的内容。
 */
export function videoEditStabilizationPictureTransform(correction: VideoEditSimilarity, zoom: number, params: Pick<VideoEditClipStabilization, 'scale'>): VideoEditSimilarity {
  let b = correction
  if (!params.scale) { const s = videoEditSimilarityScale(b); b = { ...b, a: b.a / s, b: b.b / s } }
  return invertVideoEditSimilarity(composeVideoEditSimilarity(b, { a: zoom, b: 0, tx: 0, ty: 0 }))
}

/**
 * 把画面修正 M 与片段自己的位置、缩放、旋转合成（先 M 再片段变换），锚点不变：
 * 新缩放 = 缩放 × |M|，新旋转 = 旋转 + ∠M，锚点位置按 M 对锚点的移动换算到序列画面。
 */
export function videoEditStabilizedPlacement<T extends VideoEditClipPlacement>(clip: T, picture: VideoEditSize, frame: VideoEditSize, transform: VideoEditSimilarity): T {
  const fit = Math.min(frame.width / Math.max(1, picture.width), frame.height / Math.max(1, picture.height)) * clip.scale
  const angle = clip.rotation * Math.PI / 180
  // 锚点（画面像素，中心为原点）与 M 的平移换成像素。
  const ax = ((clip.anchorX ?? 0.5) - 0.5) * picture.width; const ay = ((clip.anchorY ?? 0.5) - 0.5) * picture.height
  const pixel = { ...transform, tx: transform.tx * picture.height, ty: transform.ty * picture.height }
  const [mx, my] = applyVideoEditSimilarity(pixel, ax, ay)
  const dx = (mx - ax) * fit; const dy = (my - ay) * fit
  const rotation = clip.rotation + videoEditSimilarityAngle(transform) * 180 / Math.PI
  return {
    ...clip,
    x: Math.max(-2, Math.min(2, clip.x + (dx * Math.cos(angle) - dy * Math.sin(angle)) / frame.width)),
    y: Math.max(-2, Math.min(2, clip.y + (dx * Math.sin(angle) + dy * Math.cos(angle)) / frame.height)),
    scale: Math.max(0.01, Math.min(4, clip.scale * videoEditSimilarityScale(transform))),
    rotation: Math.max(-360, Math.min(360, rotation)),
  }
}

/** 残余抖动（对照实测用）：帧间全局平移的方差（画面高度单位²），越小越稳。 */
export function videoEditTranslationJitter(path: readonly VideoEditSimilarity[]): number {
  if (path.length < 3) return 0
  const steps: Array<[number, number]> = []
  for (let t = 1; t < path.length; t++) steps.push([path[t].tx - path[t - 1].tx, path[t].ty - path[t - 1].ty])
  const mean = [steps.reduce((s, v) => s + v[0], 0) / steps.length, steps.reduce((s, v) => s + v[1], 0) / steps.length]
  return steps.reduce((s, v) => s + (v[0] - mean[0]) ** 2 + (v[1] - mean[1]) ** 2, 0) / steps.length
}

/** 修正后的相机路径 P_t = C_t ∘ B_t ∘ 放大（输出画面 → 锚定帧），对照实测与单测用。 */
export function videoEditStabilizedPath(samples: readonly VideoEditCameraSample[], solution: Pick<VideoEditStabilizationSolution, 'corrections' | 'zoom'>): VideoEditSimilarity[] {
  return samples.map((sample, t) => composeVideoEditSimilarity(sample.transform, composeVideoEditSimilarity(solution.corrections[t], { a: solution.zoom, b: 0, tx: 0, ty: 0 })))
}
