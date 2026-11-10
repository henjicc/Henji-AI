import type { StageSceneAnimation } from '../domain/animationTypes'
import type { StageObject, StageVec3 } from '../domain/sceneTypes'
import { animationForObjects, sampleAnimationFrame, sampleObjectTrajectory } from '../store/playbackSampling'
import { segmentHitsObstacle, stageObjectObstacle, type StageObstacle } from './stageObstacles'

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

interface CameraPathObstruction {
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

export function checkCameraPathClearance(
  objects: StageObject[],
  animation: StageSceneAnimation,
  cameraId: string,
  range: { start: number; end: number },
): CameraPathClearance {
  const camera = objects.find((object) => object.id === cameraId)
  if (!camera || !(range.end > range.start)) return { obstructions: [], obstructionCount: 0, belowGroundAt: null }
  const timesFor = (count: number): number[] => Array.from({ length: count + 1 }, (_, index) => range.start + ((range.end - range.start) * index) / count)
  const positionsAt = (times: number[]): StageVec3[] => sampleObjectTrajectory(objects, animation, cameraId, times)

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
  const nearPath = (obstacle: StageObstacle): boolean => (['x', 'y', 'z'] as const).every((axis) => (
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
    const source = animated.has(object.id) ? animationForObjects(animation, new Set([object.id])) : null
    const fixed = source ? null : stageObjectObstacle(object, CAMERA_CLEARANCE)
    if (fixed && !nearPath(fixed)) continue
    for (let index = 1; index < positions.length; index += 1) {
      const obstacle = fixed ?? stageObjectObstacle(sampleAnimationFrame([object], source!, times[index - 1]).objects[0], CAMERA_CLEARANCE)
      if (segmentHitsObstacle(positions[index - 1], positions[index], obstacle)) {
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

/** 净空问题怎么改：穿过对象时一句、钻地时一句，按运镜种类给。 */
export interface CameraPathClearanceAdvice {
  obstruction: string
  belowGround: string
}

/** 轨迹撞楼或钻地时说清穿过了谁、第几秒、撤销后怎么改；通畅时为 null。 */
export function describeCameraPathClearance(clearance: CameraPathClearance, advice: CameraPathClearanceAdvice): string | null {
  if (clearance.obstructionCount === 0 && clearance.belowGroundAt === null) return null
  const facts: string[] = []
  const fixes: string[] = []
  if (clearance.obstructionCount > 0) {
    const first = clearance.obstructions[0]
    facts.push(`轨迹在 ${first.time.toFixed(1)} 秒穿过「${first.name}」${clearance.obstructionCount > 1 ? `等 ${clearance.obstructionCount} 个对象` : ''}`)
    fixes.push(advice.obstruction)
  }
  if (clearance.belowGroundAt !== null) {
    facts.push(`在 ${clearance.belowGroundAt.toFixed(1)} 秒低于地面`)
    fixes.push(advice.belowGround)
  }
  return `${facts.join('，')}：撤销后${[...new Set(fixes)].join('；')}，再重新应用。`
}
