/**
 * 在一段过渡中途插入状态关键帧（纯函数）。
 *
 * 插卡只是在这一刻记一张快照，不改写原来的运动：上一张卡的过渡细节原本管到下一张卡，插卡后要分给前后两段。
 * - 空间路径（走位路线、运镜轨迹）在新卡处一分为二，两段拼起来与原路径重合；
 * - 速度预设、动作覆盖、跟拍延续到新卡后面一段；错峰延迟拆到前后两段，两段的运动时间窗拼起来与原来相同（splitDelay）；
 * - 角色原来按平均速度自动选的步态写成两段的动作覆盖：两段各自的平均速度不同，自动选可能一段走一段跑；
 * - 有对象在这段里移动时新卡记为平滑通过，否则所有对象都会在新卡上停一下。
 */

import { createClipMotion, CHARACTER_MOVE_MIN_SPEED, locomotionClipForSpeed } from './characterMotion'
import { LOCOMOTION_MIN_DISTANCE } from './characterMotionTimeline'
import type { StageObject, StageVec3 } from './sceneTypes'
import { createSpatialPathSampler, splitSpatialPath } from './spatialPath'
import { applyTransitionDelay } from './stateKeyframeCompiler'
import type { StageSpatialPath, StageStateKeyframe, StageStateKeyframeTransitionObjectDetail } from './stateKeyframeTypes'

const PATH_LENGTH_SAMPLES = 64

function moved(a: StageVec3, b: StageVec3): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 1e-6
}

/** 走跑按水平路程算（与动作时间线同一口径）。 */
function horizontalLength(from: StageVec3, to: StageVec3, path: StageSpatialPath | undefined): number {
  if (!path) return Math.hypot(to.x - from.x, to.z - from.z)
  const sample = createSpatialPathSampler(from, to, path)
  let length = 0
  let previous = sample(0)
  for (let index = 1; index <= PATH_LENGTH_SAMPLES; index += 1) {
    const point = sample(index / PATH_LENGTH_SAMPLES)
    length += Math.hypot(point.x - previous.x, point.z - previous.z)
    previous = point
  }
  return length
}

/**
 * 原过渡 [previous, next] 带错峰延迟 delay 时，对象只在 applyTransitionDelay 给出的时间窗里动。
 * 在 inserted 处插卡后，前后两段各配一个延迟，使前段的时间窗到 inserted 为止、后段从 inserted 接着走，拼起来就是原时间窗：
 * - 延迟为正（晚出发）：前段照原延迟；插卡时刻还在等待中时，后段把剩下的等待时间接着等完。
 * - 延迟为负（早到达）：前段不提前（否则前段先到、在新卡上停一下）；后段照原延迟提前到达；插卡时已到达时前段提前到原到达时刻。
 */
function splitDelay(delay: number, previous: number, inserted: number, next: number): { before: number; after: number } {
  if (delay >= 0) return { before: delay, after: Math.max(0, previous + delay - inserted) }
  return { before: Math.min(0, delay + next - inserted), after: delay }
}

function withDelay(detail: StageStateKeyframeTransitionObjectDetail, delay: number): StageStateKeyframeTransitionObjectDetail {
  const { delay: _old, ...rest } = detail
  return Math.abs(delay) > 1e-9 ? { ...rest, delay } : rest
}

export function continueTransitionsThroughInserted(
  stateKeyframes: StageStateKeyframe[],
  insertedId: string,
  objects: readonly StageObject[],
): StageStateKeyframe[] {
  const index = stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === insertedId)
  const previous = stateKeyframes[index - 1]
  const inserted = stateKeyframes[index]
  const next = stateKeyframes[index + 1]
  if (!previous || !inserted || !next) return stateKeyframes

  const before: Record<string, StageStateKeyframeTransitionObjectDetail> = { ...previous.transition.perObject }
  const after: Record<string, StageStateKeyframeTransitionObjectDetail> = { ...inserted.transition.perObject }
  let anyMoving = false
  for (const object of objects) {
    const from = previous.objectStates[object.id]?.transform.position
    const at = inserted.objectStates[object.id]?.transform.position
    const to = next.objectStates[object.id]?.transform.position
    const detail = previous.transition.perObject[object.id]
    const { spatialPath, delay: _delay, ...carried } = detail ?? {}
    const moving = !!from && !!to && (!!spatialPath || moved(from, to))
    anyMoving ||= moving
    const continued: StageStateKeyframeTransitionObjectDetail = structuredClone(carried)
    if (spatialPath && from && at && to) {
      const split = splitSpatialPath(from, to, spatialPath, at)
      const { spatialPath: _whole, ...rest } = before[object.id]
      before[object.id] = split.before ? { ...rest, spatialPath: split.before } : rest
      if (split.after) continued.spatialPath = split.after
    }
    // 指定过动作的已随 carried 延续；只有按速度自动选的步态需要钉住。
    if (object.type === 'character' && moving && from && to && !carried.motionOverride) {
      const [start, end] = applyTransitionDelay(previous.time, next.time, detail?.delay ?? 0)
      const length = horizontalLength(from, to, spatialPath)
      if (end > start && length >= LOCOMOTION_MIN_DISTANCE && length / (end - start) >= CHARACTER_MOVE_MIN_SPEED) {
        const gait = createClipMotion(locomotionClipForSpeed(length / (end - start)))
        before[object.id] = { ...before[object.id], motionOverride: gait }
        continued.motionOverride = structuredClone(gait)
      }
    }
    if (detail?.delay) {
      const delays = splitDelay(detail.delay, previous.time, inserted.time, next.time)
      before[object.id] = withDelay(before[object.id] ?? {}, delays.before)
      Object.assign(continued, withDelay({}, delays.after))
    }
    if (Object.keys(continued).length > 0) after[object.id] = { ...after[object.id], ...continued }
  }

  return stateKeyframes.map((stateKeyframe) => {
    if (stateKeyframe.id === previous.id) return { ...stateKeyframe, transition: { perObject: before } }
    if (stateKeyframe.id === inserted.id) {
      return { ...stateKeyframe, transition: { perObject: after }, ...(anyMoving ? { continuity: 'smooth' as const } : {}) }
    }
    return stateKeyframe
  })
}
