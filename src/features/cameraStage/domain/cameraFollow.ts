/**
 * 摄像机跟拍（纯函数）：机位像跟焦员推着斯坦尼康一样，略慢半拍地跟着主体走。
 *
 * 做法与 Cinemachine 的 Transposer（跟随偏移 + 阻尼）一致：主体位置先过临界阻尼二阶系统（ω = 2/滞后，
 * 不超调），机位 = 平滑后的主体位置 + 按参照系转过的偏移；参照系是平滑后的行进方向（主体停下时保持
 * 最后的方向，原地转身不会把机位甩到另一边），或者世界坐标（沿街平移）。注视点不平滑，由摄像机自己的
 * 注视跟随滞后处理，相当于 Composer。
 *
 * 确定性：从跟拍开始按固定 1/60 秒网格积分（网格内把输入当成线性，用解析解推进），网格点之间线性插值；
 * 播放、拖动时间轴与导出在同一时刻拿到同一个机位。
 */

import type { StageCameraFollowEntry } from './animationTypes'
import type { StageVec3 } from './sceneTypes'

const GRID_STEP = 1 / 60
/** 平滑后的主体速度低于这个值（米/秒）时行进方向保持不变 */
const HEADING_MIN_SPEED = 0.15

interface CameraFollowPose {
  position: StageVec3
  aimTarget: StageVec3
}

export type CameraFollowSampler = (time: number) => CameraFollowPose

/** 把参照系里的向量（+Z 为行进方向）按朝向 yaw（度）转到世界坐标。 */
export function rotateByYaw(local: StageVec3, yawDegrees: number): StageVec3 {
  const yaw = (yawDegrees * Math.PI) / 180
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return { x: local.x * cos + local.z * sin, y: local.y, z: -local.x * sin + local.z * cos }
}

/** rotateByYaw 的逆变换：世界坐标里的偏移换成参照系里的偏移。 */
export function unrotateByYaw(world: StageVec3, yawDegrees: number): StageVec3 {
  return rotateByYaw(world, -yawDegrees)
}

interface AxisState { x: number; v: number }

/** 输入在一步内从 from 线性变到 to 时，临界阻尼滤波推进 elapsed 秒的解析解（见 cameraAimLag）。 */
function propagate(state: AxisState, from: number, to: number, duration: number, elapsed: number, omega: number): AxisState {
  const slope = duration > 0 ? (to - from) / duration : 0
  const particular = -2 * slope / omega
  const a = state.x - from - particular
  const b = state.v - slope + omega * a
  const decay = Math.exp(-omega * elapsed)
  return {
    x: from + slope * elapsed + particular + (a + b * elapsed) * decay,
    v: slope + (b - omega * (a + b * elapsed)) * decay,
  }
}

/**
 * subjectAt 给出主体在任意时刻的位置；initialHeading 是跟拍开始时的行进方向（度），
 * 由调用方取主体开始走动的方向，没有走动就取主体朝向。
 */
export function createCameraFollowSampler(
  entry: StageCameraFollowEntry,
  subjectAt: (time: number) => StageVec3,
  initialHeading: number,
): CameraFollowSampler {
  const { startTime, endTime, follow } = entry
  const count = Math.max(1, Math.ceil((endTime - startTime) / GRID_STEP))
  const step = (endTime - startTime) / count
  const inputs = Array.from({ length: count + 1 }, (_, index) => subjectAt(startTime + index * step))
  const omega = follow.lag > 1e-3 ? 2 / follow.lag : 0
  const smoothed: StageVec3[] = [inputs[0]]
  const headings: number[] = [initialHeading]
  let state = (['x', 'y', 'z'] as const).map((axis) => ({ x: inputs[0][axis], v: count > 0 && step > 0 ? (inputs[1][axis] - inputs[0][axis]) / step : 0 }))
  for (let index = 0; index < count; index += 1) {
    if (omega > 0) {
      state = (['x', 'y', 'z'] as const).map((axis, component) => propagate(state[component], inputs[index][axis], inputs[index + 1][axis], step, step, omega))
    } else {
      state = (['x', 'y', 'z'] as const).map((axis) => ({ x: inputs[index + 1][axis], v: (inputs[index + 1][axis] - inputs[index][axis]) / step }))
    }
    smoothed.push({ x: state[0].x, y: state[1].x, z: state[2].x })
    const speed = Math.hypot(state[0].v, state[2].v)
    const previous = headings[index]
    const next = speed >= HEADING_MIN_SPEED ? Math.atan2(state[0].v, state[2].v) * 180 / Math.PI : previous
    headings.push(previous + ((((next - previous) + 180) % 360 + 360) % 360 - 180))
  }

  const poseAt = (index: number, fraction: number, subject: StageVec3): CameraFollowPose => {
    const a = smoothed[index]
    const b = smoothed[Math.min(count, index + 1)]
    const base = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, z: a.z + (b.z - a.z) * fraction }
    const heading = follow.frame === 'world' ? 0 : headings[index] + (headings[Math.min(count, index + 1)] - headings[index]) * fraction
    const offset = rotateByYaw(follow.offset, heading)
    const aim = rotateByYaw(follow.aimOffset, heading)
    return {
      position: { x: base.x + offset.x, y: base.y + offset.y, z: base.z + offset.z },
      aimTarget: { x: subject.x + aim.x, y: subject.y + aim.y, z: subject.z + aim.z },
    }
  }

  return (time) => {
    const clamped = Math.max(startTime, Math.min(endTime, time))
    const position = step > 0 ? (clamped - startTime) / step : 0
    const index = Math.min(count - 1, Math.max(0, Math.floor(position)))
    return poseAt(index, Math.max(0, Math.min(1, position - index)), subjectAt(clamped))
  }
}

export function findCameraFollowEntry(entries: readonly StageCameraFollowEntry[] | undefined, cameraId: string, time: number): StageCameraFollowEntry | undefined {
  return entries?.find((entry) => entry.cameraId === cameraId && time >= entry.startTime && time <= entry.endTime)
}
