import type { StageObject, StageVec3 } from '../domain/sceneTypes'
import { calculateStageObjectBounds } from './sceneAnalysis'

/**
 * 场景里挡路的盒子：中心、半尺寸与绕竖直轴的转角。布景楼体只绕竖直轴转，绕水平轴的倾斜不计。
 * 运镜净空检查（摄像机会不会穿楼）与构图遮挡检查（视线会不会被挡）共用这一份几何。
 */
export interface StageObstacle {
  objectId: string
  name: string
  center: StageVec3
  half: StageVec3
  /** 外接球半径，用于粗筛 */
  radius: number
  cos: number
  sin: number
}

export function stageObstacle(object: Pick<StageObject, 'id' | 'name'>, center: StageVec3, half: StageVec3, yawDegrees: number): StageObstacle {
  const yaw = (yawDegrees * Math.PI) / 180
  return {
    objectId: object.id,
    name: object.name,
    center,
    half,
    radius: Math.hypot(half.x, half.y, half.z),
    cos: Math.cos(yaw),
    sin: Math.sin(yaw),
  }
}

/** 对象的整体边界盒，每边外扩 margin。 */
export function stageObjectObstacle(object: StageObject, margin = 0): StageObstacle {
  const bounds = calculateStageObjectBounds(object)
  return stageObstacle(object, bounds.center, {
    x: bounds.size.x / 2 + margin,
    y: bounds.size.y / 2 + margin,
    z: bounds.size.z / 2 + margin,
  }, object.transform.rotation.y)
}

function toObstacleLocal(point: StageVec3, obstacle: StageObstacle): StageVec3 {
  const dx = point.x - obstacle.center.x
  const dz = point.z - obstacle.center.z
  return {
    x: dx * obstacle.cos - dz * obstacle.sin,
    y: point.y - obstacle.center.y,
    z: dx * obstacle.sin + dz * obstacle.cos,
  }
}

/** 线段与以原点为中心的盒子相交（slab 法），端点已换到盒子局部坐标。 */
function localSegmentHitsBox(from: StageVec3, to: StageVec3, half: StageVec3): boolean {
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

export function segmentHitsObstacle(from: StageVec3, to: StageVec3, obstacle: StageObstacle): boolean {
  return localSegmentHitsBox(toObstacleLocal(from, obstacle), toObstacleLocal(to, obstacle), obstacle.half)
}

export function pointInsideObstacle(point: StageVec3, obstacle: StageObstacle, margin = 0): boolean {
  const local = toObstacleLocal(point, obstacle)
  return Math.abs(local.x) <= obstacle.half.x + margin
    && Math.abs(local.y) <= obstacle.half.y + margin
    && Math.abs(local.z) <= obstacle.half.z + margin
}
