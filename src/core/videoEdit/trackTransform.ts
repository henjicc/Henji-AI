import { videoEditClipPixelScaleY, videoEditClipToFrame, type VideoEditClipPlacement, type VideoEditSize } from './clipGeometry'

/*
 * 跟踪变换（对标 AE 跟踪器的“变换”）：从点、平面跟踪的逐帧几何求出位置、缩放与旋转。
 * - 一点：位置；两点：两点连线的长度与角度给出缩放与旋转；三、四点：加权最小二乘相似变换，一次剔除离群点；
 * - 平面：四角的相似变换（只跟随位置、旋转、缩放，不做角点贴合）；
 * - 相机运动（防抖分析）：大量背景特征点，两点最小样本 RANSAC 后在内点上精化，前景运动物体落在离群点里。
 * 几何在“画面高度单位”的各向同性坐标里求（x 乘画面宽高比），旋转角为 y 向下的顺时针正角，与合成器一致。
 * 被主进程与后台推理进程引用：只用相对路径导入，不依赖 DOM。
 */

/** x' = a·x − b·y + tx，y' = b·x + a·y + ty（缩放 √(a²+b²)，角度 atan2(b, a)）。 */
export interface VideoEditSimilarity { a: number; b: number; tx: number; ty: number }
export type VideoEditPoint = readonly [number, number]
export const VIDEO_EDIT_IDENTITY_SIMILARITY: VideoEditSimilarity = Object.freeze({ a: 1, b: 0, tx: 0, ty: 0 })

export function applyVideoEditSimilarity(s: VideoEditSimilarity, x: number, y: number): [number, number] {
  return [s.a * x - s.b * y + s.tx, s.b * x + s.a * y + s.ty]
}
/** 先 second 再 first（first ∘ second）。 */
export function composeVideoEditSimilarity(first: VideoEditSimilarity, second: VideoEditSimilarity): VideoEditSimilarity {
  const [tx, ty] = applyVideoEditSimilarity(first, second.tx, second.ty)
  return { a: first.a * second.a - first.b * second.b, b: first.a * second.b + first.b * second.a, tx, ty }
}
export function invertVideoEditSimilarity(s: VideoEditSimilarity): VideoEditSimilarity {
  const d = s.a * s.a + s.b * s.b
  if (!(d > 1e-12)) throw new Error('相似变换已退化。')
  const a = s.a / d; const b = -s.b / d
  return { a, b, tx: -(a * s.tx - b * s.ty), ty: -(b * s.tx + a * s.ty) }
}
export function videoEditSimilarityScale(s: VideoEditSimilarity): number { return Math.hypot(s.a, s.b) }
export function videoEditSimilarityAngle(s: VideoEditSimilarity): number { return Math.atan2(s.b, s.a) }

/** 加权最小二乘相似变换（Umeyama，无镜像）：src → dst；点少于 2 或全部重合时 undefined。 */
export function fitVideoEditSimilarity(src: readonly VideoEditPoint[], dst: readonly VideoEditPoint[], weights?: readonly number[]): VideoEditSimilarity | undefined {
  let total = 0; let sx = 0; let sy = 0; let dx = 0; let dy = 0
  for (let i = 0; i < src.length; i++) { const w = weights?.[i] ?? 1; if (!(w > 0)) continue; total += w; sx += w * src[i][0]; sy += w * src[i][1]; dx += w * dst[i][0]; dy += w * dst[i][1] }
  if (!(total > 0)) return undefined
  sx /= total; sy /= total; dx /= total; dy /= total
  let norm = 0; let dot = 0; let cross = 0
  for (let i = 0; i < src.length; i++) {
    const w = weights?.[i] ?? 1; if (!(w > 0)) continue
    const px = src[i][0] - sx; const py = src[i][1] - sy; const qx = dst[i][0] - dx; const qy = dst[i][1] - dy
    norm += w * (px * px + py * py); dot += w * (px * qx + py * qy); cross += w * (px * qy - py * qx)
  }
  if (!(norm > 1e-14)) return undefined
  const a = dot / norm; const b = cross / norm
  return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) }
}

function residual(s: VideoEditSimilarity, p: VideoEditPoint, q: VideoEditPoint): number {
  const [x, y] = applyVideoEditSimilarity(s, p[0], p[1])
  return Math.hypot(x - q[0], y - q[1])
}

/** 少量点（三、四点跟踪）：加权拟合，残差超过阈值时剔除最差的一点再拟合（至少留两点）。 */
export function robustVideoEditSimilarity(src: readonly VideoEditPoint[], dst: readonly VideoEditPoint[], weights: readonly number[], threshold: number): { similarity: VideoEditSimilarity; used: boolean[] } | undefined {
  const used = weights.map(w => w > 0)
  for (;;) {
    const similarity = fitVideoEditSimilarity(src, dst, weights.map((w, i) => used[i] ? w : 0))
    if (!similarity) return undefined
    const count = used.filter(Boolean).length
    if (count <= 2) return { similarity, used }
    let worst = -1; let worstError = threshold
    for (let i = 0; i < src.length; i++) if (used[i]) { const error = residual(similarity, src[i], dst[i]); if (error > worstError) { worst = i; worstError = error } }
    if (worst < 0) return { similarity, used }
    used[worst] = false
  }
}

/** 确定性伪随机（mulberry32）：同一输入得到同一结果，缓存与测试可复现。 */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/**
 * 大量点（相机运动）：两点最小样本 RANSAC，按内点数选最优，再在内点上精化两次。
 * 内点比例即可信度；前景运动物体的特征点不符合整体运动，落在离群点里。
 */
export function ransacVideoEditSimilarity(src: readonly VideoEditPoint[], dst: readonly VideoEditPoint[], options: { threshold: number; iterations?: number; seed?: number; minSeparation?: number }): { similarity: VideoEditSimilarity; inliers: boolean[]; ratio: number } | undefined {
  const n = src.length
  if (n < 2) return undefined
  const next = random(options.seed ?? 1)
  const separation = options.minSeparation ?? 0
  let best: { similarity: VideoEditSimilarity; count: number } | undefined
  const iterations = options.iterations ?? 256
  for (let k = 0; k < iterations; k++) {
    const i = Math.floor(next() * n); let j = Math.floor(next() * (n - 1)); if (j >= i) j++
    if (Math.hypot(src[i][0] - src[j][0], src[i][1] - src[j][1]) < separation) continue
    const candidate = fitVideoEditSimilarity([src[i], src[j]], [dst[i], dst[j]])
    if (!candidate) continue
    let count = 0
    for (let m = 0; m < n; m++) if (residual(candidate, src[m], dst[m]) <= options.threshold) count++
    if (!best || count > best.count) best = { similarity: candidate, count }
    if (count === n) break
  }
  if (!best) return undefined
  let similarity = best.similarity; let inliers: boolean[] = []
  for (let pass = 0; pass < 2; pass++) {
    inliers = src.map((p, m) => residual(similarity, p, dst[m]) <= options.threshold)
    const refined = fitVideoEditSimilarity(src, dst, inliers.map(v => v ? 1 : 0))
    if (!refined) break
    similarity = refined
  }
  inliers = src.map((p, m) => residual(similarity, p, dst[m]) <= options.threshold)
  const count = inliers.filter(Boolean).length
  return count >= 2 ? { similarity, inliers, ratio: count / n } : undefined
}

// ==================== 跟踪姿态 ====================

/**
 * 一帧的跟踪姿态（片段画面坐标）：锚点（归一化）、大小（画面高度单位）、角度（弧度，相对第一个提示）。
 * 只有能求出的分量才有：一点没有大小和角度，物体框没有角度。
 */
export interface VideoEditTrackPose { anchor: [number, number]; size?: number; angle?: number; confidence: number }

const iso = (aspect: number, p: readonly number[]): [number, number] => [p[0] * aspect, p[1]]
const centroid = (points: readonly VideoEditPoint[]): [number, number] => [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]
/** 三、四点剔除离群的阈值：画面高度的 2%。 */
export const VIDEO_EDIT_TRACK_POINT_OUTLIER = 0.02

/** 物体框（含形状跟踪的外接框）：中心与 √(宽 × 高)。 */
export function videoEditBoxPose(box: readonly number[], aspect: number): VideoEditTrackPose {
  return { anchor: [box[0] + box[2] / 2, box[1] + box[3] / 2], size: Math.sqrt(Math.max(0, box[2] * aspect * box[3])), confidence: box[4] ?? 1 }
}

/**
 * 点跟踪：参考为第一个提示的点，当前为这一帧跟踪到的点（第三项是可信度，0 为跟丢）。
 * 两点精确求解；三、四点加权拟合并剔除离群点；有效点少于需要的数量时 undefined。
 */
export function videoEditPointPose(reference: readonly VideoEditPoint[], current: readonly (readonly [number, number, number])[], aspect: number): VideoEditTrackPose | undefined {
  if (!current.length || reference.length !== current.length) return undefined
  if (current.length === 1) return current[0][2] > 0 ? { anchor: [current[0][0], current[0][1]], confidence: current[0][2] } : undefined
  const src = reference.map(p => iso(aspect, p)); const dst = current.map(p => iso(aspect, p))
  const weights = current.map(p => Math.max(0, p[2]))
  const fit = current.length === 2 ? (weights.every(w => w > 0) ? { similarity: fitVideoEditSimilarity(src, dst), used: [true, true] } : undefined) : robustVideoEditSimilarity(src, dst, weights, VIDEO_EDIT_TRACK_POINT_OUTLIER)
  if (!fit?.similarity) return undefined
  const center = centroid(src)
  const length = current.length === 2 ? Math.hypot(src[1][0] - src[0][0], src[1][1] - src[0][1]) : Math.sqrt(src.reduce((s, p) => s + (p[0] - center[0]) ** 2 + (p[1] - center[1]) ** 2, 0) / src.length)
  const [x, y] = applyVideoEditSimilarity(fit.similarity, center[0], center[1])
  const used = weights.filter((_, i) => fit.used[i])
  return { anchor: [x / aspect, y], size: length * videoEditSimilarityScale(fit.similarity), angle: videoEditSimilarityAngle(fit.similarity), confidence: used.reduce((s, w) => s + w, 0) / Math.max(1, used.length) }
}

/** 平面跟踪：四角的相似变换（参考为第一个提示的四角）。 */
export function videoEditQuadPose(reference: readonly VideoEditPoint[], current: readonly VideoEditPoint[], aspect: number, confidence: number): VideoEditTrackPose | undefined {
  const src = reference.map(p => iso(aspect, p)); const dst = current.map(p => iso(aspect, p))
  const similarity = fitVideoEditSimilarity(src, dst)
  if (!similarity) return undefined
  const center = centroid(src)
  const area = Math.abs(src.reduce((s, p, i) => { const q = src[(i + 1) % src.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0)) / 2
  const [x, y] = applyVideoEditSimilarity(similarity, center[0], center[1])
  return { anchor: [x / aspect, y], size: Math.sqrt(area) * videoEditSimilarityScale(similarity), angle: videoEditSimilarityAngle(similarity), confidence }
}

/** 姿态换到序列画面：位置（归一化）、大小（占序列高度的比例）、角度（度，含被跟踪片段自身的旋转）。 */
export function videoEditTrackPoseOnFrame(target: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize, pose: VideoEditTrackPose): { x: number; y: number; size?: number; angle?: number } {
  const center = videoEditClipToFrame(target, picture, frame, pose.anchor[0], pose.anchor[1])
  const result: { x: number; y: number; size?: number; angle?: number } = { x: center.x, y: center.y }
  if (pose.size !== undefined) result.size = pose.size * picture.height * videoEditClipPixelScaleY(target, picture, frame) / frame.height
  if (pose.angle !== undefined) {
    const step = 0.01; const aspect = picture.width / Math.max(1, picture.height)
    const tip = videoEditClipToFrame(target, picture, frame, pose.anchor[0] + Math.cos(pose.angle) * step / aspect, pose.anchor[1] + Math.sin(pose.angle) * step)
    result.angle = Math.atan2((tip.y - center.y) * frame.height, (tip.x - center.x) * frame.width) * 180 / Math.PI
  }
  return result
}

/** 角度差换到 (−180, 180]。 */
export function videoEditAngleDelta(degrees: number): number { const value = ((degrees + 180) % 360 + 360) % 360 - 180; return value === -180 ? 180 : value }
