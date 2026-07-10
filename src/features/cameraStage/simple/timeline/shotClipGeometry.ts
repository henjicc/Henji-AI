/**
 * 简易模式时间轴几何计算（纯函数，禁止 UI/three 依赖）。
 *
 * 提供帧量化/钳制与「镜头卡数组 → 比例块布局」的几何计算，供 1.2 比例块轨道、
 * 1.3 过渡段只读判断复用；内部复用 buildShotTimeline（domain/shotCompiler.ts）
 * 与 timeToX（timeline/timeScale.ts）换算时间，不重复实现时间累加与像素换算。
 *
 * 存储仍为秒（浮点）；quantizeToFrame 只在写入口（store）调用，读取路径不强制量化，
 * 旧数据默认值 0.5s/2s 在 30fps 下本就落在帧网格上。
 */

import { buildShotTimeline } from '../../domain/shotCompiler'
import type { StageShot } from '../../domain/shotTypes'
import { timeToX } from '../../timeline/timeScale'
import { getShotTimeRanges, type ShotTimeRange } from '../shotTimelineUtils'

/** 秒 → 最近帧网格（n / fps），四舍五入 */
export function quantizeToFrame(seconds: number, fps: number): number {
  const safeFps = Math.max(1, fps)
  return Math.round(seconds * safeFps) / safeFps
}

/** hold 仅用于旧工程兼容；关键帧模式允许为 0。 */
export function clampHold(seconds: number, _fps: number): number {
  return Math.max(0, seconds)
}

/** 过渡时长钳制：≥ 0（0 = 合法的硬切特殊形式）；fps 保留参数位与 clampHold 签名对齐，暂无需使用 */
export function clampTransition(seconds: number, _fps: number): number {
  return Math.max(0, seconds)
}

export type ShotClipBlockKind = 'static' | 'transition'

/** 时间轴上的一个比例块：静止块来自某卡的 hold 段，过渡块来自该卡到下一卡的 transition 段 */
export interface ShotClipBlock {
  kind: ShotClipBlockKind
  /** 所属镜头卡 id（过渡块归属"前一张"静止卡，语义对齐 StageShot.transitionDuration 挂在本卡上） */
  shotId: string
  /** 所属镜头卡在 shots 数组中的下标 */
  index: number
  startTime: number
  endTime: number
  x: number
  width: number
}

/**
 * 由镜头卡序列 + 像素密度算出有序比例块数组：
 * 静止块（hold 段）与过渡块（transition 段）交替铺满，零真实间隙；末卡无过渡块。
 * 0 帧过渡输出 width 为 0 的过渡块，是否画成剪切线由 UI 层决定，本函数只负责几何。
 */
export function buildClipLayout(shots: StageShot[], pxPerSecond: number): ShotClipBlock[] {
  const timeline = buildShotTimeline(shots)
  const blocks: ShotClipBlock[] = []

  shots.forEach((shot, index) => {
    const segment = timeline[index]
    blocks.push({
      kind: 'static',
      shotId: shot.id,
      index,
      startTime: segment.holdStart,
      endTime: segment.transitionStart,
      x: timeToX(segment.holdStart, pxPerSecond),
      width: timeToX(segment.transitionStart, pxPerSecond) - timeToX(segment.holdStart, pxPerSecond),
    })

    const isLast = index === shots.length - 1
    if (isLast) return
    blocks.push({
      kind: 'transition',
      shotId: shot.id,
      index,
      startTime: segment.transitionStart,
      endTime: segment.transitionEnd,
      x: timeToX(segment.transitionStart, pxPerSecond),
      width: timeToX(segment.transitionEnd, pxPerSecond) - timeToX(segment.transitionStart, pxPerSecond),
    })
  })

  return blocks
}

/**
 * 按播放头时间命中当前块（播放头高亮/只读判断用）。
 * 边界时间归属"后一块"（与 shotTimelineUtils.getShotAtTime 的边界语义一致）；
 * 越界（负数/超出总时长）分别钳制到首块/尾块。
 */
export function findClipAtTime(layout: ShotClipBlock[], time: number): ShotClipBlock | null {
  if (layout.length === 0) return null
  const safeTime = Math.max(0, time)
  return layout.find((block) => safeTime < block.endTime) ?? layout[layout.length - 1]
}

/** 半帧容差（秒）：规避浮点误差导致的静止/过渡段边界误判 */
function halfFrameEpsilon(fps: number): number {
  return 1 / (2 * Math.max(1, fps))
}

function inStaticSegment(range: ShotTimeRange, time: number, eps: number): boolean {
  return time >= range.holdStart - eps && time < range.transitionStart + eps
}

/**
 * 时间是否落在指定镜头卡的静止段内（±半帧容差）。
 * 播放头编辑守卫用（重要记录 003）：`compileSimpleEdit` 只有在这里返回 true 时才允许把
 * 视口编辑捕获进该卡，天然同时覆盖"过渡段插值状态误录"与"播放头在别的卡上却录进选中卡"两种误录场景。
 */
export function isTimeInShotStaticSegment(shots: StageShot[], shotId: string, time: number, fps: number): boolean {
  const range = getShotTimeRanges(shots).find((item) => item.shotId === shotId)
  return !!range && inStaticSegment(range, time, halfFrameEpsilon(fps))
}

/** 播放头是否落在任意一张卡的过渡段内（即不属于任何卡的静止段）；视口只读/隐藏 gizmo 判断用 */
export function isTimeInTransition(shots: StageShot[], time: number, fps: number): boolean {
  const ranges = getShotTimeRanges(shots)
  if (ranges.length === 0) return false
  const eps = halfFrameEpsilon(fps)
  const timelineEnd = ranges[ranges.length - 1].transitionEnd
  if (time > timelineEnd + eps) return false
  return !ranges.some((range) => inStaticSegment(range, time, eps))
}
