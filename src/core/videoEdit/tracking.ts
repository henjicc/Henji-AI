import { z } from 'zod'
import { videoEditClipPixelScale, videoEditClipToFrame, type VideoEditClipPlacement, type VideoEditSize } from './clipGeometry'
import { processSmartRegionMatte, rasterizeSmartRegionBoxes, smartRegionMaskSize, SMART_REGION_FORMAT_VERSION, type SmartRegionBox, type SmartRegionMaskParams } from './smartRegions'
import { rasterizeVideoEditMaskShapes } from './effectMasks'

/*
 * 跟踪器（任务 4.10，实施方案第七节：跟踪 = 区域 + 方式 + 结果 + 绑定）。
 * - 区域与方式存在片段上（`clip.trackers`）：方式 + 若干提示帧（点选、框选，可在中途帧补点纠错）；
 * - 结果在后台算好、按素材内容缓存在程序目录（与 4.7d 智能区域同一种容器格式），按跟踪定义引用；
 * - 绑定：效果的作用区域选“跟踪”（形状跟踪直接是逐帧遮罩，物体框跟踪是逐帧矩形）、手绘遮罩跟随、片段跟随（位置、缩放）。
 * 坐标一律是片段画面的归一化坐标，时间是素材绝对时钟的微秒（与片段入点同一时钟）。
 * 被主进程引用：只用相对路径导入，不依赖 DOM。
 */

/** shape/box 用本地模型；point/planar 用后台 OpenCV 金字塔 LK 与 RANSAC，无需下载模型。 */
export const VIDEO_EDIT_TRACK_METHODS = ['shape', 'box', 'point', 'planar'] as const
export type VideoEditTrackMethod = (typeof VIDEO_EDIT_TRACK_METHODS)[number]
export const VIDEO_EDIT_TRACK_METHOD_LABELS: Readonly<Record<VideoEditTrackMethod, string>> = { shape: '形状跟踪', box: '物体框跟踪', point: '点跟踪', planar: '平面跟踪' }
/** Per-clip live matte/geometry analysis budget, shared with rendering and background model preparation. */
export const VIDEO_EDIT_MAX_TRACKERS = 8
/** Per-request inference prompt budget; limits simultaneous model/optical-flow seed state, not project size. */
export const VIDEO_EDIT_MAX_TRACK_PROMPTS = 16
/** 跟踪分析的帧率上限（形状跟踪每帧约 12 ms，30 帧足够跟住；播放时框按相邻两帧插值）。 */
export const VIDEO_EDIT_TRACK_FPS_LIMIT = 30

const unit = z.number().finite().min(0).max(1)
const size = z.number().finite().min(0.002).max(1)
/** 提示点：x、y 与正负（1 选中这里，0 排除这里）。 */
export const videoEditTrackPointSchema = z.tuple([unit, unit, z.union([z.literal(0), z.literal(1)])])
export const videoEditTrackBoxSchema = z.tuple([unit, unit, size, size])
export type VideoEditTrackBoxPrompt = z.infer<typeof videoEditTrackBoxSchema>
export const videoEditTrackQuadSchema = z.tuple([z.tuple([unit, unit]), z.tuple([unit, unit]), z.tuple([unit, unit]), z.tuple([unit, unit])]).refine(isVideoEditTrackQuad, '四角需按顺时针或逆时针排列，不能交叉或退化。')
export type VideoEditTrackQuad = [[number, number], [number, number], [number, number], [number, number]]
/** Convex, consistently ordered corners; tracked results may extend beyond the picture. */
export function isVideoEditTrackQuad(quad: readonly (readonly number[])[]): boolean {
  if (quad.length !== 4 || quad.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v)))) return false
  const crosses = quad.map((a, i) => { const b = quad[(i + 1) % 4]; const c = quad[(i + 2) % 4]; return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) })
  return crosses.every(v => v > 1e-8) || crosses.every(v => v < -1e-8)
}

export const videoEditTrackPromptSchema = z.object({
  /** 提示所在的素材时间（微秒，素材绝对时钟；按跟踪帧率取最近的一帧）。 */
  timeUs: z.number().int().nonnegative().max(4 * 3600 * 1e6),
  points: z.array(videoEditTrackPointSchema).min(1).max(16).optional(),
  box: videoEditTrackBoxSchema.optional(),
  /** Planar corners: top-left, top-right, bottom-right, bottom-left, in picture coordinates. */
  quad: videoEditTrackQuadSchema.optional(),
  /** AE feature/search boxes, as fractions of picture height; shared by 1–4 points. */
  window: z.object({ feature: z.number().min(0.01).max(0.3), search: z.number().min(0.02).max(0.8) }).strict().refine(v => v.search >= v.feature, '搜索框不能小于特征框。').optional(),
  /** 只点了一个点时，从模型给出的 3 个候选里选第几个（1–3，小到大是“局部、物体、整体”的常见顺序）；不写由模型挑最可信的。 */
  candidate: z.number().int().min(1).max(3).optional(),
}).strict().superRefine((prompt, ctx) => {
  if (!prompt.points && !prompt.box && !prompt.quad) ctx.addIssue({ code: 'custom', message: '每个提示至少要有 points（点选）、box（框选）或 quad（四角）。' })
  if (prompt.candidate !== undefined && (prompt.box || prompt.points?.length !== 1)) ctx.addIssue({ code: 'custom', message: 'candidate 只用于只点了一个点的提示。' })
})
export type VideoEditTrackPrompt = z.infer<typeof videoEditTrackPromptSchema>

export const videoEditTrackerSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(60),
  method: z.enum(VIDEO_EDIT_TRACK_METHODS),
  prompts: z.array(videoEditTrackPromptSchema).min(1).max(VIDEO_EDIT_MAX_TRACK_PROMPTS),
}).strict().superRefine((tracker, ctx) => {
  if (tracker.method === 'box' && tracker.prompts.some(prompt => !prompt.box)) ctx.addIssue({ code: 'custom', message: '物体框跟踪的每个提示都要有 box（框住要跟踪的物体）。' })
  if ((tracker.method === 'box' || tracker.method === 'shape') && tracker.prompts.some(p=>p.quad || p.window)) ctx.addIssue({code:'custom',message:'quad 用于平面跟踪，window 用于点跟踪；形状与物体框提示不使用这两个字段。'})
  if (tracker.method === 'point' && tracker.prompts.some(p => !p.points || p.points.length > 4 || p.points.some(point => point[2] !== 1) || p.box || p.quad || p.candidate)) ctx.addIssue({ code: 'custom', message: '点跟踪每帧提示需要 1–4 个正向 points，不使用 box、quad 或 candidate。' })
  if (tracker.method === 'point' && tracker.prompts.some(p => p.points?.length !== tracker.prompts[0].points?.length)) ctx.addIssue({ code: 'custom', message: '点纠错需保留原有点的数量与顺序。' })
  if (tracker.method === 'planar' && tracker.prompts.some(p => !p.quad || p.points || p.box || p.candidate)) ctx.addIssue({ code: 'custom', message: '平面跟踪每帧提示需要 quad 四角，不使用 points、box 或 candidate。' })
  if (new Set(tracker.prompts.map(prompt => prompt.timeUs)).size !== tracker.prompts.length) ctx.addIssue({ code: 'custom', message: '同一时间只能有一个提示，要改提示请替换那一项。' })
})
export type VideoEditTracker = z.infer<typeof videoEditTrackerSchema>

/** 提示按时间排序（定义的规范形态：结果缓存的键与它一致）。 */
export function normalizeVideoEditTracker(tracker: VideoEditTracker): VideoEditTracker {
  return { ...tracker, prompts: [...tracker.prompts].sort((a, b) => a.timeUs - b.timeUs) }
}

// ==================== 帧网格 ====================

export function videoEditTrackFps(mediaFps: number | undefined): number {
  return Math.max(1, Math.min(VIDEO_EDIT_TRACK_FPS_LIMIT, mediaFps && Number.isFinite(mediaFps) && mediaFps > 0 ? mediaFps : 30))
}
/** 素材绝对时钟上的第几帧（跟踪结果按这个网格存）。 */
export function videoEditTrackFrame(timeUs: number, fps: number): number { return Math.round(timeUs * fps / 1e6) }
export function videoEditTrackFrameTime(frame: number, fps: number): number { return Math.round(frame * 1e6 / fps) }

/** 渲染层与 Worker 用来对上结果的键：同一素材、同一方式、同样的提示 = 同一份结果。 */
export function videoEditTrackerKey(mediaId: string, tracker: Pick<VideoEditTracker, 'method' | 'prompts'>): string {
  return JSON.stringify([mediaId, tracker.method, [...tracker.prompts].sort((a, b) => a.timeUs - b.timeUs)])
}

// ==================== 结果文件（与 4.7d 智能区域同一种容器：JSON 头 + 帧索引 + 每帧 deflate 数据） ====================

/** 一帧的框：片段画面归一化 x、y、宽、高与可信度；跟丢的帧为 null。 */
export type VideoEditTrackBox = readonly [number, number, number, number, number]
/** 形状跟踪每帧记录：可信度（float32）+ 目标指针 256 个 float32 + 128×128 的 int8 掩码 logit（× 4）。 */
export const VIDEO_EDIT_TRACK_LOGIT_SIZE = 128
export const VIDEO_EDIT_TRACK_POINTER_SIZE = 256
export const VIDEO_EDIT_TRACK_LOGIT_SCALE = 4
const RECORD_HEADER_BYTES = 4 + VIDEO_EDIT_TRACK_POINTER_SIZE * 4

export interface VideoEditTrackHeader {
  version: number
  kind: 'track'
  method: VideoEditTrackMethod
  /** 实际使用的模型（efficienttam / vittrack），只用于日志。 */
  model: string
  fps: number
  /** 第一帧在帧网格上的编号与连续帧数。 */
  firstFrame: number
  frameCount: number
  /** 显示画面尺寸（已按旋转与像素比换算）。 */
  sourceWidth: number
  sourceHeight: number
  /** 提示帧（帧网格编号）：这些帧是用户给的，其余是跟踪出来的。 */
  promptFrames: number[]
  /** 每帧的框（形状跟踪由掩码外接框得出）；跟丢为 null。 */
  boxes: Array<VideoEditTrackBox | null>
  /** 形状跟踪：每帧记录的 logit 尺寸。 */
  logits?: { width: number; height: number; scale: number }
  summary: { tracked: number; lost: number }
}

export function createVideoEditTrackHeader(header: Omit<VideoEditTrackHeader, 'version' | 'kind'>): VideoEditTrackHeader {
  return { version: SMART_REGION_FORMAT_VERSION, kind: 'track', ...header }
}

export interface VideoEditTrackShapeRecord { score: number; pointer: Float32Array; logits: Int8Array }

export interface VideoEditTrackGeometryRecord {
  points?: Array<[number, number, number]>
  quad?: VideoEditTrackQuad
  /** Row-major mapping from the governing prompt quad to this frame, normalized picture coordinates. */
  homography?: number[]
  confidence: number
}
export function encodeVideoEditTrackGeometry(record: VideoEditTrackGeometryRecord): Uint8Array { return new TextEncoder().encode(JSON.stringify(record)) }
export function decodeVideoEditTrackGeometry(bytes: Uint8Array): VideoEditTrackGeometryRecord {
  return z.object({ points: z.array(z.tuple([z.number().finite(), z.number().finite(), unit])).min(1).max(4).optional(), quad: z.array(z.tuple([z.number().finite(), z.number().finite()])).length(4).refine(isVideoEditTrackQuad).optional(), homography: z.array(z.number().finite()).length(9).optional(), confidence: unit }).strict().parse(JSON.parse(new TextDecoder().decode(bytes))) as VideoEditTrackGeometryRecord
}
export function videoEditTrackProject(matrix: readonly number[], x: number, y: number): [number, number] {
  const w = matrix[6] * x + matrix[7] * y + matrix[8]
  return [(matrix[0] * x + matrix[1] * y + matrix[2]) / w, (matrix[3] * x + matrix[4] * y + matrix[5]) / w]
}
export function invertVideoEditTrackMatrix(m: readonly number[]): number[] {
  const [a,b,c,d,e,f,g,h,i]=m
  const adj=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d]
  const determinant=a*adj[0]+b*adj[3]+c*adj[6]
  if (!Number.isFinite(determinant) || Math.abs(determinant)<1e-12) throw new Error('透视四角已退化，请重新选取平面。')
  return adj.map(v=>v/determinant)
}
/** Exact four-corner geometry (no estimation): unit image square → normalized destination quad. */
export function videoEditCornerPinMatrix(quad: VideoEditTrackQuad): number[] {
  if (!isVideoEditTrackQuad(quad)) throw new Error('角点贴合需要有效的四边形。')
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] = quad
  const dx1=x1-x2; const dx2=x3-x2; const dx3=x0-x1+x2-x3
  const dy1=y1-y2; const dy2=y3-y2; const dy3=y0-y1+y2-y3
  const d=dx1*dy2-dx2*dy1
  const g=(dx3*dy2-dx2*dy3)/d; const h=(dx1*dy3-dx3*dy1)/d
  return [x1-x0+g*x1, x3-x0+h*x3, x0, y1-y0+g*y1, y3-y0+h*y3, y0, g, h, 1]
}

export function encodeVideoEditTrackRecord(record: { score: number; pointer: Float32Array; logits: Float32Array | Int8Array }): Uint8Array {
  const output = new Uint8Array(RECORD_HEADER_BYTES + record.logits.length)
  const view = new DataView(output.buffer)
  view.setFloat32(0, record.score, true)
  for (let index = 0; index < VIDEO_EDIT_TRACK_POINTER_SIZE; index++) view.setFloat32(4 + index * 4, record.pointer[index] ?? 0, true)
  const logits = record.logits instanceof Int8Array ? record.logits : quantizeVideoEditTrackLogits(record.logits)
  output.set(new Uint8Array(logits.buffer, logits.byteOffset, logits.byteLength), RECORD_HEADER_BYTES)
  return output
}
export function decodeVideoEditTrackRecord(bytes: Uint8Array): VideoEditTrackShapeRecord {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const pointer = new Float32Array(VIDEO_EDIT_TRACK_POINTER_SIZE)
  for (let index = 0; index < pointer.length; index++) pointer[index] = view.getFloat32(4 + index * 4, true)
  return { score: view.getFloat32(0, true), pointer, logits: new Int8Array(bytes.slice(RECORD_HEADER_BYTES).buffer) }
}
export function quantizeVideoEditTrackLogits(logits: Float32Array): Int8Array {
  const output = new Int8Array(logits.length)
  for (let index = 0; index < logits.length; index++) output[index] = Math.max(-127, Math.min(127, Math.round(logits[index] * VIDEO_EDIT_TRACK_LOGIT_SCALE)))
  return output
}
export function dequantizeVideoEditTrackLogits(logits: Int8Array): Float32Array {
  const output = new Float32Array(logits.length)
  for (let index = 0; index < logits.length; index++) output[index] = logits[index] / VIDEO_EDIT_TRACK_LOGIT_SCALE
  return output
}

// ==================== 掩码后处理 ====================

/**
 * 填补掩码里的小洞（SAM 2 官方视频推理的 `fill_holes_in_mask_scores`：背景里面积 ≤ maxArea 的连通域改成前景，
 * 只影响显示，不影响记忆）。官方用 CUDA 连通域核（8 邻接），这里用同样的 8 邻接两遍扫描并查集。
 */
export function fillVideoEditTrackHoles(logits: Int8Array | Float32Array, width: number, height: number, maxArea = 8): void {
  const labels = new Int32Array(width * height)
  const parent: number[] = [0]
  const find = (value: number): number => { while (parent[value] !== value) { parent[value] = parent[parent[value]]; value = parent[value] } return value }
  const union = (a: number, b: number): void => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb) }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x
    if (logits[index] > 0) continue
    let label = 0
    for (const [dx, dy] of [[-1, 0], [-1, -1], [0, -1], [1, -1]] as const) {
      const nx = x + dx; const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width) continue
      const neighbour = labels[ny * width + nx]
      if (!neighbour) continue
      if (!label) label = neighbour; else union(label, neighbour)
    }
    if (!label) { label = parent.length; parent.push(label) }
    labels[index] = label
  }
  const areas = new Map<number, number>()
  for (let index = 0; index < labels.length; index++) if (labels[index]) { const root = find(labels[index]); labels[index] = root; areas.set(root, (areas.get(root) ?? 0) + 1) }
  // 官方把洞填成 0.1（刚过 0），这里的 int8 量化值 1 = 0.25。
  const fill = logits instanceof Int8Array ? 1 : 0.1
  for (let index = 0; index < labels.length; index++) if (labels[index] && areas.get(labels[index])! <= maxArea) logits[index] = fill
}

/** logit 双线性放大（align_corners = false，与官方 F.interpolate 一致）到 width × height，> 0 为前景（255）。 */
export function videoEditTrackMaskFromLogits(logits: Int8Array | Float32Array, logitWidth: number, logitHeight: number, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height)
  const sx = logitWidth / width; const sy = logitHeight / height
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, Math.min(logitHeight - 1, (y + 0.5) * sy - 0.5)); const y0 = Math.floor(fy); const y1 = Math.min(logitHeight - 1, y0 + 1); const ty = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, Math.min(logitWidth - 1, (x + 0.5) * sx - 0.5)); const x0 = Math.floor(fx); const x1 = Math.min(logitWidth - 1, x0 + 1); const tx = fx - x0
      const top = logits[y0 * logitWidth + x0] * (1 - tx) + logits[y0 * logitWidth + x1] * tx
      const bottom = logits[y1 * logitWidth + x0] * (1 - tx) + logits[y1 * logitWidth + x1] * tx
      if (top * (1 - ty) + bottom * ty > 0) output[y * width + x] = 255
    }
  }
  return output
}

/** 掩码 logit 的外接框（归一化；没有前景时 null）。 */
export function videoEditTrackLogitBox(logits: Int8Array | Float32Array, width: number, height: number, score: number): VideoEditTrackBox | null {
  let minX = width; let minY = height; let maxX = -1; let maxY = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (logits[y * width + x] > 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
  if (maxX < 0) return null
  return [minX / width, minY / height, (maxX + 1 - minX) / width, (maxY + 1 - minY) / height, score]
}

/** 某一时间的框：相邻两帧之间线性插值（跟踪帧率低于序列帧率时画面不跳格）；跟丢的帧取最近的有效帧；超出范围取两端。 */
export function videoEditTrackBoxAt(header: Pick<VideoEditTrackHeader, 'boxes' | 'firstFrame' | 'fps'>, timeUs: number): VideoEditTrackBox | null {
  const boxes = header.boxes
  if (!boxes.length) return null
  const position = Math.max(0, Math.min(boxes.length - 1, timeUs * header.fps / 1e6 - header.firstFrame))
  const before = Math.floor(position); const after = Math.min(boxes.length - 1, before + 1); const t = position - before
  const a = boxes[before]; const b = boxes[after]
  if (a && b) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, Math.min(a[4], b[4])]
  if (a || b) return t < 0.5 ? a ?? b : b ?? a
  // 两侧都跟丢：向两边找最近的有效帧
  for (let distance = 1; distance < boxes.length; distance++) {
    const left = boxes[before - distance]; if (left) return left
    const right = boxes[after + distance]; if (right) return right
  }
  return null
}

/** 跟踪结果覆盖的帧序号（素材时间对应的帧，限制在结果范围内）。 */
export function videoEditTrackFrameIndex(header: Pick<VideoEditTrackHeader, 'firstFrame' | 'frameCount' | 'fps'>, timeUs: number): number {
  return Math.max(0, Math.min(header.frameCount - 1, videoEditTrackFrame(timeUs, header.fps) - header.firstFrame))
}

/** 物体框跟踪作为作用区域：框画成矩形蒙版（长边 512，与智能区域的框同一套羽化、扩展、反转）。 */
export function rasterizeVideoEditTrackBox(box: VideoEditTrackBox | null, sourceWidth: number, sourceHeight: number, params: SmartRegionMaskParams): { width: number; height: number; data: Uint8Array } {
  const size = smartRegionMaskSize(sourceWidth, sourceHeight)
  const boxes: SmartRegionBox[] = box ? [[box[0], box[1], box[2], box[3], box[4], 0]] : []
  return { ...size, data: rasterizeSmartRegionBoxes(boxes, 'rect', params, size.width, size.height) }
}
export function rasterizeVideoEditTrackPlane(quad: VideoEditTrackQuad | undefined, sourceWidth: number, sourceHeight: number, params: SmartRegionMaskParams): { width: number; height: number; data: Uint8Array } {
  const size=smartRegionMaskSize(sourceWidth,sourceHeight)
  const binary=quad ? rasterizeVideoEditMaskShapes([{id:'plane',kind:'path',points:quad.map(([x,y])=>[x,y,0,0,0,0]),feather:0}],size.width,size.height) : new Uint8Array(size.width*size.height)
  return {...size,data:processSmartRegionMatte(binary,size.width,size.height,params)}
}

/** 形状跟踪作为作用区域：logit → 填小洞 → 放大到长边 512 的二值掩码 → 扩展、羽化、反转。 */
export function videoEditTrackShapeMask(logits: Int8Array, header: Pick<VideoEditTrackHeader, 'logits' | 'sourceWidth' | 'sourceHeight'>, params: SmartRegionMaskParams): { width: number; height: number; data: Uint8Array } {
  const grid = header.logits ?? { width: VIDEO_EDIT_TRACK_LOGIT_SIZE, height: VIDEO_EDIT_TRACK_LOGIT_SIZE, scale: VIDEO_EDIT_TRACK_LOGIT_SCALE }
  const filled = new Int8Array(logits)
  fillVideoEditTrackHoles(filled, grid.width, grid.height)
  const size = smartRegionMaskSize(header.sourceWidth, header.sourceHeight)
  const binary = videoEditTrackMaskFromLogits(filled, grid.width, grid.height, size.width, size.height)
  return { ...size, data: processSmartRegionMatte(binary, size.width, size.height, params) }
}

// ==================== 片段跟随 ====================

/**
 * 片段跟随（元素跟随）：文字、图片、片段的位置跟着另一个片段上的跟踪框走（可选同时跟随缩放）。
 * 位置 = 跟踪框中心（换算到序列画面）+ 偏移；缩放 = 片段自己的缩放 × 当前框大小 / 建立跟随时的框大小。
 * 跟踪结果驱动，不写成逐帧数值：跟踪重算或纠错后跟随自动更新（与 4.14 关键帧的衔接见任务文件）。
 */
export const videoEditClipFollowSchema = z.object({
  /** corner_pin ignores offsets and pins the image/video corners to a planar tracker. */
  mode: z.enum(['position', 'corner_pin']).optional(),
  clipId: z.string().min(1).max(100),
  trackerId: z.string().min(1).max(100),
  /** 片段中心相对跟踪框中心的偏移（序列宽、高的比例）。 */
  offsetX: z.number().finite().min(-2).max(2),
  offsetY: z.number().finite().min(-2).max(2),
  /** 跟随缩放时，建立跟随那一帧跟踪框的大小（序列画面里 √(宽 × 高) 占序列高度的比例）；不写只跟随位置。 */
  scaleReference: z.number().finite().positive().max(10).optional(),
}).strict()
export type VideoEditClipFollow = z.infer<typeof videoEditClipFollowSchema>

/** 跟踪框中心换算到序列画面（归一化）与框大小（序列画面里 √(宽 × 高) 占序列高度的比例）。 */
export function videoEditTrackBoxOnFrame(target: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize, box: VideoEditTrackBox): { x: number; y: number; size: number } {
  const center = videoEditClipToFrame(target, picture, frame, box[0] + box[2] / 2, box[1] + box[3] / 2)
  const scale = videoEditClipPixelScale(target, picture, frame)
  return { x: center.x, y: center.y, size: Math.sqrt(box[2] * picture.width * scale * box[3] * picture.height * scale) / frame.height }
}

/** 跟随片段在这一帧的位置与缩放。 */
export function videoEditFollowPlacement(follow: VideoEditClipFollow, scale: number, target: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize, box: VideoEditTrackBox): { x: number; y: number; scale: number } {
  const on = videoEditTrackBoxOnFrame(target, picture, frame, box)
  return {
    x: Math.max(-2, Math.min(2, on.x - 0.5 + follow.offsetX)), y: Math.max(-2, Math.min(2, on.y - 0.5 + follow.offsetY)),
    scale: follow.scaleReference ? Math.max(0.01, Math.min(4, scale * on.size / follow.scaleReference)) : scale,
  }
}

/** 建立跟随：让片段停在现在的位置（这一帧的跟踪框中心 + 偏移 = 片段现在的中心），跟随缩放时记下这一帧的框大小。 */
export function videoEditFollowBinding(clip: Pick<VideoEditClipPlacement, 'x' | 'y'>, target: { clipId: string; trackerId: string; placement: VideoEditClipPlacement; picture: VideoEditSize }, frame: VideoEditSize, box: VideoEditTrackBox, followScale: boolean): VideoEditClipFollow {
  const on = videoEditTrackBoxOnFrame(target.placement, target.picture, frame, box)
  const round = (value: number): number => Math.round(value * 1e5) / 1e5
  return { clipId: target.clipId, trackerId: target.trackerId, offsetX: round(Math.max(-2, Math.min(2, clip.x - (on.x - 0.5)))), offsetY: round(Math.max(-2, Math.min(2, clip.y - (on.y - 0.5)))), ...(followScale ? { scaleReference: round(Math.max(1e-4, on.size)) } : {}) }
}

/** 手绘遮罩跟随：按跟踪框相对参考框的平移与缩放（以框中心为基准）。 */
export function videoEditFollowShapeMap(reference: readonly [number, number, number, number], box: VideoEditTrackBox): { fromX: number; fromY: number; toX: number; toY: number; scale: number } {
  return {
    fromX: reference[0] + reference[2] / 2, fromY: reference[1] + reference[3] / 2, toX: box[0] + box[2] / 2, toY: box[1] + box[3] / 2,
    scale: Math.sqrt(box[2] * box[3] / Math.max(1e-9, reference[2] * reference[3])),
  }
}
