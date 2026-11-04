import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Shape,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { STAGE_SET_DECOR_STRIDE, type StageSet, type StageSetMarkingKind, type StageSetSurfaceKind } from '../domain/sceneTypes'
import type { VehicleType } from '../domain/stageSetProps'
import { stageSetPlacement, stageSetToWorld, type StageSetPlacement } from '../domain/stageSetPlacement'

/*
 * 布景装饰的几何体与实例矩阵：铺装与标线是单位方块 / 单位平面按实例缩放，路灯与车辆是按真实尺寸
 * 拼出来的低多边形模型（模型车头朝局部 +Z）。同一种东西不论几片布景、多少个，都进同一个实例网格。
 */

const DEG2RAD = Math.PI / 180

/** 各铺装的顶面高度与厚度（米）。人行道只抬 4 厘米：角色和自动布置都落在 y=0，抬成真实的 15 厘米路缘会把脚埋进去。 */
export const SURFACE_LEVELS: Record<StageSetSurfaceKind, { top: number; thickness: number }> = {
  road: { top: 0.02, thickness: 0.06 },
  sidewalk: { top: 0.04, thickness: 0.08 },
  plaza: { top: 0.04, thickness: 0.08 },
  curb: { top: 0.05, thickness: 0.09 },
  lawn: { top: 0.055, thickness: 0.04 },
  median: { top: 0.15, thickness: 0.18 },
}

/** 标线宽度与虚线节奏（米）；period 为 0 表示实线。人行横道是一条横过车行道的宽线，斑马纹按 1 米一个周期。 */
export const MARKING_STYLES: Record<StageSetMarkingKind, { width: number; period: number; on: number }> = {
  laneDashed: { width: 0.15, period: 9, on: 3 },
  edgeLine: { width: 0.15, period: 0, on: 0 },
  centerLine: { width: 0.15, period: 0, on: 0 },
  stopLine: { width: 0.4, period: 0, on: 0 },
  crosswalk: { width: 4, period: 1, on: 0.45 },
}

export const MARKING_HEIGHT = 0.026

/** 换算到场景坐标：装饰实例与楼体对象共用 stageSetToWorld。 */
function placementOf(set: StageSet): { placement: StageSetPlacement; rotation: number } {
  const placement = stageSetPlacement(set.params)
  return { placement, rotation: placement.rotation * DEG2RAD }
}

const scratchMatrix = new Matrix4()
const scratchPosition = new Vector3()
const scratchQuaternion = new Quaternion()
const scratchScale = new Vector3()
const UP = new Vector3(0, 1, 0)

/** 一组实例：矩阵按 16 个数一段连续存放，颜色序号可选。 */
export interface InstanceList {
  matrices: Float32Array
  count: number
  /** 与实例一一对应的颜色序号；没有就用材质本色 */
  colors?: Uint8Array
}

function compose(target: Float32Array, index: number, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number): void {
  scratchPosition.set(x, y, z)
  scratchQuaternion.setFromAxisAngle(UP, yaw)
  scratchScale.set(sx, sy, sz)
  scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale).toArray(target, index * 16)
}

function totalOf(sets: readonly StageSet[], read: (set: StageSet) => number[] | undefined, stride: number): number {
  return sets.reduce((sum, set) => sum + Math.floor((read(set)?.length ?? 0) / stride), 0)
}

export function surfaceInstances(sets: readonly StageSet[], kind: StageSetSurfaceKind): InstanceList {
  const stride = STAGE_SET_DECOR_STRIDE.surface
  const count = totalOf(sets, set => set.decor?.surfaces[kind], stride)
  const matrices = new Float32Array(count * 16)
  const level = SURFACE_LEVELS[kind]
  let index = 0
  for (const set of sets) {
    const values = set.decor?.surfaces[kind]
    if (!values) continue
    const { placement, rotation } = placementOf(set)
    for (let offset = 0; offset + stride <= values.length; offset += stride) {
      const world = stageSetToWorld(placement, values[offset], values[offset + 1])
      compose(matrices, index, world.x, level.top - level.thickness / 2, world.z, rotation, values[offset + 2], level.thickness, values[offset + 3])
      index += 1
    }
  }
  return { matrices, count }
}

/** 标线：单位平面的局部 +Z 对准线段方向，Z 向缩放就是线长（着色器按它算虚线）。 */
export function markingInstances(sets: readonly StageSet[], kind: StageSetMarkingKind): InstanceList {
  const stride = STAGE_SET_DECOR_STRIDE.marking
  const count = totalOf(sets, set => set.decor?.markings[kind], stride)
  const matrices = new Float32Array(count * 16)
  const width = MARKING_STYLES[kind].width
  let index = 0
  for (const set of sets) {
    const values = set.decor?.markings[kind]
    if (!values) continue
    const { placement } = placementOf(set)
    for (let offset = 0; offset + stride <= values.length; offset += stride) {
      const from = stageSetToWorld(placement, values[offset], values[offset + 1])
      const to = stageSetToWorld(placement, values[offset + 2], values[offset + 3])
      const length = Math.hypot(to.x - from.x, to.z - from.z)
      compose(matrices, index, (from.x + to.x) / 2, MARKING_HEIGHT, (from.z + to.z) / 2, Math.atan2(to.x - from.x, to.z - from.z), width, 1, length)
      index += 1
    }
  }
  return { matrices, count }
}

/** 树、路灯、车辆：按某一列的序号分到各自的网格（树种、车型），返回每个序号一组实例。 */
export function propInstances(
  sets: readonly StageSet[],
  read: (set: StageSet) => number[] | undefined,
  stride: number,
  groupColumn: number | null,
  groups: number,
  transform: (values: number[], offset: number) => { yaw: number; scale: number; y?: number; scaleY?: number },
  colorColumn: number | null,
): InstanceList[] {
  const counts = new Array(groups).fill(0)
  for (const set of sets) {
    const values = read(set)
    if (!values) continue
    for (let offset = 0; offset + stride <= values.length; offset += stride) {
      const group = groupColumn === null ? 0 : values[offset + groupColumn]
      if (group >= 0 && group < groups) counts[group] += 1
    }
  }
  const lists: InstanceList[] = counts.map(count => ({
    matrices: new Float32Array(count * 16),
    count: 0,
    ...(colorColumn === null ? {} : { colors: new Uint8Array(count) }),
  }))
  for (const set of sets) {
    const values = read(set)
    if (!values) continue
    const { placement, rotation } = placementOf(set)
    for (let offset = 0; offset + stride <= values.length; offset += stride) {
      const group = groupColumn === null ? 0 : values[offset + groupColumn]
      const list = lists[group]
      if (!list) continue
      const { yaw, scale, y = 0, scaleY = scale } = transform(values, offset)
      const world = stageSetToWorld(placement, values[offset], values[offset + 1])
      compose(list.matrices, list.count, world.x, y, world.z, rotation + yaw * DEG2RAD, scale, scaleY, scale)
      if (list.colors && colorColumn !== null) list.colors[list.count] = values[offset + colorColumn]
      list.count += 1
    }
  }
  return lists
}

// ---------------------------------------------------------------------------------------------
// 模型
// ---------------------------------------------------------------------------------------------

export function surfaceGeometry(): BufferGeometry {
  return new BoxGeometry(1, 1, 1)
}

export function markingGeometry(): BufferGeometry {
  return new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
}

/** 路灯杆：底在 0、高 1 的锥形圆柱，按杆高纵向缩放。 */
export function lampPoleGeometry(): BufferGeometry {
  return new CylinderGeometry(0.07, 0.11, 1, 8).translate(0, 0.5, 0)
}

/** 灯臂与灯头：挂在杆顶（局部原点）下，向 +Z 伸出 1.8 米。 */
export function lampHeadGeometry(): BufferGeometry {
  const arm = new BoxGeometry(0.08, 0.08, 1.8).translate(0, -0.1, 0.85)
  const head = new BoxGeometry(0.32, 0.12, 0.7).translate(0, -0.2, 1.7)
  return mergeGeometries([arm, head]) as BufferGeometry
}

/** 侧面轮廓（沿车长 z、竖直 y）沿 x 拉伸成车身：车头朝 +Z。 */
function extrudeProfile(points: Array<[number, number]>, width: number): BufferGeometry {
  const shape = new Shape()
  shape.moveTo(points[0][0], points[0][1])
  for (const [z, y] of points.slice(1)) shape.lineTo(z, y)
  shape.closePath()
  const geometry = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false })
  // 拉伸方向（局部 z）转成车宽方向 x，轮廓的横轴转成车长方向 z。
  geometry.rotateY(-Math.PI / 2)
  geometry.translate(width / 2, 0, 0)
  return geometry.toNonIndexed()
}

export interface VehicleGeometry { body: BufferGeometry; glass: BufferGeometry; wheels: BufferGeometry }

function wheelGeometry(type: VehicleType): BufferGeometry {
  const wheels: BufferGeometry[] = []
  const axle = type.length / 2 - Math.max(0.75, type.length * 0.17)
  const track = type.width / 2 - 0.13
  for (const z of [axle, -axle]) {
    for (const x of [track, -track]) {
      wheels.push(new CylinderGeometry(type.wheelRadius, type.wheelRadius, 0.24, 10).rotateZ(Math.PI / 2).translate(x, type.wheelRadius, z))
    }
  }
  return mergeGeometries(wheels) as BufferGeometry
}

/** 按车型外廓拼出低多边形车：车身轮廓拉伸、车窗是收进一点的深色车厢、四个轮子。 */
export function vehicleGeometry(type: VehicleType): VehicleGeometry {
  const half = type.length / 2
  const belt = type.height - type.cabin.height
  const front = half - type.cabin.start * type.length
  const back = half - type.cabin.end * type.length
  const glassWidth = type.width - type.cabin.inset * 2
  let body: BufferGeometry
  let glass: BufferGeometry
  if (type.name === '公交车') {
    body = new BoxGeometry(type.width, type.height - type.clearance, type.length).translate(0, type.clearance + (type.height - type.clearance) / 2, 0)
    glass = new BoxGeometry(type.width + 0.02, type.cabin.height, type.length * 0.94).translate(0, type.height - 0.35 - type.cabin.height / 2, 0)
  } else if (type.name === '货车') {
    const cab = new BoxGeometry(type.width, 2.5 - type.clearance, 1.9).translate(0, type.clearance + (2.5 - type.clearance) / 2, half - 0.95)
    const cargo = new BoxGeometry(type.width, type.height - type.clearance - 0.3, type.length - 2.1).translate(0, type.clearance + 0.3 + (type.height - type.clearance - 0.3) / 2, -1.05)
    body = mergeGeometries([cab.toNonIndexed(), cargo.toNonIndexed()]) as BufferGeometry
    glass = new BoxGeometry(type.width + 0.02, 0.8, 1.2).translate(0, 2.0, half - 0.7)
  } else {
    // 轿车类：车头、引擎盖、车尾的侧面轮廓；车厢是梯形，前风挡比后窗更斜。
    const hood = Math.min(belt, type.clearance + (belt - type.clearance) * 0.85)
    body = extrudeProfile([
      [-half, type.clearance + 0.12], [-half + 0.08, type.clearance], [half - 0.08, type.clearance], [half, type.clearance + 0.12],
      [half, hood - 0.05], [half - 0.25, hood], [front, belt], [back, belt], [-half + 0.05, belt - 0.05],
    ], type.width)
    const windshield = Math.min(type.cabin.height * 1.3, (front - back) * 0.35)
    const rear = Math.min(type.cabin.height * (type.cabin.end > 0.9 ? 0.25 : 0.9), (front - back) * 0.3)
    glass = extrudeProfile([[front, belt], [front - windshield, type.height - 0.05], [back + rear, type.height - 0.05], [back, belt]], glassWidth)
    const roof = new BoxGeometry(glassWidth + 0.02, 0.06, Math.max(0.2, front - windshield - back - rear + 0.1))
      .translate(0, type.height - 0.03, (front - windshield + back + rear) / 2).toNonIndexed()
    body = mergeGeometries([body, roof]) as BufferGeometry
  }
  return { body, glass, wheels: wheelGeometry(type) }
}
