import type { StageAnimationSampleSource } from '../domain/animationTypes'
import type { StageCameraObject, StageObject, StageVec3 } from '../domain/sceneTypes'
import { describeSpatialMotionTiming, type StageSpatialMotionTimingReport } from '../domain/spatialMotionEngine'
import { sampleAnimationFrame } from '../store/playbackSampling'

/**
 * 运镜平滑度度量：沿时间按固定步长采样正式采样内核（与播放、导出同一条），用差分求速度、加速度、加加速度
 * 与镜头角速度，并在每个衔接点两侧比较速度向量、加速度与角速度有没有跳变。
 * 结果写进运镜能力的结果证据，助手据此自检“有没有一顿一顿”。
 */

export interface CameraMotionJointSmoothness {
  time: number
  /** 经过衔接点时的速度（米/秒） */
  speed: number
  /** 衔接点两侧速度向量之差（米/秒）；连续运动只有采样步长带来的极小值。 */
  velocityJump: number
  /** 衔接点两侧加速度之差（米/秒²） */
  accelerationJump: number
  /** 衔接点两侧镜头角速度之差（度/秒） */
  angularSpeedJump: number
}

export interface CameraMotionSmoothness {
  start: number
  end: number
  peakSpeed: number
  peakAcceleration: number
  peakJerk: number
  peakAngularSpeed: number
  joints: CameraMotionJointSmoothness[]
  /** 中途速度掉到接近零又重新起步的时刻（秒）。 */
  stops: number[]
  /** 这条链的塌速、倒退与运镜设备上限检查；不在空间路径链上时为 null。 */
  timing: StageSpatialMotionTimingReport | null
}

const SAMPLE_RATE = 120
const JOINT_PROBE = 1 / 960
const STOP_RATIO = 0.03
const MOVING_RATIO = 0.2
const DEG = 180 / Math.PI

function difference(a: StageVec3, b: StageVec3, scale: number): StageVec3 {
  return { x: (a.x - b.x) * scale, y: (a.y - b.y) * scale, z: (a.z - b.z) * scale }
}

function magnitude(value: StageVec3): number {
  return Math.hypot(value.x, value.y, value.z)
}

function forwardOf(rotation: StageVec3): StageVec3 {
  const pitch = rotation.x / DEG
  const yaw = rotation.y / DEG
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) }
}

function angle(a: StageVec3, b: StageVec3): number {
  return Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * DEG
}

/** 采样只带摄像机与它注视的对象：城市布景有上万个对象，逐帧整场景求值没有必要。 */
function cameraSampler(objects: StageObject[], animation: StageAnimationSampleSource, cameraId: string) {
  const camera = objects.find((object): object is StageCameraObject => object.id === cameraId && object.type === 'camera')
  if (!camera) return null
  const target = camera.lookAt.mode === 'object' ? objects.find((object) => object.id === (camera.lookAt as { objectId: string }).objectId) : undefined
  // 跟拍区间的机位由主体决定，主体也要一起采样。
  const followed = new Set((animation.cameraFollows ?? []).filter((entry) => entry.cameraId === cameraId).map((entry) => entry.follow.subjectId))
  const involved = [camera, ...objects.filter((object) => object !== camera && (object === target || followed.has(object.id)))]
  return (time: number): { position: StageVec3; forward: StageVec3 } => {
    const sampled = sampleAnimationFrame(involved, animation, time).objects[0]
    return { position: sampled.transform.position, forward: forwardOf(sampled.transform.rotation) }
  }
}

export function measureCameraMotionSmoothness(
  objects: StageObject[],
  animation: StageAnimationSampleSource,
  cameraId: string,
  range: { start: number; end: number },
  jointTimes: number[],
): CameraMotionSmoothness | null {
  const sample = cameraSampler(objects, animation, cameraId)
  if (!sample || !(range.end > range.start)) return null
  const count = Math.max(4, Math.ceil((range.end - range.start) * SAMPLE_RATE))
  const frames = Array.from({ length: count + 1 }, (_, index) => sample(range.start + (range.end - range.start) * index / count))
  const dt = (range.end - range.start) / count
  const velocities = frames.slice(1).map((frame, index) => difference(frame.position, frames[index].position, 1 / dt))
  const accelerations = velocities.slice(1).map((velocity, index) => difference(velocity, velocities[index], 1 / dt))
  const jerks = accelerations.slice(1).map((acceleration, index) => difference(acceleration, accelerations[index], 1 / dt))
  const speeds = velocities.map(magnitude)
  const peakSpeed = Math.max(0, ...speeds)

  const stops: number[] = []
  for (let index = 1; index < speeds.length - 1; index += 1) {
    if (speeds[index] > STOP_RATIO * peakSpeed || speeds[index] > speeds[index - 1] || speeds[index] > speeds[index + 1]) continue
    const movingBefore = speeds.slice(0, index).some((speed) => speed > MOVING_RATIO * peakSpeed)
    const movingAfter = speeds.slice(index + 1).some((speed) => speed > MOVING_RATIO * peakSpeed)
    const time = range.start + (index + 0.5) * dt
    if (movingBefore && movingAfter && (stops.length === 0 || time - stops[stops.length - 1] > 0.25)) stops.push(time)
  }

  const joints = jointTimes
    .filter((time) => time > range.start + 2 * JOINT_PROBE && time < range.end - 2 * JOINT_PROBE)
    .map((time): CameraMotionJointSmoothness => {
      const [p0, p1, p2, p3, p4] = [-2, -1, 0, 1, 2].map((offset) => sample(time + offset * JOINT_PROBE))
      const before = difference(p2.position, p1.position, 1 / JOINT_PROBE)
      const after = difference(p3.position, p2.position, 1 / JOINT_PROBE)
      const accelerationBefore = difference(before, difference(p1.position, p0.position, 1 / JOINT_PROBE), 1 / JOINT_PROBE)
      const accelerationAfter = difference(difference(p4.position, p3.position, 1 / JOINT_PROBE), after, 1 / JOINT_PROBE)
      return {
        time,
        speed: (magnitude(before) + magnitude(after)) / 2,
        velocityJump: magnitude(difference(after, before, 1)),
        accelerationJump: magnitude(difference(accelerationAfter, accelerationBefore, 1)),
        angularSpeedJump: Math.abs(angle(p2.forward, p3.forward) - angle(p1.forward, p2.forward)) / JOINT_PROBE,
      }
    })

  const angularSpeeds = frames.slice(1).map((frame, index) => angle(frames[index].forward, frame.forward) / dt)
  const timingReports = animation.spatialMotions
    .filter((motion) => motion.objectId === cameraId)
    .flatMap(describeSpatialMotionTiming)
    .filter((report) => report.startTime < range.end && report.endTime > range.start)
  return {
    start: range.start,
    end: range.end,
    peakSpeed,
    peakAcceleration: Math.max(0, ...accelerations.map(magnitude)),
    peakJerk: Math.max(0, ...jerks.map(magnitude)),
    peakAngularSpeed: Math.max(0, ...angularSpeeds),
    joints,
    stops,
    timing: timingReports.find((report) => Math.abs(report.startTime - range.start) <= 1e-4 && Math.abs(report.endTime - range.end) <= 1e-4) ?? null,
  }
}

/** 衔接点速度向量跳变超过峰值速度的这个比例，就算“顿了一下”。 */
export const CAMERA_JOINT_JUMP_RATIO = 0.05
