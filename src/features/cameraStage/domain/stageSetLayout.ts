import PoissonDiskSampling from 'poisson-disk-sampling'

import type { CameraStageFloorRange, CameraStageRoadClass, CameraStageSetParams } from '@/core/application-control/domains/cameraStage/cameraStageSetSchemas'

import {
  STAGE_SET_AREA_KINDS,
  STAGE_SET_MARKING_KINDS,
  STAGE_SET_SURFACE_KINDS,
  type StageSetAreaKind,
  type StageSetDecor,
  type StageSetMarkingKind,
  type StageSetSurfaceKind,
} from './sceneTypes'
import { VEHICLE_TYPE_INDEX, VEHICLE_TYPES } from './stageSetProps'
import {
  BUILDING_TYPES,
  CITY_STYLES,
  STREET_ROADS,
  TOWER_MIN_FLOORS,
  TOWER_MIN_SIDE,
  buildingHeight,
  carriagewayWidth,
  clampFloorRange,
  floorsAt,
  roadWidth,
  type AxisCityStyle,
  type BuildingType,
  type CityAxis,
  type CityStyle,
  type RoadSection,
} from './stageSetStyles'

/*
 * 布景布局：按城市风格算出路网、街区、楼体体量与地面装饰，全部在布景局部坐标（米）里。
 *
 * 楼体用简单的形状文法拼：沿街低多层是一个体块；层数过门槛的写字楼是“裙楼 + 塔楼（+ 屋顶机房）”；
 * 国内小区是按日照间距排开的高层住宅；欧式老城是沿街一圈围合、中间留院子。
 * 楼与装饰各用一条随机序列：开关参照物不会改变楼的布局。
 */

type Params<P extends CameraStageSetParams['preset']> = Extract<CameraStageSetParams, { preset: P }>
export type Random = () => number

/** mulberry32：足够均匀、可复现，种子取 32 位整数。 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export interface BuildingPart {
  x: number
  z: number
  width: number
  depth: number
  /** 体块底面离地高度：塔楼从裙楼顶开始 */
  base: number
  height: number
  role: 'main' | 'podium' | 'tower' | 'crown'
  /** 绕竖直轴的朝向（度），宽沿局部 x、深沿局部 z；沿弯路排的楼才有 */
  yaw?: number
}

/** 一栋楼由一到三个体块组成。 */
export type BuildingSpec = BuildingPart[]

export interface StageSetLayout {
  buildings: BuildingSpec[]
  decor: StageSetDecor | null
}

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Point { x: number; z: number }

const CURB_WIDTH = 0.2
/** 人行横道离路口的距离与宽度、停止线位置（沿道路方向，米） */
const CROSSWALK_GAP = 1
const CROSSWALK_DEPTH = 4
const STOP_LINE_OFFSET = CROSSWALK_GAP + CROSSWALK_DEPTH + 0.6
/** 行道树离路缘的距离、路灯离路缘的距离 */
const TREE_CURB_OFFSET = 1.2
const LAMP_CURB_OFFSET = 0.45

export function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t
}

const round2 = (value: number): number => Math.round(value * 100) / 100

export function pick<T>(items: readonly T[], random: Random): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]
}

function weighted<T>(entries: ReadonlyArray<readonly [T, number]>, random: Random): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = random() * total
  for (const [value, weight] of entries) {
    roll -= weight
    if (roll <= 0) return value
  }
  return entries[entries.length - 1][0]
}

/** 车身颜色：白、黑、银、灰占大头，和真实街道上的比例相近。 */
const VEHICLE_COLOR_WEIGHTS = [[0, 26], [1, 20], [2, 16], [3, 12], [4, 8], [5, 7], [6, 6], [7, 5]] as const
const PARKED_TYPES = [[VEHICLE_TYPE_INDEX.sedan, 42], [VEHICLE_TYPE_INDEX.hatchback, 20], [VEHICLE_TYPE_INDEX.suv, 28], [VEHICLE_TYPE_INDEX.van, 10]] as const
const MOVING_TYPES = [[VEHICLE_TYPE_INDEX.sedan, 40], [VEHICLE_TYPE_INDEX.hatchback, 14], [VEHICLE_TYPE_INDEX.suv, 24], [VEHICLE_TYPE_INDEX.van, 10], [VEHICLE_TYPE_INDEX.truck, 8]] as const

export class DecorWriter {
  readonly decor: StageSetDecor = {
    surfaces: Object.fromEntries(STAGE_SET_SURFACE_KINDS.map(kind => [kind, [] as number[]])) as Record<StageSetSurfaceKind, number[]>,
    markings: Object.fromEntries(STAGE_SET_MARKING_KINDS.map(kind => [kind, [] as number[]])) as Record<StageSetMarkingKind, number[]>,
    trees: [],
    lamps: [],
    vehicles: [],
  }

  constructor(readonly random: Random) {}

  surface(kind: StageSetSurfaceKind, rect: Rect): void {
    const width = rect.x1 - rect.x0
    const depth = rect.z1 - rect.z0
    if (width <= 0.01 || depth <= 0.01) return
    this.decor.surfaces[kind].push(round2((rect.x0 + rect.x1) / 2), round2((rect.z0 + rect.z1) / 2), round2(width), round2(depth))
  }

  /** 人行道铺装连同四边路缘。 */
  platform(rect: Rect, kind: 'sidewalk' | 'plaza' = 'sidewalk'): void {
    this.surface(kind, rect)
    this.surface('curb', { ...rect, z1: rect.z0 + CURB_WIDTH })
    this.surface('curb', { ...rect, z0: rect.z1 - CURB_WIDTH })
    this.surface('curb', { ...rect, x1: rect.x0 + CURB_WIDTH, z0: rect.z0 + CURB_WIDTH, z1: rect.z1 - CURB_WIDTH })
    this.surface('curb', { ...rect, x0: rect.x1 - CURB_WIDTH, z0: rect.z0 + CURB_WIDTH, z1: rect.z1 - CURB_WIDTH })
  }

  /** 任意形状的铺装：第一圈是外轮廓，其余是洞。编码见 StageSetDecor.areas。 */
  area(kind: StageSetAreaKind, rings: readonly (readonly Point[])[]): void {
    const kept = rings.filter(ring => ring.length >= 3)
    if (kept.length === 0) return
    const areas = this.decor.areas ??= Object.fromEntries(STAGE_SET_AREA_KINDS.map(name => [name, [] as number[]])) as Record<StageSetAreaKind, number[]>
    const values = areas[kind]
    values.push(kept.length)
    for (const ring of kept) {
      values.push(ring.length)
      for (const point of ring) values.push(round2(point.x), round2(point.z))
    }
  }

  marking(kind: StageSetMarkingKind, from: { x: number; z: number }, to: { x: number; z: number }): void {
    if (Math.hypot(to.x - from.x, to.z - from.z) < 0.5) return
    this.decor.markings[kind].push(round2(from.x), round2(from.z), round2(to.x), round2(to.z))
  }

  tree(point: { x: number; z: number }, variant: number): void {
    this.decor.trees.push(round2(point.x), round2(point.z), Math.round(this.random() * 360), round2(lerp(0.82, 1.15, this.random())), variant)
  }

  lamp(point: { x: number; z: number }, yaw: number, height: number): void {
    this.decor.lamps.push(round2(point.x), round2(point.z), yaw, height)
  }

  vehicle(point: { x: number; z: number }, yaw: number, type: number): void {
    this.decor.vehicles.push(round2(point.x), round2(point.z), Math.round(yaw * 10) / 10, type, weighted(VEHICLE_COLOR_WEIGHTS, this.random))
  }

  /** 绿地里按泊松圆盘撒树：任意两棵不近于 minDistance，避开楼体与边缘。 */
  scatterTrees(area: Rect, obstacles: readonly Rect[], minDistance: number, variants: readonly number[]): void {
    const width = area.x1 - area.x0
    const depth = area.z1 - area.z0
    if (width < minDistance || depth < minDistance) return
    const sampler = new PoissonDiskSampling({ shape: [width, depth], minDistance, maxDistance: minDistance * 1.8, tries: 12 }, this.random)
    const margin = 3
    for (const [localX, localZ] of sampler.fill()) {
      const x = area.x0 + localX
      const z = area.z0 + localZ
      if (x < area.x0 + 2 || x > area.x1 - 2 || z < area.z0 + 2 || z > area.z1 - 2) continue
      if (obstacles.some(rect => x > rect.x0 - margin && x < rect.x1 + margin && z > rect.z0 - margin && z < rect.z1 + margin)) continue
      this.tree({ x, z }, pick(variants, this.random))
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 道路
// ---------------------------------------------------------------------------------------------

/**
 * 一条路的中心线，按沿路距离 along 与横向偏移 across 取点。直路与弯路共用同一套沿路装饰规则（decorateSegment），
 * 只在取点、朝向和沿路画线上不同。
 */
export interface RoadPath {
  section: RoadSection
  roadClass: CameraStageRoadClass
  treeVariant: number
  /** 沿 +along 方向行驶时右手边在 across 的哪一侧（右侧通行） */
  rightSide: 1 | -1
  point(along: number, across: number): Point
  /** 车头朝向（度）：模型车头朝局部 +Z */
  heading(along: number, forward: boolean): number
  /** 第 side 侧路灯的灯臂朝向（度）：灯臂伸向路中心 */
  lampYaw(along: number, side: 1 | -1): number
  /** 沿路从 from 到 to、横向偏移 across 的一条标线 */
  line(writer: DecorWriter, kind: StageSetMarkingKind, from: number, to: number, across: number): void
  /** from 到 to 的中央分隔带 */
  median(writer: DecorWriter, from: number, to: number): void
  /**
   * 这一点能不能放东西：行道树与路灯要落在人行道上，停着的车要在自己的车行道里而不在水上或别的路口里。
   * 方格路网的人行道与车行道都是整段的矩形，省略即处处可放。
   */
  placeable?(point: Point, on: 'sidewalk' | 'carriageway'): boolean
}

export interface RoadEnds {
  /** 起点与终点是不是路口（画人行横道与停止线） */
  start: boolean
  end: boolean
  treeSpacing: number
}

/** 方格路网里沿 x 或 z 轴的直路。 */
class StraightRoad implements RoadPath {
  readonly rightSide: 1 | -1

  constructor(
    /** 沿哪个轴延伸 */
    readonly dir: 'x' | 'z',
    /** 道路中心线在另一轴上的坐标 */
    readonly offset: number,
    readonly section: RoadSection,
    readonly roadClass: CameraStageRoadClass,
    readonly treeVariant: number,
  ) {
    this.rightSide = dir === 'x' ? 1 : -1
  }

  point(along: number, across: number): Point {
    return this.dir === 'x' ? { x: along, z: this.offset + across } : { x: this.offset + across, z: along }
  }

  heading(_along: number, forward: boolean): number {
    if (this.dir === 'x') return forward ? 90 : -90
    return forward ? 0 : 180
  }

  lampYaw(_along: number, side: 1 | -1): number {
    if (this.dir === 'x') return side > 0 ? 180 : 0
    return side > 0 ? -90 : 90
  }

  line(writer: DecorWriter, kind: StageSetMarkingKind, from: number, to: number, across: number): void {
    writer.marking(kind, this.point(from, across), this.point(to, across))
  }

  median(writer: DecorWriter, from: number, to: number): void {
    const half = this.section.median / 2
    writer.surface('median', this.dir === 'x'
      ? { x0: from, x1: to, z0: this.offset - half, z1: this.offset + half }
      : { x0: this.offset - half, x1: this.offset + half, z0: from, z1: to })
  }
}

/** 一段路（两个路口之间）的车道线、人行横道、中央分隔带、行道树、路灯与车辆。 */
export function decorateSegment(writer: DecorWriter, road: RoadPath, start: number, end: number, ends: RoadEnds): void {
  const random = writer.random
  const section = road.section
  const half = carriagewayWidth(section) / 2
  const median = section.median / 2
  const lanesPerSide = section.lanes / 2
  const lanesEdge = median + lanesPerSide * section.laneWidth
  const lineStart = start + (ends.start ? STOP_LINE_OFFSET : 0)
  const lineEnd = end - (ends.end ? STOP_LINE_OFFSET : 0)
  if (lineEnd - lineStart < 4) return
  const point = (along: number, across: number) => road.point(along, across)
  const forwardSide = road.rightSide
  const placeable = (at: Point, on: 'sidewalk' | 'carriageway'): boolean => road.placeable?.(at, on) ?? true

  if (section.median > 0) {
    road.median(writer, lineStart, lineEnd)
  } else {
    road.line(writer, 'centerLine', lineStart, lineEnd, 0.12)
    road.line(writer, 'centerLine', lineStart, lineEnd, -0.12)
  }
  for (const side of [1, -1] as const) {
    for (let lane = 1; lane < lanesPerSide; lane += 1) {
      road.line(writer, 'laneDashed', lineStart, lineEnd, side * (median + lane * section.laneWidth))
    }
    if (section.bike > 0 || section.parking > 0) road.line(writer, 'edgeLine', lineStart, lineEnd, side * lanesEdge)
  }
  if (ends.start) writer.marking('crosswalk', point(start + CROSSWALK_GAP + CROSSWALK_DEPTH / 2, -half + 0.3), point(start + CROSSWALK_GAP + CROSSWALK_DEPTH / 2, half - 0.3))
  if (ends.end) writer.marking('crosswalk', point(end - CROSSWALK_GAP - CROSSWALK_DEPTH / 2, -half + 0.3), point(end - CROSSWALK_GAP - CROSSWALK_DEPTH / 2, half - 0.3))
  // 停止线只横过驶向路口的那半幅
  if (ends.end) writer.marking('stopLine', point(lineEnd, forwardSide * Math.max(median, 0.2)), point(lineEnd, forwardSide * lanesEdge))
  if (ends.start) writer.marking('stopLine', point(lineStart, -forwardSide * Math.max(median, 0.2)), point(lineStart, -forwardSide * lanesEdge))

  // 路灯两侧错开排，行道树避开灯杆。
  for (const side of [1, -1] as const) {
    const lamps: number[] = []
    const first = start + 4 + (side < 0 ? section.lampSpacing / 2 : 0)
    for (let along = first; along < end - 4; along += section.lampSpacing) {
      const at = point(along, side * (half + LAMP_CURB_OFFSET))
      if (!placeable(at, 'sidewalk')) continue
      writer.lamp(at, road.lampYaw(along, side), section.lampHeight)
      lamps.push(along)
    }
    if (section.sidewalk < 3) continue
    for (let along = start + 7; along < end - 7; along += ends.treeSpacing) {
      const at = along + lerp(-0.4, 0.4, random())
      if (random() < 0.08) continue
      if (lamps.some(lamp => Math.abs(lamp - at) < 2.5)) continue
      const position = point(at, side * (half + TREE_CURB_OFFSET))
      if (!placeable(position, 'sidewalk')) continue
      writer.tree(position, road.treeVariant)
    }
  }

  // 路边停车：每 6.3 米一个车位，一半多停着车。
  if (section.parking > 0) {
    for (const side of [1, -1] as const) {
      const forward = side === forwardSide
      for (let along = start + 9; along < end - 9; along += 6.3) {
        if (random() >= 0.55) continue
        const type = weighted(PARKED_TYPES, random)
        const at = along + lerp(-0.3, 0.3, random())
        const position = point(at, side * (half - section.parking / 2))
        if (!placeable(position, 'carriageway')) continue
        writer.vehicle(position, road.heading(at, forward), type)
      }
    }
  }

  // 行驶车辆：从这个方向的停止线往回数，路口前偶尔排几辆，其余按随机车距散开。
  for (const side of [1, -1] as const) {
    const forward = side === forwardSide
    for (let lane = 0; lane < lanesPerSide; lane += 1) {
      const across = side * (median + (lane + 0.5) * section.laneWidth)
      const outer = lane === lanesPerSide - 1
      let queue = random() < 0.35 ? 1 + Math.floor(random() * 4) : 0
      // cursor 是车尾离停止线的距离
      let cursor = queue > 0 ? 1 : lerp(8, 40, random())
      const limit = lineEnd - lineStart - 2
      while (cursor < limit) {
        const type = outer && road.roadClass !== 'local' && random() < 0.07 ? VEHICLE_TYPE_INDEX.bus : weighted(MOVING_TYPES, random)
        const length = VEHICLE_TYPES[type].length
        if (cursor + length > limit) break
        const center = cursor + length / 2
        const along = forward ? lineEnd - center : lineStart + center
        writer.vehicle(point(along, across), road.heading(along, forward), type)
        cursor += length + (queue > 0 ? lerp(1.8, 3, random()) : lerp(12, 55, random()))
        if (queue > 0) queue -= 1
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 楼体
// ---------------------------------------------------------------------------------------------

export function box(rect: Rect, base: number, height: number, role: BuildingPart['role'] = 'main'): BuildingPart {
  return { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2, width: rect.x1 - rect.x0, depth: rect.z1 - rect.z0, base, height, role }
}

/**
 * 写字楼：裙楼铺满地块，塔楼四面收进，30 层以上加一层屋顶机房。地块太窄放不下像样的塔楼时就是一个体块。
 */
export function towerMassing(lot: Rect, floors: number, type: BuildingType, podiumFloors: number): BuildingSpec {
  const total = buildingHeight(floors, type.heights)
  const width = lot.x1 - lot.x0
  const depth = lot.z1 - lot.z0
  const insetX = Math.min(Math.max(3, width * 0.12), (width - TOWER_MIN_SIDE) / 2)
  const insetZ = Math.min(Math.max(3, depth * 0.12), (depth - TOWER_MIN_SIDE) / 2)
  if (floors < TOWER_MIN_FLOORS || insetX < 1 || insetZ < 1) return [box(lot, 0, total)]
  const podium = buildingHeight(podiumFloors, type.heights)
  const towerRect = { x0: lot.x0 + insetX, x1: lot.x1 - insetX, z0: lot.z0 + insetZ, z1: lot.z1 - insetZ }
  const parts = [box(lot, 0, podium, 'podium'), box(towerRect, podium, total - podium, 'tower')]
  if (floors >= 30) {
    const crownX = (towerRect.x1 - towerRect.x0) * 0.25
    const crownZ = (towerRect.z1 - towerRect.z0) * 0.25
    parts.push(box({ x0: towerRect.x0 + crownX, x1: towerRect.x1 - crownX, z0: towerRect.z0 + crownZ, z1: towerRect.z1 - crownZ }, total, 4.5, 'crown'))
  }
  return parts
}

export interface HeightContext {
  random: Random
  floors: CameraStageFloorRange
  density: number
  /** 0 = 城中心，1 = 城边 */
  distance: (x: number, z: number) => number
  downtown: boolean
}

/** 0–1 的高度倾向：多数偏矮、少数接近最高；中心高时越往外越矮。 */
export function heightBias(context: HeightContext, x: number, z: number): number {
  const falloff = context.downtown ? 0.12 + 0.88 * (1 - context.distance(x, z)) ** 2 : 1
  return context.random() ** 2 * falloff
}

/** 方格城市的街区：背靠背两排地块，25 英尺一份，矮楼占一到三份，写字楼占四到六份。 */
function gridBlock(rect: Rect, context: HeightContext): BuildingSpec[] {
  const random = context.random
  const buildings: BuildingSpec[] = []
  const middle = (rect.z0 + rect.z1) / 2
  const lotWidth = 7.6
  for (const row of [{ front: rect.z0, back: middle, sign: 1 }, { front: rect.z1, back: middle, sign: -1 }]) {
    const rowDepth = Math.abs(row.back - row.front)
    let cursor = rect.x0
    while (cursor < rect.x1 - 0.5) {
      const floorsRaw = floorsAt(context.floors, heightBias(context, cursor, row.front))
      const tall = floorsRaw >= TOWER_MIN_FLOORS
      let frontage = lotWidth * (tall ? 4 + Math.floor(random() * 3) : 1 + Math.floor(random() * 3))
      if (rect.x1 - (cursor + frontage) < lotWidth) frontage = rect.x1 - cursor
      const lotX = { x0: cursor, x1: cursor + frontage }
      cursor += frontage
      if (random() >= context.density) continue
      if (tall) {
        const range = clampFloorRange(BUILDING_TYPES.office.floors, context.floors)
        const floors = Math.min(range.max, Math.max(range.min, floorsRaw))
        const lot = { ...lotX, z0: Math.min(row.front, row.front + row.sign * rowDepth), z1: Math.max(row.front, row.front + row.sign * rowDepth) }
        buildings.push(towerMassing(lot, floors, BUILDING_TYPES.office, 3 + Math.floor(random() * 3)))
      } else {
        const range = clampFloorRange(BUILDING_TYPES.rowhouse.floors, context.floors)
        const floors = Math.min(range.max, Math.max(range.min, floorsRaw))
        // 后院：沿街楼进深占地块的七到九成五
        const depth = rowDepth * lerp(0.7, 0.95, random())
        const z0 = row.sign > 0 ? row.front : row.front - depth
        buildings.push([box({ ...lotX, z0, z1: z0 + depth }, 0, buildingHeight(floors, BUILDING_TYPES.rowhouse.heights))])
      }
    }
  }
  return buildings
}

const SETBACK: Record<CameraStageRoadClass, number> = { arterial: 15, collector: 10, local: 8 }

interface BlockSides { north: CameraStageRoadClass; south: CameraStageRoadClass; west: CameraStageRoadClass; east: CameraStageRoadClass }

/**
 * 国内新城的地块：中心附近多是商业（裙楼加写字楼），其余是住宅小区——高层按日照间距一排排朝南，
 * 临支路一侧常有两层底商。小区内部是绿地，泊松撒树。
 */
function superblockParcel(rect: Rect, sides: BlockSides, context: HeightContext, writer: DecorWriter | null): BuildingSpec[] {
  const random = context.random
  const centerX = (rect.x0 + rect.x1) / 2
  const centerZ = (rect.z0 + rect.z1) / 2
  const distance = context.distance(centerX, centerZ)
  const commercial = (distance < 0.3 && random() < 0.8) || random() < 0.12
  const setback = { north: SETBACK[sides.north], south: SETBACK[sides.south], west: SETBACK[sides.west], east: SETBACK[sides.east] }
  const buildings: BuildingSpec[] = []
  if (commercial) {
    const inner = { x0: rect.x0 + setback.west, x1: rect.x1 - setback.east, z0: rect.z0 + setback.north, z1: rect.z1 - setback.south }
    const retail = clampFloorRange(BUILDING_TYPES.retail.floors, context.floors)
    const podiumFloors = floorsAt(retail, lerp(0.4, 1, random()))
    const podiumRect = { x0: inner.x0 + 6, x1: inner.x1 - 6, z0: inner.z0 + 6, z1: inner.z1 - 6 }
    // 裙楼和它上面的塔楼是同一栋楼：同色、同一个编号
    const complex: BuildingPart[] = random() < context.density ? [box(podiumRect, 0, buildingHeight(podiumFloors, BUILDING_TYPES.retail.heights), 'podium')] : []
    const podiumTop = complex.length > 0 ? buildingHeight(podiumFloors, BUILDING_TYPES.retail.heights) : 0
    const office = clampFloorRange(BUILDING_TYPES.office.floors, context.floors)
    if (office.max >= TOWER_MIN_FLOORS) {
      const towers = podiumRect.x1 - podiumRect.x0 >= 120 ? 2 : 1
      for (let index = 0; index < towers; index += 1) {
        if (random() >= context.density) continue
        const floors = floorsAt(office, lerp(0.35, 1, random()) * (context.downtown ? 1 - distance * 0.6 : 1))
        const width = lerp(32, 44, random())
        const depth = lerp(28, 40, random())
        const cx = towers === 1 ? centerX : lerp(podiumRect.x0, podiumRect.x1, index === 0 ? 0.28 : 0.72)
        const towerRect = { x0: cx - width / 2, x1: cx + width / 2, z0: centerZ - depth / 2, z1: centerZ + depth / 2 }
        const total = buildingHeight(floors, BUILDING_TYPES.office.heights)
        complex.push(box(towerRect, podiumTop, Math.max(4, total - podiumTop), 'tower'))
        if (floors >= 30) complex.push(box({ x0: towerRect.x0 + width * 0.25, x1: towerRect.x1 - width * 0.25, z0: towerRect.z0 + depth * 0.25, z1: towerRect.z1 - depth * 0.25 }, Math.max(total, podiumTop + 4), 4.5, 'crown'))
      }
    }
    if (complex.length > 0) buildings.push(complex)
    return buildings
  }

  // 底商：临支路的一侧，沿红线一溜两层商铺；小区退线随之加大。
  const retailFloors = Math.min(2, clampFloorRange(BUILDING_TYPES.retail.floors, context.floors).max)
  const retailHeight = buildingHeight(retailFloors, BUILDING_TYPES.retail.heights)
  const shopDepth = 12
  for (const side of ['north', 'south', 'west', 'east'] as const) {
    if (sides[side] !== 'local' || random() >= 0.6) continue
    const along = side === 'north' || side === 'south'
    const from = (along ? rect.x0 : rect.z0) + 14
    const to = (along ? rect.x1 : rect.z1) - 14
    for (let cursor = from; cursor < to - 10;) {
      const length = Math.min(lerp(28, 48, random()), to - cursor)
      if (random() < context.density) {
        const shop = side === 'north' ? { x0: cursor, x1: cursor + length, z0: rect.z0, z1: rect.z0 + shopDepth }
          : side === 'south' ? { x0: cursor, x1: cursor + length, z0: rect.z1 - shopDepth, z1: rect.z1 }
            : side === 'west' ? { x0: rect.x0, x1: rect.x0 + shopDepth, z0: cursor, z1: cursor + length }
              : { x0: rect.x1 - shopDepth, x1: rect.x1, z0: cursor, z1: cursor + length }
        buildings.push([box(shop, 0, retailHeight)])
      }
      cursor += length + 6
    }
    setback[side] = shopDepth + 10
  }

  const inner = { x0: rect.x0 + setback.west, x1: rect.x1 - setback.east, z0: rect.z0 + setback.north, z1: rect.z1 - setback.south }
  const range = clampFloorRange(BUILDING_TYPES.residentialTower.floors, context.floors)
  const baseFloors = floorsAt(range, lerp(0.35, 1, random()) * (context.downtown ? lerp(0.75, 1, 1 - distance) : 1))
  const slab = random() < 0.5
  const towerWidth = slab ? lerp(48, 58, random()) : lerp(20, 26, random())
  const towerDepth = slab ? lerp(13, 15, random()) : lerp(18, 22, random())
  const height = buildingHeight(baseFloors, BUILDING_TYPES.residentialTower.heights)
  // 南北楼距按日照取约一倍楼高（22–70 米），东西按防火间距与小区道路取 16 米。
  const rowPitch = towerDepth + Math.min(70, Math.max(22, height))
  const columnPitch = towerWidth + 16
  const columns = Math.max(1, Math.floor((inner.x1 - inner.x0 + 16) / columnPitch))
  const rows = Math.max(1, Math.floor((inner.z1 - inner.z0 - towerDepth) / rowPitch) + 1)
  const usedWidth = columns * columnPitch - 16
  const usedDepth = (rows - 1) * rowPitch + towerDepth
  const footprints: Rect[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (random() >= context.density) continue
      const x0 = (inner.x0 + inner.x1 - usedWidth) / 2 + column * columnPitch
      const z0 = (inner.z0 + inner.z1 - usedDepth) / 2 + row * rowPitch
      if (x0 + towerWidth > inner.x1 + 0.01 || z0 + towerDepth > inner.z1 + 0.01) continue
      const floors = Math.min(range.max, Math.max(range.min, baseFloors + (random() < 0.3 ? Math.round(lerp(-2, 2, random())) : 0)))
      const footprint = { x0, x1: x0 + towerWidth, z0, z1: z0 + towerDepth }
      footprints.push(footprint)
      buildings.push([box(footprint, 0, buildingHeight(floors, BUILDING_TYPES.residentialTower.heights))])
    }
  }
  if (writer) {
    const lawn = { x0: inner.x0 - 2, x1: inner.x1 + 2, z0: inner.z0 - 2, z1: inner.z1 + 2 }
    writer.surface('lawn', lawn)
    writer.scatterTrees(lawn, footprints, 9, [0, 1, 3])
  }
  return buildings
}

/** 欧式老城的街区：沿四边一圈 20 多米进深的沿街楼，同一街区檐口大致齐平，中间是院子。 */
function oldtownBlock(rect: Rect, context: HeightContext, writer: DecorWriter | null): BuildingSpec[] {
  const random = context.random
  const buildings: BuildingSpec[] = []
  const depth = lerp(20, 24, random())
  const range = clampFloorRange(BUILDING_TYPES.perimeter.floors, context.floors)
  const distance = context.distance((rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2)
  const blockFloors = floorsAt(range, random() * (context.downtown ? lerp(0.55, 1, 1 - distance) : 1))
  const rows: Array<{ along: 'x' | 'z'; from: number; to: number; rect: (a: number, b: number) => Rect }> = [
    { along: 'x', from: rect.x0, to: rect.x1, rect: (a, b) => ({ x0: a, x1: b, z0: rect.z0, z1: rect.z0 + depth }) },
    { along: 'x', from: rect.x0, to: rect.x1, rect: (a, b) => ({ x0: a, x1: b, z0: rect.z1 - depth, z1: rect.z1 }) },
    { along: 'z', from: rect.z0 + depth, to: rect.z1 - depth, rect: (a, b) => ({ x0: rect.x0, x1: rect.x0 + depth, z0: a, z1: b }) },
    { along: 'z', from: rect.z0 + depth, to: rect.z1 - depth, rect: (a, b) => ({ x0: rect.x1 - depth, x1: rect.x1, z0: a, z1: b }) },
  ]
  for (const row of rows) {
    let cursor = row.from
    while (cursor < row.to - 0.5) {
      let frontage = lerp(10, 20, random())
      if (row.to - (cursor + frontage) < 8) frontage = row.to - cursor
      const lot = row.rect(cursor, cursor + frontage)
      cursor += frontage
      if (random() >= context.density) continue
      const floors = Math.min(range.max, Math.max(range.min, blockFloors + (random() < 0.25 ? (random() < 0.5 ? -1 : 1) : 0)))
      buildings.push([box(lot, 0, buildingHeight(floors, BUILDING_TYPES.perimeter.heights))])
    }
  }
  if (writer) {
    const court = { x0: rect.x0 + depth, x1: rect.x1 - depth, z0: rect.z0 + depth, z1: rect.z1 - depth }
    writer.surface('lawn', court)
    if (writer.random() < 0.6) writer.scatterTrees(court, [], 10, [0, 1])
  }
  return buildings
}

// ---------------------------------------------------------------------------------------------
// 城市
// ---------------------------------------------------------------------------------------------

interface AxisRoad { index: number; center: number; roadClass: CameraStageRoadClass; section: RoadSection }

/**
 * 一个方向上的道路与街区：中心那条路在 0，两边对称，街区数为偶数（至少 2 个），场景中心总在路口上；
 * 最外面也是一条完整的路，城市四周有人行道收边。
 */
function axisRoads(axis: CityAxis, style: CityStyle, span: number): AxisRoad[] {
  const sectionAt = (index: number): RoadSection => style.roads[axis.roadAt(Math.abs(index))]
  const pitch = axis.block + roadWidth(sectionAt(1))
  const perSide = Math.max(1, Math.round(span / 2 / pitch))
  const positive: AxisRoad[] = [{ index: 0, center: 0, roadClass: axis.roadAt(0), section: sectionAt(0) }]
  for (let index = 1; index <= perSide; index += 1) {
    const previous = positive[index - 1]
    const section = sectionAt(index)
    positive.push({ index, center: previous.center + roadWidth(previous.section) / 2 + axis.block + roadWidth(section) / 2, roadClass: axis.roadAt(index), section })
  }
  const negative = positive.slice(1).map(road => ({ ...road, index: -road.index, center: -road.center })).reverse()
  return [...negative, ...positive]
}

function cityLayout(params: Params<'city'>, random: Random, decorRandom: Random | null): StageSetLayout {
  // 自然路网由 stageSets 分派给 organicCityLayout，到这里的都是按轴排布的风格
  const style = CITY_STYLES[params.style as AxisCityStyle]
  const columns = axisRoads(style.x, style, params.width)
  const rows = axisRoads(style.z, style, params.depth)
  const halfX = columns[columns.length - 1].center
  const halfZ = rows[rows.length - 1].center
  const writer = decorRandom ? new DecorWriter(decorRandom) : null
  const context: HeightContext = {
    random,
    floors: params.floors,
    density: params.density,
    downtown: params.heightProfile === 'downtown',
    distance: (x, z) => Math.min(1, Math.hypot(x / halfX, z / halfZ) / Math.SQRT2),
  }
  const buildings: BuildingSpec[] = []
  const curb = (road: AxisRoad, sign: 1 | -1): number => road.center + sign * carriagewayWidth(road.section) / 2
  const building = (road: AxisRoad, sign: 1 | -1): number => road.center + sign * roadWidth(road.section) / 2

  for (let column = 0; column < columns.length - 1; column += 1) {
    for (let row = 0; row < rows.length - 1; row += 1) {
      const west = columns[column]
      const east = columns[column + 1]
      const north = rows[row]
      const south = rows[row + 1]
      const lots = { x0: building(west, 1), x1: building(east, -1), z0: building(north, 1), z1: building(south, -1) }
      writer?.platform({ x0: curb(west, 1), x1: curb(east, -1), z0: curb(north, 1), z1: curb(south, -1) })
      if (params.style === 'grid') buildings.push(...gridBlock(lots, context))
      else if (params.style === 'oldtown') buildings.push(...oldtownBlock(lots, context, writer))
      else buildings.push(...superblockParcel(lots, { north: north.roadClass, south: south.roadClass, west: west.roadClass, east: east.roadClass }, context, writer))
    }
  }

  if (writer) {
    const first = { x: columns[0], z: rows[0] }
    const last = { x: columns[columns.length - 1], z: rows[rows.length - 1] }
    const minX = curb(first.x, -1)
    const maxX = curb(last.x, 1)
    const minZ = curb(first.z, -1)
    const maxZ = curb(last.z, 1)
    // 四周收边的人行道
    writer.platform({ x0: building(first.x, -1), x1: building(last.x, 1), z0: building(first.z, -1), z1: minZ })
    writer.platform({ x0: building(first.x, -1), x1: building(last.x, 1), z0: maxZ, z1: building(last.z, 1) })
    writer.platform({ x0: building(first.x, -1), x1: minX, z0: minZ, z1: maxZ })
    writer.platform({ x0: maxX, x1: building(last.x, 1), z0: minZ, z1: maxZ })
    const roadsAlongZ = columns.map(road => new StraightRoad('z', road.center, road.section, road.roadClass, pick(style.treeVariants, writer.random)))
    const roadsAlongX = rows.map(road => new StraightRoad('x', road.center, road.section, road.roadClass, pick(style.treeVariants, writer.random)))
    for (const road of roadsAlongZ) {
      const half = carriagewayWidth(road.section) / 2
      writer.surface('road', { x0: road.offset - half, x1: road.offset + half, z0: minZ, z1: maxZ })
    }
    for (const road of roadsAlongX) {
      const half = carriagewayWidth(road.section) / 2
      writer.surface('road', { x0: minX, x1: maxX, z0: road.offset - half, z1: road.offset + half })
    }
    for (const road of roadsAlongZ) {
      for (let index = 0; index < rows.length - 1; index += 1) {
        decorateSegment(writer, road, curb(rows[index], 1), curb(rows[index + 1], -1), { start: true, end: true, treeSpacing: style.treeSpacing })
      }
    }
    for (const road of roadsAlongX) {
      for (let index = 0; index < columns.length - 1; index += 1) {
        decorateSegment(writer, road, curb(columns[index], 1), curb(columns[index + 1], -1), { start: true, end: true, treeSpacing: style.treeSpacing })
      }
    }
  }
  return { buildings, decor: writer?.decor ?? null }
}

// ---------------------------------------------------------------------------------------------
// 街道与广场
// ---------------------------------------------------------------------------------------------

/** 一排沿街楼：面宽 6–15 米、进深 12–20 米，贴着建筑红线。 */
function streetFrontage(from: number, to: number, line: number, sign: 1 | -1, params: { density: number; floors: CameraStageFloorRange }, random: Random, along: 'x' | 'z' = 'x'): BuildingSpec[] {
  const buildings: BuildingSpec[] = []
  const range = clampFloorRange(BUILDING_TYPES.rowhouse.floors, params.floors)
  let cursor = from
  while (cursor < to - 0.5) {
    let frontage = lerp(6, 15, random())
    if (to - (cursor + frontage) < 5) frontage = to - cursor
    const depth = lerp(12, 20, random())
    const start = cursor
    cursor += frontage
    if (random() >= params.density) continue
    const floors = floorsAt(range, random() ** 1.3)
    const near = sign > 0 ? line : line - depth
    const rect = along === 'x' ? { x0: start, x1: start + frontage, z0: near, z1: near + depth } : { x0: near, x1: near + depth, z0: start, z1: start + frontage }
    buildings.push([box(rect, 0, buildingHeight(floors, BUILDING_TYPES.rowhouse.heights))])
  }
  return buildings
}

function streetLayout(params: Params<'street'>, random: Random, decorRandom: Random | null): StageSetLayout {
  const section = STREET_ROADS[params.road]
  const half = carriagewayWidth(section) / 2
  const line = roadWidth(section) / 2
  const ends = params.length / 2
  const buildings = [
    ...streetFrontage(-ends, ends, -line, -1, params, random),
    ...streetFrontage(-ends, ends, line, 1, params, random),
  ]
  if (!decorRandom) return { buildings, decor: null }
  const writer = new DecorWriter(decorRandom)
  writer.surface('road', { x0: -ends, x1: ends, z0: -half, z1: half })
  writer.platform({ x0: -ends, x1: ends, z0: -line, z1: -half })
  writer.platform({ x0: -ends, x1: ends, z0: half, z1: line })
  const road = new StraightRoad('x', 0, section, params.road, pick([0, 1, 2], decorRandom))
  decorateSegment(writer, road, -ends, ends, { start: false, end: false, treeSpacing: 8 })
  return { buildings, decor: writer.decor }
}

function plazaLayout(params: Params<'plaza'>, random: Random, decorRandom: Random | null): StageSetLayout {
  const section = STREET_ROADS.local
  const carriage = carriagewayWidth(section)
  const plazaHalf = params.size / 2
  const roadCenter = plazaHalf + carriage / 2
  const outerCurb = plazaHalf + carriage
  const line = outerCurb + section.sidewalk
  const depth = 16
  const frontage = { density: params.density, floors: params.floors }
  // 南北两排连同四角一起排，东西两排只排中段。
  const buildings = [
    ...streetFrontage(-line - depth, line + depth, -line, -1, frontage, random),
    ...streetFrontage(-line - depth, line + depth, line, 1, frontage, random),
    ...streetFrontage(-line, line, -line, -1, frontage, random, 'z'),
    ...streetFrontage(-line, line, line, 1, frontage, random, 'z'),
  ]
  if (!decorRandom) return { buildings, decor: null }
  const writer = new DecorWriter(decorRandom)
  writer.platform({ x0: -plazaHalf, x1: plazaHalf, z0: -plazaHalf, z1: plazaHalf }, 'plaza')
  writer.platform({ x0: -line, x1: line, z0: -line, z1: -outerCurb })
  writer.platform({ x0: -line, x1: line, z0: outerCurb, z1: line })
  writer.platform({ x0: -line, x1: -outerCurb, z0: -outerCurb, z1: outerCurb })
  writer.platform({ x0: outerCurb, x1: line, z0: -outerCurb, z1: outerCurb })
  const roads = [
    new StraightRoad('x', -roadCenter, section, 'local', 0),
    new StraightRoad('x', roadCenter, section, 'local', 0),
    new StraightRoad('z', -roadCenter, section, 'local', 1),
    new StraightRoad('z', roadCenter, section, 'local', 1),
  ]
  for (const road of roads) {
    const rect = road.dir === 'x'
      ? { x0: -outerCurb, x1: outerCurb, z0: road.offset - carriage / 2, z1: road.offset + carriage / 2 }
      : { x0: road.offset - carriage / 2, x1: road.offset + carriage / 2, z0: -outerCurb, z1: outerCurb }
    writer.surface('road', rect)
    // 广场一侧的行道树与路灯落在广场铺装边上，中间空出来。
    decorateSegment(writer, road, -plazaHalf, plazaHalf, { start: true, end: true, treeSpacing: 8 })
  }
  return { buildings, decor: writer.decor }
}

export function layoutStageSet(params: Exclude<CameraStageSetParams, { preset: 'crowd' }>, random: Random, decorRandom: Random | null): StageSetLayout {
  if (params.preset === 'city') return cityLayout(params, random, decorRandom)
  if (params.preset === 'street') return streetLayout(params, random, decorRandom)
  return plazaLayout(params, random, decorRandom)
}
