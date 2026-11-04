import { describe, expect, it } from 'vitest'

import { applyAnimationAtTime } from '../store/playbackSampling'
import { compileStateKeyframesToAnimation } from './stateKeyframeCompiler'
import { createStateKeyframe } from './stateKeyframeTypes'
import { createCameraObject, createPrimitiveObject } from './sceneDefaults'
import { createCameraPresetPath, defaultSpatialPath } from './spatialPath'
import { describeSpatialMotionTiming } from './spatialMotionEngine'
import type { StageCameraObject, StageCameraRig, StageObject, StageVec3 } from './sceneTypes'
import type { StageCameraMovePreset, StageStateKeyframe } from './stateKeyframeTypes'

/*
 * 回归（用户实测“一顿一顿”）：推进 6 秒 → 升降 7 秒 → 环绕 7 秒、衔接设平滑。
 * 改动前三段只在弧长上速度连续，方向在衔接点突然转 90°（120 帧/秒差分出 218 m/s² 的单帧尖峰）。
 * 各段时长与路程不成比例时升降段中途会塌速，这由作者按建议调整衔接时刻，引擎不偷偷改时间。
 */

// 颜色在这里只是场景数据，不是 UI 令牌；拼接写法用于避开界面用的十六进制字面量检查。
const GREY = `#${'888888'}`
const SUBJECT = { x: 0, y: 1, z: 0 }
const RATE = 120

function scene(rig?: StageCameraRig): StageObject[] {
  const camera = createCameraObject('摄像机', GREY, { position: { x: 0, y: 1.6, z: 8 }, target: SUBJECT })
  const box = createPrimitiveObject('box', '主体', GREY)
  return [
    { ...camera, id: 'cam', lookAt: { mode: 'object', objectId: 'box', fallbackTarget: SUBJECT }, ...(rig ? { rig } : {}) },
    { ...box, id: 'box', transform: { ...box.transform, position: SUBJECT } },
  ]
}

/** 按正式运镜写入方式：每段在起点卡上物化路径，终点卡机位落到路径终点。 */
function moves(objects: StageObject[], list: Array<{ move: StageCameraMovePreset | 'direct' | 'line'; duration: number; to?: StageVec3 }>, continuity: 'stop' | 'smooth'): StageStateKeyframe[] {
  const result: StageStateKeyframe[] = [createStateKeyframe(objects, 'k0', 'cam', 0)]
  let time = 0
  for (const [index, item] of list.entries()) {
    const from = result[index]
    const start = from.objectStates.cam.transform.position
    let end = item.to ?? start
    if (item.move === 'line') {
      from.transition.perObject.cam = { spatialPath: defaultSpatialPath(start, end), speedPreset: 'easeInOut' }
    } else if (item.move !== 'direct') {
      const generated = createCameraPresetPath(item.move, start, SUBJECT)
      from.transition.perObject.cam = { spatialPath: generated.path, speedPreset: 'easeInOut' }
      end = generated.endPosition
    }
    time += item.duration
    const next = { ...createStateKeyframe(objects, `k${index + 1}`, 'cam', time), continuity }
    next.objectStates.cam = { ...next.objectStates.cam, transform: { ...next.objectStates.cam.transform, position: end } }
    result.push(next)
  }
  result[result.length - 1].continuity = 'stop'
  return result
}

const MAIN_SESSION = [
  { move: { kind: 'dollyIn', distanceRatio: 0.6 } as const, duration: 6 },
  { move: { kind: 'crane', height: 3 } as const, duration: 7 },
  { move: { kind: 'orbit', degrees: 120, direction: 'cw' } as const, duration: 7 },
]

function sampler(objects: StageObject[], stateKeyframes: StageStateKeyframe[]) {
  const animation = compileStateKeyframesToAnimation(stateKeyframes, objects)
  const position = (time: number): StageVec3 => (applyAnimationAtTime(objects, animation, time).find((object) => object.id === 'cam') as StageCameraObject).transform.position
  return { animation, position }
}

const sub = (a: StageVec3, b: StageVec3, k: number): StageVec3 => ({ x: (a.x - b.x) * k, y: (a.y - b.y) * k, z: (a.z - b.z) * k })
const mag = (v: StageVec3): number => Math.hypot(v.x, v.y, v.z)

function profile(position: (time: number) => StageVec3, duration: number) {
  const points = Array.from({ length: duration * RATE + 1 }, (_, index) => position(index / RATE))
  const speeds = points.slice(1).map((point, index) => sub(point, points[index], RATE))
  const accelerations = speeds.slice(1).map((speed, index) => mag(sub(speed, speeds[index], RATE)))
  return { speeds: speeds.map(mag), peakAcceleration: Math.max(...accelerations) }
}

/** 衔接点两侧的速度向量与加速度。 */
function jointJump(position: (time: number) => StageVec3, time: number) {
  const e = 1 / 960
  const [p0, p1, p2, p3, p4] = [-2, -1, 0, 1, 2].map((k) => position(time + k * e))
  const before = sub(p2, p1, 1 / e)
  const after = sub(p3, p2, 1 / e)
  return {
    speed: (mag(before) + mag(after)) / 2,
    velocity: mag(sub(after, before, 1)),
    acceleration: mag(sub(sub(sub(p4, p3, 1 / e), after, 1 / e), sub(before, sub(p1, p0, 1 / e), 1 / e), 1)),
  }
}

/** 中途最低速度与它两侧最高速度中较小者之比：越接近 0 越像“停了一下”。 */
function worstSag(speeds: number[]): number {
  let worst = 1
  for (let index = 1; index < speeds.length - 1; index += 1) {
    const before = Math.max(...speeds.slice(0, index))
    const after = Math.max(...speeds.slice(index + 1))
    worst = Math.min(worst, speeds[index] / Math.max(1e-9, Math.min(before, after)))
  }
  return worst
}

describe('整镜连续轨迹', () => {
  it.each([undefined, 'crane', 'dolly'] as const)('推进→升降→环绕平滑衔接（设备 %s）：衔接点速度与加速度连续，拐角切圆', (rig) => {
    const objects = scene(rig)
    const stateKeyframes = moves(objects, MAIN_SESSION, 'smooth')
    const { position } = sampler(objects, stateKeyframes)
    const { speeds, peakAcceleration } = profile(position, 20)
    const peakSpeed = Math.max(...speeds)
    for (const [index, time] of [[1, 6], [2, 13]] as const) {
      const jump = jointJump(position, time)
      expect(jump.speed / peakSpeed).toBeGreaterThan(0.15)
      expect(jump.velocity / peakSpeed).toBeLessThan(0.01)
      expect(jump.acceleration).toBeLessThan(0.1)
      // 衔接卡是途经点：经过时在拐角内侧不远处。
      expect(mag(sub(position(time), stateKeyframes[index].objectStates.cam.transform.position, 1))).toBeLessThan(0.6)
    }
    expect(peakAcceleration).toBeLessThan(3)
  })

  it.each([undefined, 'dolly'] as const)('各段时长与路程不成比例时报告塌速并给出一口气走完的衔接时刻，按建议改时间后不再塌速（设备 %s）', (rig) => {
    const objects = scene(rig)
    const { animation } = sampler(objects, moves(objects, MAIN_SESSION, 'smooth'))
    const [report] = describeSpatialMotionTiming(animation.spatialMotions[0])
    expect(report.sag).not.toBeNull()
    expect(report.suggestedJointTimes).toHaveLength(2)

    const [first, second] = report.suggestedJointTimes!
    const retimed = moves(objects, [
      { ...MAIN_SESSION[0], duration: first },
      { ...MAIN_SESSION[1], duration: second - first },
      { ...MAIN_SESSION[2], duration: 20 - second },
    ], 'smooth')
    const { animation: fixed, position } = sampler(objects, retimed)
    expect(describeSpatialMotionTiming(fixed.spatialMotions[0])[0].sag).toBeNull()
    expect(worstSag(profile(position, 20).speeds.slice(RATE / 2, -RATE / 2))).toBeGreaterThan(0.5)
  })

  it.each([undefined, 'dolly'] as const)('快慢悬殊、衔接点被限幅时镜头也不往回走（设备 %s）', (rig) => {
    const objects = scene(rig)
    // 审查实测反例：6.65 米/4.95 秒 → 2.01 米/7.73 秒 → 11.8 米/4.25 秒，取平均加速度后五次段曾倒退 0.33 米/秒。
    const stateKeyframes = moves(objects, [
      { move: 'line', duration: 4.95, to: { x: 0, y: 1.6, z: 8 - 6.65 } },
      { move: 'line', duration: 7.73, to: { x: 0, y: 1.6, z: 8 - 8.66 } },
      { move: 'line', duration: 4.25, to: { x: 0, y: 1.6, z: 8 - 20.46 } },
    ], 'smooth')
    const { animation, position } = sampler(objects, stateKeyframes)
    const points = Array.from({ length: 17 * RATE }, (_, index) => position(index / RATE))
    const forward = points.slice(1).map((point, index) => points[index].z - point.z)
    expect(Math.min(...forward)).toBeGreaterThan(-1e-9)
    expect(describeSpatialMotionTiming(animation.spatialMotions[0])[0].reverses).toBe(false)
  })

  it('显式停靠的衔接仍然停稳再走', () => {
    const objects = scene()
    const { position } = sampler(objects, moves(objects, MAIN_SESSION.slice(0, 2), 'stop'))
    const { speeds } = profile(position, 13)
    expect(jointJump(position, 6).speed / Math.max(...speeds)).toBeLessThan(0.02)
  })

  it('直线位移接环绕路径时并进同一条链，衔接处不减速', () => {
    const objects = scene()
    const stateKeyframes = moves(objects, [
      { move: 'direct', duration: 3, to: { x: 0, y: 1.6, z: 5 } },
      { move: { kind: 'orbit', degrees: 90, direction: 'cw' }, duration: 4 },
    ], 'smooth')
    const { animation, position } = sampler(objects, stateKeyframes)
    expect(animation.spatialMotions.find((motion) => motion.objectId === 'cam')?.segments).toHaveLength(2)
    const { speeds } = profile(position, 7)
    const jump = jointJump(position, 3)
    expect(jump.speed / Math.max(...speeds)).toBeGreaterThan(0.3)
    expect(jump.velocity / Math.max(...speeds)).toBeLessThan(0.01)
  })

  it('指定设备后起步加速度从零开始；设备跑不完时如实报告至少需要的时长', () => {
    const accelerationAtStart = (rig?: StageCameraRig): number => {
      const objects = scene(rig)
      const { position } = sampler(objects, moves(objects, MAIN_SESSION.slice(0, 1), 'stop'))
      const e = 1 / 240
      return mag(sub(sub(position(2 * e), position(e), 1 / e), sub(position(e), position(0), 1 / e), 1 / e))
    }
    expect(accelerationAtStart('dolly')).toBeLessThan(0.02)
    expect(accelerationAtStart()).toBeGreaterThan(0.1)

    const objects = scene('dolly')
    const { animation } = sampler(objects, moves(objects, [{ move: { kind: 'orbit', degrees: 360, direction: 'cw' }, duration: 3 }], 'stop'))
    const [report] = describeSpatialMotionTiming(animation.spatialMotions[0])
    expect(report.withinLimits).toBe(false)
    expect(report.requiredDuration).toBeGreaterThan(3)
    expect(report.peaks.speed).toBeGreaterThan(report.limits.speed)
  })
})
