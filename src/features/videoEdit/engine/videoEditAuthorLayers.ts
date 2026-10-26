import type { CodeMatrix } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMotionSample } from '@/core/videoEdit/codeMaterial/motionSampling'
import type { AuthorFrameInfo, AuthorLayer, AuthorModule, AuthorPose } from './videoEditAuthorModule'
import { authorOverrideMatrix, type AuthorElementOverride } from './videoEditAuthorElements'

/** Subpixel defocus must not change raster dimensions or mip sampling. */
export function authorLayerBlur(pose: AuthorPose | null | undefined, rasterScale: number, shape: AuthorLayer['blurShape']): { radius: number; pad: number } {
  const scale = Math.max(Math.abs(pose?.scaleX ?? pose?.scale ?? 1), Math.abs(pose?.scaleY ?? pose?.scale ?? 1))
  const radius = (pose?.blur ?? 0) > 0 ? (pose!.blur! / scale) * rasterScale : 0
  const lens = shape === 'lens'
  return radius < (lens ? .5 : .25) ? { radius: 0, pad: 2 } : { radius, pad: 2 + Math.ceil(radius * (lens ? 1.15 : 3)) }
}

/** Frameflow's raster tiers; the limit is a texture-size constraint, not a JS budget. */
export function authorRasterScale(need: number, limit: number): number {
  const ceiling = Math.max(Number.MIN_VALUE, Math.min(4, limit))
  const exponent = Math.min(Math.max(1, Math.ceil(Math.log2(Math.max(1, need)))), Math.floor(Math.log2(ceiling)))
  const scale = Math.max(Number.MIN_VALUE, 2 ** exponent)
  return scale > ceiling ? scale / 2 : scale
}

export function authorPoseMatrix(pose: AuthorPose): CodeMatrix {
  // Frameflow rotation is in radians, matching Canvas2D.
  const c = Math.cos(pose.rotation ?? 0), s = Math.sin(pose.rotation ?? 0)
  const sx = pose.scaleX ?? pose.scale ?? 1, sy = pose.scaleY ?? pose.scale ?? 1
  return [c * sx, s * sx, -s * sy, c * sy, pose.x ?? 0, pose.y ?? 0]
}

/** `enabled`：序列的运动模糊总开关；关掉时带位姿的图层只取当前时刻一个姿态。 */
export function authorLayerSamples(layer: AuthorLayer, effect: AuthorModule, info: AuthorFrameInfo, bounds: { x: number; y: number; width: number; height: number }, override?: AuthorElementOverride, enabled = true): CodeMotionSample[] {
  const shutter = effect.motionBlur?.shutter ?? 180, phase = effect.motionBlur?.phase ?? -shutter / 2
  // 每次取样沿运动方向拉长到相邻样本间距（见 videoEditAuthorGpu），约每 4 像素一个样本、默认最多 16 个就平滑
  const max = effect.motionBlur?.maxSamples ?? 16
  if (!Number.isFinite(shutter) || shutter < 0 || !Number.isFinite(phase) || !Number.isInteger(max) || max < 1 || max > 64) throw new Error('运动模糊需要非负有限快门和 1–64 个样本。')
  const moving = enabled && !!layer.pose && layer.motionBlur !== false && shutter > 0
  const offset = (i: number, count: number): number => moving ? (phase + (i + .5) / count * shutter) / 360 : 0
  const poseAt = (delta: number): { matrix: CodeMatrix; opacity: number } | null => {
    const pose = layer.pose ? layer.pose(info.time + delta * info.frameDuration) : {}
    if (!pose) return null
    const authorMatrix = authorPoseMatrix(pose)
    const matrix = override ? authorOverrideMatrix(authorMatrix, [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height], override) : authorMatrix
    const opacity = override?.hidden ? 0 : Math.min(1, (pose.opacity ?? 1) * (override?.opacity ?? 1))
    if (!matrix.every(Number.isFinite) || !Number.isFinite(opacity) || !Number.isFinite(pose.blur ?? 0) || (pose.blur ?? 0) < 0) throw new Error('位姿必须为有限数值，blur 不能为负。')
    if (opacity <= 0 || Math.abs(pose.scaleX ?? pose.scale ?? 1) < 1e-6 || Math.abs(pose.scaleY ?? pose.scale ?? 1) < 1e-6) return null
    return { matrix, opacity }
  }
  const probes = Array.from({ length: moving ? 16 : 1 }, (_, i) => poseAt(offset(i, moving ? 16 : 1)))
  let longest = 0
  for (const [x, y] of [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]]) {
    let previous: number[] | undefined, length = 0
    for (const pose of probes) {
      if (!pose) { previous = undefined; continue }
      const m = pose.matrix, p = [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
      if (previous) length += Math.hypot(p[0] - previous[0], p[1] - previous[1])
      previous = p
    }
    longest = Math.max(longest, length)
  }
  const visibility = probes.some(Boolean) && probes.some(p => !p) ? 4 : 1
  const count = moving ? Math.max(visibility, Math.min(max, Math.ceil(longest / 4))) : 1
  return Array.from({ length: count }, (_, i) => {
    const delta = offset(i, count)
    return { offset: { numerator: delta, denominator: 1 }, pose: poseAt(delta), weight: 1 / count }
  })
}
