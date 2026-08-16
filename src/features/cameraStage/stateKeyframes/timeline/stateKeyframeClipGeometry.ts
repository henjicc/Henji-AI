/**
 * 状态关键帧时间轴几何计算（纯函数，禁止 UI/three 依赖）。
 *
 * 提供帧量化/钳制与「状态关键帧数组 → 比例块布局」的几何计算，供 1.2 比例块轨道、
 * 1.3 过渡段只读判断复用；内部复用 buildStateKeyframeTimeline（domain/stateKeyframeCompiler.ts）
 * 与 timeToX（timeline/timeScale.ts）换算时间，不重复实现时间累加与像素换算。
 *
 * 存储仍为秒（浮点）；quantizeToFrame 只在写入口（store）调用，读取路径不强制量化，
 * 旧数据默认值 0.5s/2s 在 30fps 下本就落在帧网格上。
 */

import { buildStateKeyframeTimeline } from '../../domain/stateKeyframeCompiler'
import type { StageStateKeyframe } from '../../domain/stateKeyframeTypes'
import { timeToX } from '../../timeline/timeScale'
import { getStateKeyframeTimeRanges, type StateKeyframeTimeRange } from '../stateKeyframeTimelineUtils'

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

export type StateKeyframeClipBlockKind = 'static' | 'transition'

/** 时间轴上的一个比例块：静止块来自某状态关键帧的 hold 段，过渡块来自该点到下一点的 transition 段 */
export interface StateKeyframeClipBlock {
  kind: StateKeyframeClipBlockKind
  /** 所属状态关键帧 id（过渡块归属前一个状态关键帧，语义对齐 StageStateKeyframe.transitionDuration） */
  stateKeyframeId: string
  /** 所属状态关键帧在 stateKeyframes 数组中的下标 */
  index: number
  startTime: number
  endTime: number
  x: number
  width: number
}

/**
 * 由状态关键帧序列 + 像素密度算出有序比例块数组：
 * 静止块（hold 段）与过渡块（transition 段）交替铺满，零真实间隙；末卡无过渡块。
 * 0 帧过渡输出 width 为 0 的过渡块，是否画成剪切线由 UI 层决定，本函数只负责几何。
 */
export function buildClipLayout(stateKeyframes: StageStateKeyframe[], pxPerSecond: number): StateKeyframeClipBlock[] {
  const timeline = buildStateKeyframeTimeline(stateKeyframes)
  const blocks: StateKeyframeClipBlock[] = []

  stateKeyframes.forEach((stateKeyframe, index) => {
    const segment = timeline[index]
    blocks.push({
      kind: 'static',
      stateKeyframeId: stateKeyframe.id,
      index,
      startTime: segment.holdStart,
      endTime: segment.transitionStart,
      x: timeToX(segment.holdStart, pxPerSecond),
      width: timeToX(segment.transitionStart, pxPerSecond) - timeToX(segment.holdStart, pxPerSecond),
    })

    const isLast = index === stateKeyframes.length - 1
    if (isLast) return
    blocks.push({
      kind: 'transition',
      stateKeyframeId: stateKeyframe.id,
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
 * 边界时间归属"后一块"（与 stateKeyframeTimelineUtils.getStateKeyframeAtTime 的边界语义一致）；
 * 越界（负数/超出总时长）分别钳制到首块/尾块。
 */
export function findClipAtTime(layout: StateKeyframeClipBlock[], time: number): StateKeyframeClipBlock | null {
  if (layout.length === 0) return null
  const safeTime = Math.max(0, time)
  return layout.find((block) => safeTime < block.endTime) ?? layout[layout.length - 1]
}

/** 半帧容差（秒）：规避浮点误差导致的静止/过渡段边界误判 */
function halfFrameEpsilon(fps: number): number {
  return 1 / (2 * Math.max(1, fps))
}

function inStaticSegment(range: StateKeyframeTimeRange, time: number, eps: number): boolean {
  return time >= range.holdStart - eps && time < range.transitionStart + eps
}

/**
 * 时间是否落在指定状态关键帧的静止段内（±半帧容差）。
 * 播放头编辑守卫用（重要记录 003）：状态关键帧编辑只有在这里返回 true 时才允许把
 * 视口编辑捕获进该状态关键帧，天然同时覆盖"过渡段插值状态误录"与"播放头在别的时间点却写入选中点"两种误录场景。
 */
export function isTimeInStateKeyframeStaticSegment(stateKeyframes: StageStateKeyframe[], stateKeyframeId: string, time: number, fps: number): boolean {
  const range = getStateKeyframeTimeRanges(stateKeyframes).find((item) => item.stateKeyframeId === stateKeyframeId)
  return !!range && inStaticSegment(range, time, halfFrameEpsilon(fps))
}

/** 播放头是否落在任意状态关键帧的过渡段内（即不属于任何静止段）；视口只读/隐藏 gizmo 判断用 */
export function isTimeInTransition(stateKeyframes: StageStateKeyframe[], time: number, fps: number): boolean {
  const ranges = getStateKeyframeTimeRanges(stateKeyframes)
  if (ranges.length === 0) return false
  const eps = halfFrameEpsilon(fps)
  const timelineEnd = ranges[ranges.length - 1].transitionEnd
  if (time > timelineEnd + eps) return false
  return !ranges.some((range) => inStaticSegment(range, time, eps))
}
