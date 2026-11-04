import type { CameraStageCityStyle, CameraStageFloorRange, CameraStageRoadClass } from '@/core/application-control/domains/cameraStage/cameraStageSetSchemas'

/*
 * 布景的真实尺度表：道路横断面、街区尺寸、层高与建筑体量。单位米，1 单位 = 1 米。
 *
 * 生成模型主要靠街宽、楼层、树、车、人判断画面尺度，这些数取真实城市的常见值，不开放成参数：
 * - 车道 3.0–3.5 米、人行道 4–6 米、主干道红线 40–60 米、次干道 20–30 米、支路 10–20 米：
 *   NACTO Urban Street Design Guide（车道宽 3.0–3.3 米为城市街道推荐值）、
 *   《城市综合交通体系规划标准》GB/T 51328-2018（干路与支路红线宽度）。
 * - 纽约曼哈顿 1811 年规划：街道红线 60 英尺（18.3 米）、大道 100 英尺（30.5 米），
 *   街区南北 200 英尺（61 米）、大道间距约 260 米，地块面宽 25 英尺（7.6 米）、进深 100 英尺（30.5 米）。
 * - 巴塞罗那扩展区（Cerdà 规划）：街区 113.3 米见方，街道 20 米（车行 10 米、两侧人行道各 5 米），
 *   中心距 133.3 米；沿街围合式住宅 5–7 层，进深约 20–28 米。
 * - 国内新城：主干道围合 300–500 米超级街区，内部支路再分地块；高层住宅层高约 2.9–3.0 米、
 *   塔楼平面 18–25 米、18–33 层（≤100 米），南北楼距按日照取约 1.0–1.3 倍楼高、东西防火间距 ≥13 米；
 *   商业首层 5–6 米、标准层约 4.2–4.5 米，裙楼加塔楼。
 * - 层高：住宅约 3 米，沿街商铺首层 4.5–6 米，写字楼标准层约 4 米。
 */

/** 道路横断面（双向合计车道，左右对称）。红线宽 = 车行道 + 两侧人行道。 */
export interface RoadSection {
  /** 双向机动车道总数（偶数） */
  lanes: number
  laneWidth: number
  /** 中央分隔带宽；0 表示只画中心双黄线 */
  median: number
  /** 每侧非机动车道宽；0 表示没有 */
  bike: number
  /** 每侧路边停车带宽；0 表示没有 */
  parking: number
  /** 每侧人行道宽（含树池与灯杆带） */
  sidewalk: number
  /** 路灯杆高 */
  lampHeight: number
  /** 路灯间距 */
  lampSpacing: number
}

export function carriagewayWidth(section: RoadSection): number {
  return section.lanes * section.laneWidth + section.median + 2 * (section.bike + section.parking)
}

/** 道路红线宽：建筑红线之间的距离。 */
export function roadWidth(section: RoadSection): number {
  return carriagewayWidth(section) + 2 * section.sidewalk
}

export interface FloorHeights {
  ground: number
  upper: number
}

export function buildingHeight(floors: number, heights: FloorHeights): number {
  return heights.ground + Math.max(0, floors - 1) * heights.upper
}

/** 建筑体量：自身合理的层数区间，与用户给的楼层范围取交集。 */
export interface BuildingType {
  floors: CameraStageFloorRange
  heights: FloorHeights
}

export interface CityAxis {
  /** 两条道路红线之间的街区长度（建筑可用范围） */
  block: number
  /** 第 index 条道路（中心那条为 0）的等级 */
  roadAt: (index: number) => CameraStageRoadClass
}

export interface CityStyle {
  /** 东西向排布（沿 x 依次出现的南北向道路与街区） */
  x: CityAxis
  /** 南北向排布 */
  z: CityAxis
  roads: Record<CameraStageRoadClass, RoadSection>
  /** 行道树间距 */
  treeSpacing: number
  /** 行道树树种序号（STREET_TREE_VARIANTS），每条街一种 */
  treeVariants: readonly number[]
}

const LANE = 3.3

/** 方格城市：曼哈顿式。大道（南北向）30 米、街道 18 米，每五条街一条 30 米的横贯大街。 */
const GRID: CityStyle = {
  x: { block: 230, roadAt: () => 'arterial' },
  z: { block: 61, roadAt: index => (index % 5 === 0 ? 'collector' : 'local') },
  roads: {
    arterial: { lanes: 4, laneWidth: LANE, median: 0, bike: 0, parking: 2.5, sidewalk: 5.5, lampHeight: 9, lampSpacing: 30 },
    collector: { lanes: 4, laneWidth: LANE, median: 0, bike: 0, parking: 2.5, sidewalk: 5.5, lampHeight: 9, lampSpacing: 30 },
    local: { lanes: 2, laneWidth: 3.1, median: 0, bike: 0, parking: 2.2, sidewalk: 3.9, lampHeight: 7.5, lampSpacing: 28 },
  },
  treeSpacing: 8,
  treeVariants: [0, 1, 2],
}

/** 国内新城：主干道 50 米与次干道 30 米交替围出约 420 米超级街区，中间一条 16 米支路分成四块。 */
const SUPERBLOCK: CityStyle = {
  x: { block: 180, roadAt: index => (index % 4 === 0 ? 'arterial' : index % 2 === 0 ? 'collector' : 'local') },
  z: { block: 180, roadAt: index => (index % 4 === 0 ? 'arterial' : index % 2 === 0 ? 'collector' : 'local') },
  roads: {
    arterial: { lanes: 8, laneWidth: 3.5, median: 4, bike: 3.5, parking: 0, sidewalk: 5.5, lampHeight: 12, lampSpacing: 35 },
    collector: { lanes: 4, laneWidth: 3.5, median: 0, bike: 2.5, parking: 0, sidewalk: 5, lampHeight: 10, lampSpacing: 32 },
    local: { lanes: 2, laneWidth: 3.5, median: 0, bike: 0, parking: 0, sidewalk: 4.5, lampHeight: 8, lampSpacing: 28 },
  },
  treeSpacing: 6,
  treeVariants: [0, 1, 3],
}

/** 欧式老城：巴塞罗那扩展区式。20 米街道，每四条一条 30 米林荫道。 */
const OLDTOWN: CityStyle = {
  x: { block: 113.3, roadAt: index => (index % 4 === 0 ? 'collector' : 'local') },
  z: { block: 113.3, roadAt: index => (index % 4 === 0 ? 'collector' : 'local') },
  roads: {
    arterial: { lanes: 4, laneWidth: 3.2, median: 3, bike: 0, parking: 2.2, sidewalk: 5, lampHeight: 9, lampSpacing: 30 },
    collector: { lanes: 4, laneWidth: 3.2, median: 3, bike: 0, parking: 2.2, sidewalk: 5, lampHeight: 9, lampSpacing: 30 },
    local: { lanes: 3, laneWidth: 3.2, median: 0, bike: 0, parking: 0, sidewalk: 5.2, lampHeight: 7, lampSpacing: 26 },
  },
  treeSpacing: 7,
  treeVariants: [0, 1],
}

export const CITY_STYLES: Record<CameraStageCityStyle, CityStyle> = { grid: GRID, superblock: SUPERBLOCK, oldtown: OLDTOWN }

/** 单条街道与广场的道路断面（不随城市风格变）。 */
export const STREET_ROADS: Record<CameraStageRoadClass, RoadSection> = {
  local: { lanes: 2, laneWidth: 3.2, median: 0, bike: 0, parking: 2.2, sidewalk: 4, lampHeight: 7.5, lampSpacing: 28 },
  collector: { lanes: 4, laneWidth: 3.4, median: 0, bike: 2.5, parking: 0, sidewalk: 5, lampHeight: 10, lampSpacing: 32 },
  arterial: SUPERBLOCK.roads.arterial,
}

export const BUILDING_TYPES = {
  /** 沿街低多层：首层商铺、楼上住宅 */
  rowhouse: { floors: { min: 2, max: 14 }, heights: { ground: 4.5, upper: 3.2 } },
  /** 写字楼：裙楼加塔楼 */
  office: { floors: { min: 12, max: 80 }, heights: { ground: 5.5, upper: 4 } },
  /** 国内高层住宅：首层架空或大堂 */
  residentialTower: { floors: { min: 11, max: 33 }, heights: { ground: 3.6, upper: 2.95 } },
  /** 国内商业裙楼与底商 */
  retail: { floors: { min: 1, max: 5 }, heights: { ground: 5.4, upper: 4.5 } },
  /** 欧式沿街围合住宅 */
  perimeter: { floors: { min: 3, max: 9 }, heights: { ground: 4.5, upper: 3.3 } },
} as const satisfies Record<string, BuildingType>

/** 体量自身的层数区间与用户给的范围取交集；不相交时取最接近的一端。 */
export function clampFloorRange(type: CameraStageFloorRange, user: CameraStageFloorRange): CameraStageFloorRange {
  const min = Math.max(type.min, user.min)
  const max = Math.min(type.max, user.max)
  if (min <= max) return { min, max }
  const nearest = type.min > user.max ? user.max : user.min
  return { min: nearest, max: nearest }
}

/** 从 0–1 的高度倾向取整层：t 越大越高。 */
export function floorsAt(range: CameraStageFloorRange, t: number): number {
  return Math.round(range.min + (range.max - range.min) * Math.min(1, Math.max(0, t)))
}

/** 裙楼加塔楼的门槛：低于这个层数的楼直接是一个体块。 */
export const TOWER_MIN_FLOORS = 13
/** 塔楼平面最小边长：再小就不像塔楼了。 */
export const TOWER_MIN_SIDE = 16
