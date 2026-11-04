import { v4 as uuidv4 } from 'uuid'

import type { StageVec3 } from '../domain/sceneTypes'
import type { StageSpatialPath } from '../domain/stateKeyframeTypes'
import type { StageObstacle } from './stageObstacles'

/**
 * 角色走位的路线规划：在地面上绕开挡路的盒子。
 *
 * 场景里挡路的都是绕竖直轴转的盒子（楼、道具、其他角色），所以按俯视平面做：每个盒子外扩半个身宽，
 * 相邻两点直线走得通就直走；走不通就在这一段的范围内铺网格跑 A*（八邻接、八方向距离估价），
 * 再用视线拉直（能直接看到的拐点之间连直线）去掉网格的锯齿。拐角的圆滑交给贝塞尔路径：
 * 每个拐点的切线沿前后两点连线方向、长度取相邻两段较短者的三成。
 */

/** 身体半宽（米）：路线离盒子边至少这么远 */
export const CHARACTER_ROUTE_CLEARANCE = 0.35
/** 腰部以下才算挡路：高出头顶或贴地的薄片（地面铺装）不挡 */
const BODY_LOW = 0.1
const BODY_HIGH = 1.7
const BASE_CELL = 0.25
const MAX_GRID_SIDE = 480
const SEARCH_PADDING = [6, 20, 60]
const CORNER_HANDLE = 0.3

export interface PlanarPoint { x: number; z: number }

export interface RouteCrossing { objectId: string; name: string }

export interface PlannedRoute {
  /** 起点、各拐点、终点 */
  points: PlanarPoint[]
  length: number
  /** 绕开障碍时的拐点数（不含起点、终点与途经点） */
  detourPoints: number
  /** 路线仍穿过的对象（不绕开或找不到可走的路时） */
  crossings: RouteCrossing[]
}

interface FlatObstacle {
  objectId: string
  name: string
  cx: number
  cz: number
  hx: number
  hz: number
  cos: number
  sin: number
}

/** 只留挡在身体高度范围内的盒子，换成俯视平面上外扩 clearance 的矩形。 */
export function flattenObstacles(obstacles: readonly StageObstacle[], clearance = CHARACTER_ROUTE_CLEARANCE): FlatObstacle[] {
  return obstacles
    .filter((obstacle) => obstacle.center.y - obstacle.half.y < BODY_HIGH && obstacle.center.y + obstacle.half.y > BODY_LOW)
    .map((obstacle) => ({
      objectId: obstacle.objectId,
      name: obstacle.name,
      cx: obstacle.center.x,
      cz: obstacle.center.z,
      hx: obstacle.half.x + clearance,
      hz: obstacle.half.z + clearance,
      cos: obstacle.cos,
      sin: obstacle.sin,
    }))
}

function local(point: PlanarPoint, obstacle: FlatObstacle): PlanarPoint {
  const dx = point.x - obstacle.cx
  const dz = point.z - obstacle.cz
  return { x: dx * obstacle.cos - dz * obstacle.sin, z: dx * obstacle.sin + dz * obstacle.cos }
}

function inside(point: PlanarPoint, obstacle: FlatObstacle): boolean {
  const p = local(point, obstacle)
  return Math.abs(p.x) <= obstacle.hx && Math.abs(p.z) <= obstacle.hz
}

function segmentHits(a: PlanarPoint, b: PlanarPoint, obstacle: FlatObstacle): boolean {
  const from = local(a, obstacle)
  const to = local(b, obstacle)
  let enter = 0
  let exit = 1
  for (const axis of ['x', 'z'] as const) {
    const half = axis === 'x' ? obstacle.hx : obstacle.hz
    const delta = to[axis] - from[axis]
    if (Math.abs(delta) < 1e-12) {
      if (Math.abs(from[axis]) > half) return false
      continue
    }
    let t0 = (-half - from[axis]) / delta
    let t1 = (half - from[axis]) / delta
    if (t0 > t1) [t0, t1] = [t1, t0]
    enter = Math.max(enter, t0)
    exit = Math.min(exit, t1)
    if (enter > exit) return false
  }
  return true
}

function nearby(obstacles: readonly FlatObstacle[], a: PlanarPoint, b: PlanarPoint, padding: number): FlatObstacle[] {
  const minX = Math.min(a.x, b.x) - padding
  const maxX = Math.max(a.x, b.x) + padding
  const minZ = Math.min(a.z, b.z) - padding
  const maxZ = Math.max(a.z, b.z) + padding
  return obstacles.filter((obstacle) => {
    const reach = Math.hypot(obstacle.hx, obstacle.hz)
    return obstacle.cx + reach >= minX && obstacle.cx - reach <= maxX && obstacle.cz + reach >= minZ && obstacle.cz - reach <= maxZ
  })
}

/** 端点本身落在盒子里（贴着盒子站）时不算挡路，否则任何离开它的路都走不通。 */
function blockers(obstacles: readonly FlatObstacle[], a: PlanarPoint, b: PlanarPoint): FlatObstacle[] {
  return obstacles.filter((obstacle) => !inside(a, obstacle) && !inside(b, obstacle))
}

function clear(a: PlanarPoint, b: PlanarPoint, obstacles: readonly FlatObstacle[]): boolean {
  return !obstacles.some((obstacle) => segmentHits(a, b, obstacle))
}

/** 八邻接 A*；找不到返回 null。 */
function gridSearch(a: PlanarPoint, b: PlanarPoint, obstacles: readonly FlatObstacle[], padding: number): PlanarPoint[] | null {
  const minX = Math.min(a.x, b.x) - padding
  const minZ = Math.min(a.z, b.z) - padding
  const spanX = Math.abs(a.x - b.x) + 2 * padding
  const spanZ = Math.abs(a.z - b.z) + 2 * padding
  const cell = Math.max(BASE_CELL, Math.max(spanX, spanZ) / MAX_GRID_SIDE)
  const width = Math.ceil(spanX / cell) + 1
  const height = Math.ceil(spanZ / cell) + 1
  const center = (ix: number, iz: number): PlanarPoint => ({ x: minX + ix * cell, z: minZ + iz * cell })
  const cellOf = (point: PlanarPoint): [number, number] => [Math.round((point.x - minX) / cell), Math.round((point.z - minZ) / cell)]
  const blocked = new Uint8Array(width * height)
  for (let iz = 0; iz < height; iz += 1) {
    for (let ix = 0; ix < width; ix += 1) {
      const point = center(ix, iz)
      if (obstacles.some((obstacle) => inside(point, obstacle))) blocked[iz * width + ix] = 1
    }
  }
  const [sx, sz] = cellOf(a)
  const [gx, gz] = cellOf(b)
  const start = sz * width + sx
  const goal = gz * width + gx
  blocked[start] = 0
  blocked[goal] = 0
  const g = new Float64Array(width * height).fill(Infinity)
  const parent = new Int32Array(width * height).fill(-1)
  const closed = new Uint8Array(width * height)
  const heuristic = (index: number): number => {
    const dx = Math.abs((index % width) - gx)
    const dz = Math.abs(Math.floor(index / width) - gz)
    return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * cell
  }
  // 二叉堆存 [f, index]
  const heap: Array<[number, number]> = []
  const push = (item: [number, number]): void => {
    heap.push(item)
    let index = heap.length - 1
    while (index > 0) {
      const up = (index - 1) >> 1
      if (heap[up][0] <= heap[index][0]) break
      ;[heap[up], heap[index]] = [heap[index], heap[up]]
      index = up
    }
  }
  const pop = (): [number, number] => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let index = 0
      for (;;) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left
        if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right
        if (smallest === index) break
        ;[heap[smallest], heap[index]] = [heap[index], heap[smallest]]
        index = smallest
      }
    }
    return top
  }
  g[start] = 0
  push([heuristic(start), start])
  while (heap.length > 0) {
    const [, index] = pop()
    if (closed[index]) continue
    if (index === goal) break
    closed[index] = 1
    const ix = index % width
    const iz = Math.floor(index / width)
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue
        const nx = ix + dx
        const nz = iz + dz
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue
        const next = nz * width + nx
        // 斜着走不能从两个挡住的格子之间挤过去。
        if (blocked[next] || closed[next] || (dx !== 0 && dz !== 0 && (blocked[iz * width + nx] || blocked[nz * width + ix]))) continue
        const cost = g[index] + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1) * cell
        if (cost >= g[next]) continue
        g[next] = cost
        parent[next] = index
        push([cost + heuristic(next), next])
      }
    }
  }
  if (!Number.isFinite(g[goal])) return null
  const cells: PlanarPoint[] = []
  for (let index = goal; index !== -1; index = parent[index]) cells.push(center(index % width, Math.floor(index / width)))
  cells.reverse()
  cells[0] = a
  cells[cells.length - 1] = b
  return cells
}

/** 视线拉直：从当前点出发，取还能直线看到的最远一个点。 */
function stringPull(points: PlanarPoint[], obstacles: readonly FlatObstacle[]): PlanarPoint[] {
  const out = [points[0]]
  let anchor = 0
  while (anchor < points.length - 1) {
    let next = points.length - 1
    while (next > anchor + 1 && !clear(points[anchor], points[next], obstacles)) next -= 1
    out.push(points[next])
    anchor = next
  }
  return out
}

function leg(a: PlanarPoint, b: PlanarPoint, obstacles: readonly FlatObstacle[], avoid: boolean): { points: PlanarPoint[]; crossings: FlatObstacle[] } {
  const direct = blockers(nearby(obstacles, a, b, 0), a, b)
  const hit = direct.filter((obstacle) => segmentHits(a, b, obstacle))
  if (hit.length === 0 || !avoid) return { points: [a, b], crossings: hit }
  for (const padding of SEARCH_PADDING) {
    const relevant = blockers(nearby(obstacles, a, b, padding), a, b)
    const cells = gridSearch(a, b, relevant, padding)
    if (cells) return { points: stringPull(cells, relevant), crossings: [] }
  }
  return { points: [a, b], crossings: hit }
}

/** 依次经过 waypoints（含起点、终点）的路线；avoid=false 时只报告穿过了谁。 */
export function planCharacterRoute(waypoints: readonly PlanarPoint[], obstacles: readonly FlatObstacle[], avoid: boolean): PlannedRoute {
  const points: PlanarPoint[] = [waypoints[0]]
  const crossings = new Map<string, RouteCrossing>()
  let detourPoints = 0
  for (let index = 1; index < waypoints.length; index += 1) {
    const planned = leg(waypoints[index - 1], waypoints[index], obstacles, avoid)
    detourPoints += planned.points.length - 2
    points.push(...planned.points.slice(1))
    for (const obstacle of planned.crossings) crossings.set(obstacle.objectId, { objectId: obstacle.objectId, name: obstacle.name })
  }
  let length = 0
  for (let index = 1; index < points.length; index += 1) length += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z)
  return { points, length, detourPoints, crossings: [...crossings.values()] }
}

/** 路线换成贝塞尔空间路径：拐点切线沿前后两点连线，长度取相邻两段较短者的三成；直线就是默认直线路径。 */
export function routeToSpatialPath(points: readonly PlanarPoint[], y: number): StageSpatialPath {
  const at = (point: PlanarPoint): StageVec3 => ({ x: point.x, y, z: point.z })
  const sub = (a: PlanarPoint, b: PlanarPoint): PlanarPoint => ({ x: a.x - b.x, z: a.z - b.z })
  const length = (v: PlanarPoint): number => Math.hypot(v.x, v.z)
  const scaled = (v: PlanarPoint, s: number): StageVec3 => ({ x: v.x * s, y: 0, z: v.z * s })
  const first = sub(points[1], points[0])
  const last = sub(points[points.length - 1], points[points.length - 2])
  const knots = points.slice(1, -1).map((point, offset) => {
    const index = offset + 1
    const before = length(sub(point, points[index - 1]))
    const after = length(sub(points[index + 1], point))
    const chord = sub(points[index + 1], points[index - 1])
    const handle = (Math.min(before, after) * CORNER_HANDLE) / Math.max(1e-9, length(chord))
    return { id: uuidv4(), position: at(point), inTangent: scaled(chord, -handle), outTangent: scaled(chord, handle) }
  })
  return {
    kind: 'bezier',
    source: { kind: 'custom' },
    startOutTangent: scaled(first, knots.length > 0 ? CORNER_HANDLE : 1 / 3),
    knots,
    endInTangent: scaled(last, knots.length > 0 ? -CORNER_HANDLE : -1 / 3),
  }
}

/** 已采样的整条路线有没有穿过盒子（不外扩，只按身体半宽的一半），用于如实报告。 */
export function sampledRouteCrossings(samples: readonly PlanarPoint[], obstacles: readonly StageObstacle[], ignore: ReadonlySet<string>): RouteCrossing[] {
  const flat = flattenObstacles(obstacles, CHARACTER_ROUTE_CLEARANCE / 2).filter((obstacle) => !ignore.has(obstacle.objectId))
  const found = new Map<string, RouteCrossing>()
  for (let index = 1; index < samples.length; index += 1) {
    for (const obstacle of nearby(flat, samples[index - 1], samples[index], 0)) {
      if (!found.has(obstacle.objectId) && segmentHits(samples[index - 1], samples[index], obstacle)) found.set(obstacle.objectId, { objectId: obstacle.objectId, name: obstacle.name })
    }
  }
  return [...found.values()]
}
