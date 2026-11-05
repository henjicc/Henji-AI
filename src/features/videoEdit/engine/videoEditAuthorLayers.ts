import { CODE_AUTHOR_DRAW_EXPOSURE_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import type { CodeMatrix } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMotionSample } from '@/core/videoEdit/codeMaterial/motionSampling'
import type { AuthorFrameInfo, AuthorLayer, AuthorModule, AuthorPose } from './videoEditAuthorModule'
import { authorOverrideMatrix, type AuthorElementOverride } from './videoEditAuthorElements'

/**
 * 虚化留出的边距（栅格像素）。边距是栅格尺寸的一部分，一变图层缓存就作废、整层重画：
 * 镜头缓慢推拉或虚化渐变时半径每帧都略有不同，所以边距从 16 起按 2 的幂向上取整，常见的虚化渐变整段落在同一档；
 * 声明了 `blurShape` 的层随时会虚化，清楚时也留同样的边距，虚化出现与消失时不必重画。
 */
const DEFOCUS_PAD = 16

/** Subpixel defocus must not change raster dimensions or mip sampling. */
export function authorLayerBlur(pose: AuthorPose | null | undefined, rasterScale: number, shape: AuthorLayer['blurShape']): { radius: number; pad: number } {
  const scale = Math.max(Math.abs(pose?.scaleX ?? pose?.scale ?? 1), Math.abs(pose?.scaleY ?? pose?.scale ?? 1))
  const referenceRadius = (pose?.blur ?? 0) > 0 ? pose!.blur! / scale : 0
  const lens = shape === 'lens'
  if (referenceRadius < (lens ? .5 : .25)) return { radius: 0, pad: 2 + (shape ? DEFOCUS_PAD : 0) }
  const radius = referenceRadius * rasterScale
  return { radius, pad: 2 + Math.max(DEFOCUS_PAD, 2 ** Math.ceil(Math.log2(Math.ceil(radius * (lens ? 1.15 : 3))))) }
}

/**
 * Frameflow's raster tiers; the limit is a texture-size constraint, not a JS budget.
 * 静态内容至少按 2 倍栅格（位姿缩放、旋转时更清楚）；`exact` 的图层按需要的 1 倍起步：画着视频的每帧都要重画，
 * fill 的生成器在 GPU 里按坐标解析算出，放大栅格只是多算，画面不会更细。
 */
export function authorRasterScale(need: number, limit: number, exact = false): number {
  const ceiling = Math.max(Number.MIN_VALUE, Math.min(4, limit))
  const exponent = Math.min(Math.max(exact ? 0 : 1, Math.ceil(Math.log2(Math.max(1, need)))), Math.floor(Math.log2(ceiling)))
  const scale = Math.max(Number.MIN_VALUE, 2 ** exponent)
  return scale > ceiling ? scale / 2 : scale
}

export interface AuthorStillGroup { start: number; end: number; volatile: boolean }
/**
 * 相邻无位姿图层怎样分成几张整帧栅格，返回下标区间 [start, end)。Frameflow 把它们画在同一张画布上，其中一层在动
 * （脉冲、闪烁、视频）就得整张连同静止部分一起重画。只用 source-over 往上叠的层（`isolated`）单独栅格后在 GPU 上按
 * 顺序叠，结果与画在同一张画布上相同；所以最近在变的层（`volatile`）与静止的层分开，在变的层重画时静止部分沿用。
 * 不是 source-over 的层（清除、别的混合模式、读画布、接着前一层的路径画）要作用在前面已画的内容上：与前面所有层
 * 留在同一张画布。栅格数超过 `limit` 时，把层数最少的静止组并进两侧在变的组。
 */
export function authorStillGroups(stills: ReadonlyArray<{ volatile: boolean; isolated: boolean }>, limit: number): AuthorStillGroup[] {
  let groups: AuthorStillGroup[] = []
  stills.forEach((still, index) => {
    const last = groups.at(-1)
    if (!still.isolated) groups = [{ start: 0, end: index + 1, volatile: still.volatile || groups.some(group => group.volatile) }]
    else if (last && last.volatile === still.volatile) last.end = index + 1
    else groups.push({ start: index, end: index + 1, volatile: still.volatile })
  })
  while (groups.length > Math.max(1, limit)) {
    let fewest = 0
    groups.forEach((group, index) => {
      const best = groups[fewest]
      if (!group.volatile && (best.volatile || group.end - group.start < best.end - best.start)) fewest = index
    })
    const from = Math.max(0, fewest - 1), to = Math.min(groups.length - 1, fewest + 1)
    groups.splice(from, to - from + 1, { start: groups[from].start, end: groups[to].end, volatile: true })
  }
  return groups
}

/**
 * 一组无位姿图层要栅格、上传的范围（画布像素，整数，限在画幅内）。每层都有 `clip` 时画面出不了各 clip 的并集，只取这块；
 * 有一层没有 clip 就是整帧。并集为空（全被裁掉）返回 null。
 */
export function authorStillCrop(clips: ReadonlyArray<readonly [number, number, number, number] | undefined>, width: number, height: number): { x: number; y: number; width: number; height: number } | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const clip of clips) {
    if (!clip || !clip.every(Number.isFinite)) return { x: 0, y: 0, width, height }
    left = Math.min(left, clip[0], clip[2]); top = Math.min(top, clip[1], clip[3])
    right = Math.max(right, clip[0], clip[2]); bottom = Math.max(bottom, clip[1], clip[3])
  }
  const x = Math.max(0, Math.floor(left)), y = Math.max(0, Math.floor(top))
  const cropWidth = Math.min(width, Math.ceil(right)) - x, cropHeight = Math.min(height, Math.ceil(bottom)) - y
  return cropWidth > 0 && cropHeight > 0 ? { x, y, width: cropWidth, height: cropHeight } : null
}

/**
 * 一组静止层实际栅格、上传的范围（栅格像素，整数）。`crop` 是 clip 并集（画布像素，见 authorStillCrop），`bounds` 是录下的
 * 指令画到的范围（画布像素，推不出时 undefined），两者相交后按 `rx`、`ry`（栅格像素 / 画布像素）换算，限在
 * `rasterWidth`×`rasterHeight` 内并向外取整。为空返回 null。
 */
export function authorStillRaster(crop: { x: number; y: number; width: number; height: number }, bounds: readonly [number, number, number, number] | undefined, rx: number, ry: number, rasterWidth: number, rasterHeight: number): { x: number; y: number; width: number; height: number } | null {
  let x0 = crop.x, y0 = crop.y, x1 = crop.x + crop.width, y1 = crop.y + crop.height
  if (bounds) { x0 = Math.max(x0, bounds[0]); y0 = Math.max(y0, bounds[1]); x1 = Math.min(x1, bounds[2]); y1 = Math.min(y1, bounds[3]) }
  const left = Math.max(0, Math.floor(x0 * rx)), top = Math.max(0, Math.floor(y0 * ry))
  const right = Math.min(rasterWidth, Math.ceil(x1 * rx)), bottom = Math.min(rasterHeight, Math.ceil(y1 * ry))
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null
}

/**
 * 静止层组栅格的纹理边长：内容范围逐帧变化时（逐字出现、伸长的线条）按精确尺寸就会每帧新建一张大纹理。
 * 范围只许偏大（多出的部分透明），所以大于 256 像素的边按边长的 1/8 到 1/4 一档向上取整，档内变化沿用同一张纹理；
 * 尺寸只由所需尺寸决定、与之前的帧无关，同一帧总得到同样的画面。小边保持精确，上传字节最少。不超过整帧尺寸 `limit`。
 */
export function authorStillSurfaceSize(need: number, limit: number): number {
  if (need < 256) return need
  const step = 2 ** Math.floor(Math.log2(need)) / 4
  return Math.max(need, Math.min(limit, Math.ceil(need / step) * step))
}

export function authorPoseMatrix(pose: AuthorPose): CodeMatrix {
  // Frameflow rotation is in radians, matching Canvas2D.
  const c = Math.cos(pose.rotation ?? 0), s = Math.sin(pose.rotation ?? 0)
  const sx = pose.scaleX ?? pose.scale ?? 1, sy = pose.scaleY ?? pose.scale ?? 1
  return [c * sx, s * sx, -s * sy, c * sy, pose.x ?? 0, pose.y ?? 0]
}

function authorExposure(effect: AuthorModule): { shutter: number; phase: number; max: number } {
  const shutter = effect.motionBlur?.shutter ?? 180, phase = effect.motionBlur?.phase ?? -shutter / 2
  // 每次取样沿运动方向拉长到相邻样本间距（见 videoEditAuthorGpu），约每 4 像素一个样本、默认最多 16 个就平滑
  const max = effect.motionBlur?.maxSamples ?? 16
  if (!Number.isFinite(shutter) || shutter < 0 || !Number.isFinite(phase) || !Number.isInteger(max) || max < 1 || max > 64) throw new Error('运动模糊需要非负有限快门和 1–64 个样本。')
  return { shutter, phase, max }
}
const exposureOffset = (phase: number, shutter: number, i: number, count: number): number => (phase + (i + .5) / count * shutter) / 360

/** 声明键一次描述整个曝光区间；范围包含中心帧，覆盖中心绘制与快门位姿。 */
export function authorFrameExposure(effect: AuthorModule, info: AuthorFrameInfo, enabled: boolean, apiVersion = 0): NonNullable<AuthorFrameInfo['exposure']> {
  const { shutter, phase } = authorExposure(effect)
  const active = enabled && (!!effect.layers || apiVersion >= CODE_AUTHOR_DRAW_EXPOSURE_MIN_API_VERSION && !!effect.draw) && shutter > 0
  // 没有位姿的图层运动模糊看前两帧：frameKey 和模拟的准备范围都要算上，否则跳帧和连续播放的画面不一样。
  const history = active && apiVersion >= CODE_AUTHOR_DRAW_EXPOSURE_MIN_API_VERSION && effect.mode !== 'static' ? -2 : 0
  return { start: info.time + Math.min(0, history, active ? phase / 360 : 0) * info.frameDuration,
    end: info.time + Math.max(0, active ? (phase + shutter) / 360 : 0) * info.frameDuration,
    shutter: active ? shutter : 0, phase: active ? phase : 0 }
}

/**
 * 没有位姿的图层比较前一帧和这一帧的绘制指令算运动，前两帧用来看速度连不连续。这些都是连续播放时已经录好的，不用多跑作者代码。
 */
export const AUTHOR_MOTION_HISTORY = [-1, -2] as const
/** 作者函数在另一时刻看到的帧信息。保留取值器：有些字段是用到时才算的。 */
export function authorShiftedFrameInfo(info: AuthorFrameInfo, frames: number): AuthorFrameInfo {
  const shifted = Object.defineProperties({} as AuthorFrameInfo, Object.getOwnPropertyDescriptors(info)), delta = frames * info.frameDuration
  shifted.time = info.time + delta
  shifted.clip = { ...info.clip, time: info.clip.time + delta }
  return shifted
}
export function authorDrawExposure(effect: AuthorModule, enabled: boolean, apiVersion: number): { fraction: number; shutter: number; phase: number; centered: boolean; max: number } | undefined {
  if (!enabled || apiVersion < CODE_AUTHOR_DRAW_EXPOSURE_MIN_API_VERSION || effect.mode === 'static') return undefined
  const { shutter, phase, max } = authorExposure(effect)
  return shutter > 0 ? { fraction: shutter / 360, shutter, phase, centered: Math.abs(phase + shutter / 2) < 1e-6, max } : undefined
}
export const authorDrawSampleOffset = (exposure: { shutter: number; phase: number }, index: number, count: number): number => exposureOffset(exposure.phase, exposure.shutter, index, count)
/** 插值取样只花栅格，不跑作者代码；样本隔约 5 像素，再疏就看得出分帧。 */
export function authorDrawSampleCount(displacement: number, cap: number): number {
  return Math.max(1, Math.min(cap, Math.ceil(displacement / 5)))
}

/** `enabled`：序列的运动模糊总开关；关掉时带位姿的图层只取当前时刻一个姿态。 */
export function authorLayerSamples(layer: AuthorLayer, effect: AuthorModule, info: AuthorFrameInfo, bounds: { x: number; y: number; width: number; height: number }, override?: AuthorElementOverride, enabled = true): CodeMotionSample[] {
  const { shutter, phase, max } = authorExposure(effect)
  const moving = enabled && !!layer.pose && layer.motionBlur !== false && shutter > 0
  const offset = (i: number, count: number): number => moving ? exposureOffset(phase, shutter, i, count) : 0
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
