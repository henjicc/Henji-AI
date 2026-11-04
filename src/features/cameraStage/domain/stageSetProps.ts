/*
 * 比例参照物的种类表：生成布景时按序号写进装饰数组，渲染时按同一序号取模型。序号只能往后加。
 *
 * 车辆尺寸取常见车型的外廓（长 × 宽 × 高，米）：中型轿车约 4.75×1.83×1.47、两厢车 4.1×1.75×1.5、
 * 中型 SUV 4.75×1.9×1.72、厢式面包车 5.1×1.95×2.1、12 米公交车 12×2.55×3.2、轻型厢式货车 7.2×2.3×3.1。
 */

/** 行道树树种，名称对应 resources/camera-stage/street-trees.glb 里的网格名（tree-<名称>-trunk / -canopy）。 */
export const STREET_TREE_VARIANTS = ['broadleaf', 'round', 'columnar', 'conifer'] as const

export interface VehicleType {
  name: string
  length: number
  width: number
  height: number
  /** 车身下沿离地高 */
  clearance: number
  /** 车厢（含车窗）从车头往后的起止比例与顶部收进量；货车与公交的车厢就是整个车身 */
  cabin: { start: number; end: number; inset: number; height: number }
  wheelRadius: number
}

export const VEHICLE_TYPES: readonly VehicleType[] = [
  { name: '轿车', length: 4.75, width: 1.83, height: 1.47, clearance: 0.2, cabin: { start: 0.3, end: 0.78, inset: 0.12, height: 0.5 }, wheelRadius: 0.33 },
  { name: '两厢车', length: 4.1, width: 1.75, height: 1.5, clearance: 0.18, cabin: { start: 0.3, end: 0.96, inset: 0.1, height: 0.55 }, wheelRadius: 0.31 },
  { name: 'SUV', length: 4.75, width: 1.9, height: 1.72, clearance: 0.25, cabin: { start: 0.28, end: 0.96, inset: 0.08, height: 0.6 }, wheelRadius: 0.37 },
  { name: '面包车', length: 5.1, width: 1.95, height: 2.1, clearance: 0.22, cabin: { start: 0.12, end: 1, inset: 0.04, height: 1.1 }, wheelRadius: 0.34 },
  { name: '公交车', length: 12, width: 2.55, height: 3.2, clearance: 0.35, cabin: { start: 0.02, end: 1, inset: 0.02, height: 1.25 }, wheelRadius: 0.5 },
  { name: '货车', length: 7.2, width: 2.3, height: 3.1, clearance: 0.4, cabin: { start: 0, end: 0.26, inset: 0.05, height: 0.9 }, wheelRadius: 0.45 },
]

export const VEHICLE_TYPE_INDEX = { sedan: 0, hatchback: 1, suv: 2, van: 3, bus: 4, truck: 5 } as const
