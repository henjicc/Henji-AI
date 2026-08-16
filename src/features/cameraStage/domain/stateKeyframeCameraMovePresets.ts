/**
 * 摄像机运镜预设几何与采样（纯函数，禁止 UI/three/store 依赖）。
 *
 * 每种预设把「起始机位 + 取景目标 + 参数」转换为一串按时间升序的采样点
 * （time ∈ [segStart, segEnd] + 三维位置），供 stateKeyframeCompiler.ts 的
 * compileCameraPositionGroup 写入 transform.position.x/y/z 三条 scalar 轨道。
 *
 * - orbit：绕世界 Y 轴、以目标为圆心，起始半径/高度不变，每 ~15° 一个中间关键帧
 *   近似圆弧；整体速度感通过对采样点的时间做「缓动反解」（invertEasing）实现非
 *   均匀时间分布——点位按角度均匀采样（保证圆弧近似质量与速度无关），采样点之间
 *   统一用 linear 分段（避免和时间重映射的缓动叠加出双重非线性）。
 * - dollyIn/dollyOut：沿「机位→目标」连线按 distanceRatio 缩放距离，首尾两点 + easing。
 * - truck：在水平面内垂直于视线方向平移 offset，首尾两点 + easing。
 * - crane：沿世界 Y 轴平移 height（不依赖目标点），首尾两点 + easing。
 *
 * 环绕（orbit）终点语义（重要记录 003 定稿）：终点由环绕几何决定，不取 B 卡快照中
 * 的原始机位——本文件只负责几何计算，B 卡快照被忽略/覆盖的决策落在 stateKeyframeCompiler.ts。
 */

import type { StageEasingPreset } from './animationTypes'
import { easeProgress } from './keyframeEngine'
import type { StageVec3 } from './sceneTypes'
import type { StageCameraMove } from './stateKeyframeTypes'

/** 环绕预设每个中间关键帧覆盖的角度步长（度）；越小圆弧近似越平滑，代价是关键帧更密 */
export const ORBIT_DEGREES_PER_KEYFRAME = 15

/** 运镜预设参数一期推荐默认值：供 2.3 细节层 UI 初始值参考，也是本文件内部参数非法时的兜底 */
export const STAGE_CAMERA_MOVE_DEFAULTS = {
  orbitDegrees: 90,
  orbitDirection: 'cw' as const,
  dollyInRatio: 0.5,
  dollyOutRatio: 1.8,
  truckOffset: 2,
  craneHeight: 2,
}

/** 一个运镜采样点：时间 + 世界坐标位置 + 到下一点的分段缓动 */
export interface CameraMoveKeyframePoint {
  time: number
  position: StageVec3
  easing: StageEasingPreset
}

type NonDirectCameraMove = Exclude<StageCameraMove, { kind: 'direct' }>

function addVec3(a: StageVec3, b: StageVec3): StageVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function subVec3(a: StageVec3, b: StageVec3): StageVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scaleVec3(v: StageVec3, factor: number): StageVec3 {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor }
}

/** 绕世界 Y 轴旋转向量（弧度制，右手系，与 three.js Matrix4.makeRotationY 同约定，但纯数学实现不依赖 three） */
function rotateAroundY(v: StageVec3, angleRad: number): StageVec3 {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  return { x: v.x * cos + v.z * sin, y: v.y, z: -v.x * sin + v.z * cos }
}

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** 数值反解缓动：求 u∈[0,1] 使 easeProgress(easing,u) ≈ target（easeProgress 单调递增，二分收敛） */
function invertEasing(easing: StageEasingPreset, target: number): number {
  if (target <= 0) return 0
  if (target >= 1) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2
    const value = easeProgress(easing, mid)
    if (value < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 环绕：以 targetPosition 为圆心绕世界 Y 轴扫过 degrees（direction 决定正负角），半径/高度不变 */
function orbitSamples(
  move: Extract<StageCameraMove, { kind: 'orbit' }>,
  fromPosition: StageVec3,
  targetPosition: StageVec3,
  segStart: number,
  segEnd: number,
  easing: StageEasingPreset,
): CameraMoveKeyframePoint[] {
  const degrees = Number.isFinite(move.degrees) ? move.degrees : 0
  if (degrees === 0) {
    return [
      { time: segStart, position: fromPosition, easing: 'linear' },
      { time: segEnd, position: fromPosition, easing: 'linear' },
    ]
  }

  const sign = move.direction === 'ccw' ? 1 : -1
  const totalRad = degToRad(Math.abs(degrees)) * sign
  const stepCount = Math.max(1, Math.round(Math.abs(degrees) / ORBIT_DEGREES_PER_KEYFRAME))
  const relStart = subVec3(fromPosition, targetPosition)

  const points: CameraMoveKeyframePoint[] = []
  for (let i = 0; i <= stepCount; i += 1) {
    const s = i / stepCount
    const position = addVec3(targetPosition, rotateAroundY(relStart, totalRad * s))
    const u = invertEasing(easing, s)
    const time = segStart + (segEnd - segStart) * u
    points.push({ time, position, easing: 'linear' })
  }
  return points
}

/** 推近/拉远：沿「机位→目标」连线按 distanceRatio 缩放距离（0.5=推到一半距离，>1=拉远） */
function dollySamples(
  move: Extract<StageCameraMove, { kind: 'dollyIn' | 'dollyOut' }>,
  fromPosition: StageVec3,
  targetPosition: StageVec3,
  segStart: number,
  segEnd: number,
  easing: StageEasingPreset,
): CameraMoveKeyframePoint[] {
  const fallback =
    move.kind === 'dollyIn' ? STAGE_CAMERA_MOVE_DEFAULTS.dollyInRatio : STAGE_CAMERA_MOVE_DEFAULTS.dollyOutRatio
  const ratio = Number.isFinite(move.distanceRatio) && move.distanceRatio >= 0 ? move.distanceRatio : fallback
  const endPosition = addVec3(targetPosition, scaleVec3(subVec3(fromPosition, targetPosition), ratio))
  return [
    { time: segStart, position: fromPosition, easing },
    { time: segEnd, position: endPosition, easing: 'linear' },
  ]
}

/** 横移：在水平面内垂直于「机位→目标」视线方向平移 offset（正值 = 视线右侧，right = normalize(cross(viewDir, worldUp))） */
function truckSamples(
  move: Extract<StageCameraMove, { kind: 'truck' }>,
  fromPosition: StageVec3,
  targetPosition: StageVec3,
  segStart: number,
  segEnd: number,
  easing: StageEasingPreset,
): CameraMoveKeyframePoint[] {
  const offset = Number.isFinite(move.offset) ? move.offset : STAGE_CAMERA_MOVE_DEFAULTS.truckOffset
  const viewDir = subVec3(targetPosition, fromPosition)
  const horizontalLen = Math.sqrt(viewDir.x * viewDir.x + viewDir.z * viewDir.z)
  // 水平分量退化（机位正好在目标正上/正下方）时退回世界 +X，避免除零
  const right =
    horizontalLen > 1e-6
      ? { x: -viewDir.z / horizontalLen, y: 0, z: viewDir.x / horizontalLen }
      : { x: 1, y: 0, z: 0 }
  const endPosition = addVec3(fromPosition, scaleVec3(right, offset))
  return [
    { time: segStart, position: fromPosition, easing },
    { time: segEnd, position: endPosition, easing: 'linear' },
  ]
}

/** 升降：沿世界 Y 轴平移 height，不依赖目标点 */
function craneSamples(
  move: Extract<StageCameraMove, { kind: 'crane' }>,
  fromPosition: StageVec3,
  _targetPosition: StageVec3,
  segStart: number,
  segEnd: number,
  easing: StageEasingPreset,
): CameraMoveKeyframePoint[] {
  const height = Number.isFinite(move.height) ? move.height : STAGE_CAMERA_MOVE_DEFAULTS.craneHeight
  const endPosition = { x: fromPosition.x, y: fromPosition.y + height, z: fromPosition.z }
  return [
    { time: segStart, position: fromPosition, easing },
    { time: segEnd, position: endPosition, easing: 'linear' },
  ]
}

/**
 * 编译单个非 direct 运镜预设在本段过渡的采样点序列
 * （多点近似 orbit 圆弧 / 两点直插 dollyIn·dollyOut·truck·crane）。
 * 供 stateKeyframeCompiler.ts 的 compileCameraPositionGroup 调用，写入 x/y/z 三条 scalar 轨道。
 */
export function compileCameraMoveSamples(
  move: NonDirectCameraMove,
  fromPosition: StageVec3,
  targetPosition: StageVec3,
  segStart: number,
  segEnd: number,
  easing: StageEasingPreset,
): CameraMoveKeyframePoint[] {
  switch (move.kind) {
    case 'orbit':
      return orbitSamples(move, fromPosition, targetPosition, segStart, segEnd, easing)
    case 'dollyIn':
    case 'dollyOut':
      return dollySamples(move, fromPosition, targetPosition, segStart, segEnd, easing)
    case 'truck':
      return truckSamples(move, fromPosition, targetPosition, segStart, segEnd, easing)
    case 'crane':
      return craneSamples(move, fromPosition, targetPosition, segStart, segEnd, easing)
    default:
      return [
        { time: segStart, position: fromPosition, easing },
        { time: segEnd, position: fromPosition, easing: 'linear' },
      ]
  }
}
