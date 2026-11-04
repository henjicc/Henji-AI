import type { StageAnimationSampleSource, StageSceneAnimation } from '../domain/animationTypes'
import type { StageObject, StageVec3 } from '../domain/sceneTypes'
import { sampleAnimationFrame } from '../store/playbackSampling'
import { calculateStageObjectBounds } from './sceneAnalysis'

/**
 * 运镜轨迹的净空检查：沿编译后的真实轨迹取样，看摄像机有没有穿进楼、角色或钻到地面以下。
 *
 * 只报告不改轨迹：环绕半径、升降高度是构图意图，自动外推会悄悄改掉镜头；
 * 把穿过了谁、在第几秒告诉助手，由它调整后重做。注视对象照样检查：推得太近、环绕半径小于楼宽
 * 正是最常见的穿模。对象按绕竖直轴转过的盒子算（布景楼体只绕竖直轴转），绕水平轴的倾斜不计；
 * 会动的对象按每个取样时刻的位置算。
 */

/** 镜头离楼面再近也该留出的余量（米） */
const CAMERA_CLEARANCE = 0.3
const GROUND_CLEARANCE = 0.05
/** 相邻取样点最多相隔多远（米）：长弧线按长度加密，弦不会切进弧内侧的楼 */
const MAX_SAMPLE_SPACING = 0.5
const MIN_SAMPLES = 96
const MAX_SAMPLES = 4000
const REPORT_LIMIT = 8

export interface CameraPathObstruction {
  objectId: string
  name: string
  /** 第一次碰到它的时间（秒） */
  time: number
}

export interface CameraPathClearance {
  obstructions: CameraPathObstruction[]
  /** 碰到的对象总数；obstructions 只列最早的几个 */
  obstructionCount: number
  /** 第一次低于地面的时间（秒）；没有为 null */
  belowGroundAt: number | null
}

interface Obstacle {
  center: StageVec3
  half: StageVec3
  /** 外接球半径，用于和整条轨迹的包围盒粗筛 */
  radius: number
  cos: number
  sin: number
}

function obstacleOf(object: StageObject): Obstacle {
  const bounds = calculateStageObjectBounds(object)
  const yaw = (object.transform.rotation.y * Math.PI) / 180
  const half = {
    x: bounds.size.x / 2 + CAMERA_CLEARANCE,
    y: bounds.size.y / 2 + CAMERA_CLEARANCE,
    z: bounds.size.z / 2 + CAMERA_CLEARANCE,
  }
  return { center: bounds.center, half, radius: Math.hypot(half.x, half.y, half.z), cos: Math.cos(yaw), sin: Math.sin(yaw) }
}

function toLocal(point: StageVec3, obstacle: Obstacle): StageVec3 {
  const dx = point.x - obstacle.center.x
  const dz = point.z - obstacle.center.z
  return {
    x: dx * obstacle.cos - dz * obstacle.sin,
    y: point.y - obstacle.center.y,
    z: dx * obstacle.sin + dz * obstacle.cos,
  }
}

/** 线段与以原点为中心的盒子相交（slab 法）。 */
function segmentHitsBox(from: StageVec3, to: StageVec3, half: StageVec3): boolean {
  let enter = 0
  let exit = 1
  for (const axis of ['x', 'y', 'z'] as const) {
    const start = from[axis]
    const delta = to[axis] - start
    if (Math.abs(delta) < 1e-12) {
      if (start < -half[axis] || start > half[axis]) return false
      continue
    }
    let t0 = (-half[axis] - start) / delta
    let t1 = (half[axis] - start) / delta
    if (t0 > t1) [t0, t1] = [t1, t0]
    enter = Math.max(enter, t0)
    exit = Math.min(exit, t1)
    if (enter > exit) return false
  }
  return true
}

function animationOf(animation: StageSceneAnimation, objectId: string): StageAnimationSampleSource {
  return {
    tracks: animation.tracks.filter((track) => track.objectId === objectId),
    spatialMotions: animation.spatialMotions.filter((motion) => motion.objectId === objectId),
    cameraOrientations: [],
  }
}

function sampleObject(object: StageObject, source: StageAnimationSampleSource, time: number): StageObject {
  return sampleAnimationFrame([object], source, time).objects[0]
}

export function checkCameraPathClearance(
  objects: StageObject[],
  animation: StageSceneAnimation,
  cameraId: string,
  range: { start: number; end: number },
): CameraPathClearance {
  const camera = objects.find((object) => object.id === cameraId)
  if (!camera || !(range.end > range.start)) return { obstructions: [], obstructionCount: 0, belowGroundAt: null }
  const cameraSource = animationOf(animation, cameraId)
  const timesFor = (count: number): number[] => Array.from({ length: count + 1 }, (_, index) => range.start + ((range.end - range.start) * index) / count)
  const positionsAt = (times: number[]): StageVec3[] => times.map((time) => sampleObject(camera, cameraSource, time).transform.position)

  let times = timesFor(MIN_SAMPLES)
  let positions = positionsAt(times)
  let length = 0
  for (let index = 1; index < positions.length; index += 1) {
    const a = positions[index - 1]
    const b = positions[index]
    length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
  }
  const count = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.ceil(length / MAX_SAMPLE_SPACING)))
  if (count > MIN_SAMPLES) {
    times = timesFor(count)
    positions = positionsAt(times)
  }

  const belowGroundIndex = positions.findIndex((position) => position.y < GROUND_CLEARANCE)
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const position of positions) {
    for (const axis of ['x', 'y', 'z'] as const) {
      min[axis] = Math.min(min[axis], position[axis])
      max[axis] = Math.max(max[axis], position[axis])
    }
  }
  const nearPath = (obstacle: Obstacle): boolean => (['x', 'y', 'z'] as const).every((axis) => (
    obstacle.center[axis] + obstacle.radius >= min[axis] && obstacle.center[axis] - obstacle.radius <= max[axis]
  ))

  // 只有位置、朝向、缩放会动的才逐时刻求盒子；只改颜色、姿态的按静态算
  const animated = new Set([
    ...animation.tracks.filter((track) => track.propertyPath.startsWith('transform.')).map((track) => track.objectId),
    ...animation.spatialMotions.map((motion) => motion.objectId),
  ])
  const hits: CameraPathObstruction[] = []
  for (const object of objects) {
    if (!object.visible || object.type === 'camera') continue
    const source = animated.has(object.id) ? animationOf(animation, object.id) : null
    const fixed = source ? null : obstacleOf(object)
    if (fixed && !nearPath(fixed)) continue
    for (let index = 1; index < positions.length; index += 1) {
      const obstacle = fixed ?? obstacleOf(sampleObject(object, source!, times[index - 1]))
      if (segmentHitsBox(toLocal(positions[index - 1], obstacle), toLocal(positions[index], obstacle), obstacle.half)) {
        hits.push({ objectId: object.id, name: object.name, time: times[index - 1] })
        break
      }
    }
  }
  hits.sort((a, b) => a.time - b.time)
  return {
    obstructions: hits.slice(0, REPORT_LIMIT),
    obstructionCount: hits.length,
    belowGroundAt: belowGroundIndex < 0 ? null : times[belowGroundIndex],
  }
}
