import PoissonDiskSampling from 'poisson-disk-sampling'
import simplify from 'simplify-js'
import {
  ClipType,
  EndType,
  FillRule,
  JoinType,
  PolyTreeD,
  areaD,
  booleanOpDWithPolyTree,
  differenceD,
  inflatePathsD,
  intersectD,
  unionD,
  type PathD,
  type PathsD,
  type PolyPathD,
} from 'clipper2-ts'

import type { CameraStageRoadClass, CameraStageSetParams } from '@/core/application-control/domains/cameraStage/cameraStageSetSchemas'

import { LANE_DASH, type StageSetMarkingKind } from './sceneTypes'
import {
  DecorWriter,
  box,
  createRandom,
  decorateSegment,
  heightBias,
  lerp,
  pick,
  towerMassing,
  type BuildingPart,
  type BuildingSpec,
  type HeightContext,
  type Point,
  type Random,
  type RoadPath,
  type StageSetLayout,
} from './stageSetLayout'
import {
  BUILDING_TYPES,
  ORGANIC_STYLE,
  TOWER_MIN_FLOORS,
  buildingHeight,
  carriagewayWidth,
  clampFloorRange,
  floorsAt,
  roadWidth,
  type RoadSection,
} from './stageSetStyles'
import { RoadNetwork, TensorField, Vector, type StreamlineParams } from './vendor/mapgenerator'

/*
 * 自然路网城市：张量场流线路网（vendor/mapgenerator）给出三级道路的中心线，其余全部按真实尺度从中心线推出：
 * - 车行道、建筑红线是中心线按断面宽度的缓冲区；人行道铺装 = 范围 − 车行道 − 水面，地块 = 范围 − 红线 − 水面 − 公园；
 *   路口转角按路缘半径倒圆。多边形布尔运算与缓冲用 clipper2-ts。
 * - 楼沿地块边（建筑红线）一栋栋排开，朝向跟着街；楼高与体量规则与其他风格相同。
 * - 车道线、斑马线、路灯、行道树、车辆沿弯曲的中心线摆，路口处断开。
 * 路网只取决于种子、范围、弯曲程度、河流与公园，算一次缓存起来：调密度、楼层再数楼不用重算路网。
 */

type CityParams = Extract<CameraStageSetParams, { preset: 'city' }>

/** 流线积分步长与简化容差（米）：步长决定弯路的精细程度，容差 0.4 米时半径 200 米的弯道约 30 米一折。 */
const DSTEP = 5
const SIMPLIFY_TOLERANCE = 0.4
/** 布尔运算保留到厘米，圆弧逼近误差 0.25 米 */
const PRECISION = 2
const ARC_TOLERANCE = 0.25
/** 楼退建筑红线 */
const SETBACK = 0.5

interface NetworkRoad { roadClass: CameraStageRoadClass; points: Point[] }
type Polygon = Point[][]

interface OrganicGround {
  sidewalk: Polygon[]
  water: Polygon[]
  lawn: Polygon[]
  lots: Polygon[]
}

interface OrganicNetwork {
  bounds: { halfX: number; halfZ: number }
  roads: NetworkRoad[]
  /** 公园里的园路中心线 */
  paths: Point[][]
  ground: OrganicGround
}

// ---------------------------------------------------------------------------------------------
// 路网
// ---------------------------------------------------------------------------------------------

function streamlineParams(dsep: number, testRatio: number, lookaheadRatio: number, size: number): StreamlineParams {
  // 比例取原程序的默认参数：支路 dtest/dsep 0.75、次干道 0.3、主干道 0.5；向前接路的距离约两倍间距。
  return {
    dsep,
    dtest: dsep * testRatio,
    dstep: DSTEP,
    dcirclejoin: DSTEP * 5,
    dlookahead: dsep * lookaheadRatio,
    joinangle: 0.1,
    pathIterations: Math.ceil((3 * size) / DSTEP),
    seedTries: 300,
    simplifyTolerance: SIMPLIFY_TOLERANCE,
    collideEarly: 0,
  }
}

/**
 * 张量场：四个方格场放在范围四角附近（原程序的推荐布置），弯曲程度决定各片区走向差多少、加不加放射场与全局旋转噪声。
 * 弯曲程度 0 时四个方格场同向，路网接近正交格网；1 时各片区走向在 ±45° 内随机，再加两个放射场（环形路）。
 */
function tensorField(params: CityParams, random: Random): TensorField {
  const size = Math.max(params.width, params.depth)
  const curvature = params.curvature
  const field = new TensorField({ globalNoise: false, noiseSizePark: 120, noiseAnglePark: 90, noiseSizeGlobal: 350, noiseAngleGlobal: 0 }, random)
  for (const [sx, sz] of [[-1, -1], [1, 1], [1, -1], [-1, 1]] as const) {
    const centre = new Vector(sx * 0.35 * params.width, sz * 0.35 * params.depth)
    field.addGrid(centre, lerp(size / 4, size, random()), lerp(0, 50, random()), curvature * lerp(-Math.PI / 4, Math.PI / 4, random()))
  }
  const radials = curvature >= 0.75 ? 2 : curvature >= 0.3 ? 1 : 0
  for (let index = 0; index < radials; index += 1) {
    const centre = new Vector(lerp(-0.35, 0.35, random()) * params.width, lerp(-0.35, 0.35, random()) * params.depth)
    field.addRadial(centre, lerp(size / 10, size / 5, random()), lerp(0, 50, random()))
  }
  return field
}

const toVector = (point: Point): Vector => new Vector(point.x, point.z)
const toPoint = (vector: { x: number; y: number }): Point => ({ x: vector.x, z: vector.y })
const toPath = (points: readonly Point[]): PathD => points.map(point => ({ x: point.x, y: point.z }))
const fromPath = (path: PathD): Point[] => path.map(toPoint)

function rectPath(halfX: number, halfZ: number): PathD {
  return [{ x: -halfX, y: -halfZ }, { x: halfX, y: -halfZ }, { x: halfX, y: halfZ }, { x: -halfX, y: halfZ }]
}

function polylineLength(points: readonly Point[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) total += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z)
  return total
}

function insideRings(point: Point, polygon: Polygon): boolean {
  let inside = false
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]
      const b = ring[j]
      if ((a.z > point.z) !== (b.z > point.z) && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) inside = !inside
    }
  }
  return inside
}

/** 多边形组（带洞），附包围盒，点查询先比包围盒。 */
class PolygonSet {
  private readonly boxes: Array<{ x0: number; z0: number; x1: number; z1: number }>

  constructor(readonly polygons: readonly Polygon[]) {
    this.boxes = polygons.map(polygon => {
      const box = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
      for (const point of polygon[0]) {
        box.x0 = Math.min(box.x0, point.x); box.x1 = Math.max(box.x1, point.x)
        box.z0 = Math.min(box.z0, point.z); box.z1 = Math.max(box.z1, point.z)
      }
      return box
    })
  }

  contains(point: Point): boolean {
    return this.polygons.some((polygon, index) => {
      const bounds = this.boxes[index]
      return point.x >= bounds.x0 && point.x <= bounds.x1 && point.z >= bounds.z0 && point.z <= bounds.z1 && insideRings(point, polygon)
    })
  }
}

/** PolyTree 展开成“外轮廓 + 洞”的多边形组，洞里的岛另起一组。 */
function polygonsOf(tree: PolyTreeD, minArea = 1): Polygon[] {
  const out: Polygon[] = []
  const visit = (node: PolyPathD): void => {
    const outer = node.poly
    if (!outer || Math.abs(areaD(outer)) < minArea) return
    const rings: Point[][] = [fromPath(outer)]
    for (let index = 0; index < node.count; index += 1) {
      const hole = node.child(index)
      if (hole.poly && Math.abs(areaD(hole.poly)) >= minArea) rings.push(fromPath(hole.poly))
      for (let island = 0; island < hole.count; island += 1) visit(hole.child(island))
    }
    out.push(rings)
  }
  for (let index = 0; index < tree.count; index += 1) visit(tree.child(index))
  return out
}

function differenceTree(subject: PathsD, clip: PathsD, minArea?: number): Polygon[] {
  const tree = new PolyTreeD()
  booleanOpDWithPolyTree(ClipType.Difference, subject, clip, tree, FillRule.NonZero, PRECISION)
  return polygonsOf(tree, minArea)
}

function intersectTree(subject: PathsD, clip: PathsD, minArea?: number): Polygon[] {
  const tree = new PolyTreeD()
  booleanOpDWithPolyTree(ClipType.Intersection, subject, clip, tree, FillRule.NonZero, PRECISION)
  return polygonsOf(tree, minArea)
}

const inflateLines = (lines: readonly (readonly Point[])[], half: number): PathsD =>
  lines.length === 0 ? [] : inflatePathsD(lines.map(toPath), half, JoinType.Round, EndType.Butt, 2, PRECISION, ARC_TOLERANCE)

const inflateAreas = (areas: PathsD, delta: number): PathsD =>
  areas.length === 0 ? [] : inflatePathsD(areas, delta, JoinType.Round, EndType.Polygon, 2, PRECISION, ARC_TOLERANCE)

/** 闭运算：先扩后缩，填平车行道交汇处的内角，也就是给路口转角倒圆。 */
const closeAreas = (areas: PathsD, radius: number): PathsD => inflateAreas(inflateAreas(areas, radius), -radius)

/**
 * 公园从主次干道围出的街区里挑：每平方公里约一片，每片不超过全城面积的一成（也不超过 30 公顷），
 * 街区太大就只取中间一块圆形。挑好后支路在公园里加旋转噪声弯成园路，与原程序的做法相同。
 */
function chooseParks(network: RoadNetwork, bounds: PathD, params: CityParams, random: Random): Point[][] {
  const trunk = [...network.mainRoads, ...network.majorRoads, ...(network.river?.bankRoads ?? [])].map(line => line.map(toPoint))
  const blocked = unionD([...inflateLines(trunk, 14), ...(network.river ? [toPath(network.river.polygon.map(toPoint))] : [])], [], FillRule.NonZero, PRECISION)
  const blocks = differenceTree([bounds], blocked, 1).map(polygon => polygon[0]).filter(ring => Math.abs(areaD(toPath(ring))) >= 12_000)
  const count = Math.min(blocks.length, Math.max(1, Math.min(10, Math.round((params.width * params.depth) / 1e6 * 0.9))))
  const maxArea = Math.min(300_000, Math.max(12_000, params.width * params.depth * 0.1))
  const chosen: Point[][] = []
  const pool = [...blocks]
  while (chosen.length < count && pool.length > 0) {
    const ring = pool.splice(Math.floor(random() * pool.length), 1)[0]
    if (Math.abs(areaD(toPath(ring))) <= maxArea) {
      chosen.push(ring)
      continue
    }
    const centre = ring.reduce((sum, point) => ({ x: sum.x + point.x / ring.length, z: sum.z + point.z / ring.length }), { x: 0, z: 0 })
    const radius = Math.sqrt(maxArea / Math.PI)
    const disk = Array.from({ length: 48 }, (_, index) => ({ x: centre.x + radius * Math.cos((index / 48) * Math.PI * 2), y: centre.z + radius * Math.sin((index / 48) * Math.PI * 2) }))
    const [clipped] = intersectTree([toPath(ring)], [disk], 12_000)
    if (clipped) chosen.push(clipped[0])
  }
  return chosen
}

/** 支路在公园里的部分是园路：按 4 米重采样后按点切段。 */
function splitByParks(line: readonly Point[], parks: PolygonSet): { roads: Point[][]; paths: Point[][] } {
  const samples: Point[] = []
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1]
    const b = line[index]
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4))
    for (let step = 0; step < steps; step += 1) samples.push({ x: lerp(a.x, b.x, step / steps), z: lerp(a.z, b.z, step / steps) })
  }
  samples.push(line[line.length - 1])
  const roads: Point[][] = []
  const paths: Point[][] = []
  let run: Point[] = []
  let inPark = parks.contains(samples[0])
  const flush = (): void => {
    const simple = simplify(run.map(point => ({ x: point.x, y: point.z })), SIMPLIFY_TOLERANCE).map(toPoint)
    if (simple.length >= 2 && polylineLength(simple) > 12) (inPark ? paths : roads).push(simple)
  }
  for (const sample of samples) {
    const now = parks.contains(sample)
    if (now !== inPark) {
      run.push(sample)
      flush()
      run = [sample]
      inPark = now
    } else {
      run.push(sample)
    }
  }
  flush()
  return { roads, paths }
}

/**
 * 去掉绕得太紧的圈：放射场中心附近的流线会闭成几十米的小圆，按真实路宽画出来车行道自己压自己。
 * 一段弧长不到 2π × 1.5 倍车行道宽、却转过将近一整圈的部分拿掉，剩下的段落各自成路。
 */
function withoutTightLoops(points: readonly Point[], carriage: number): Point[][] {
  const n = points.length
  if (n < 4) return [points.slice()]
  const along = [0]
  const heading: number[] = []
  for (let index = 1; index < n; index += 1) {
    along.push(along[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z))
    heading.push(Math.atan2(points[index].z - points[index - 1].z, points[index].x - points[index - 1].x))
  }
  // 第 i 个折点处累计转过的角度
  const turned = [0, 0]
  for (let index = 1; index < heading.length; index += 1) {
    let delta = heading[index] - heading[index - 1]
    if (delta > Math.PI) delta -= Math.PI * 2
    if (delta < -Math.PI) delta += Math.PI * 2
    turned.push(turned[index] + delta)
  }
  const window = Math.PI * 2 * carriage * 1.5
  const removed = new Array<boolean>(n).fill(false)
  for (let start = 0, end = 0; start < n; start += 1) {
    end = Math.max(end, start)
    while (end + 1 < n && along[end + 1] - along[start] <= window) end += 1
    if (Math.abs(turned[end] - turned[start]) >= Math.PI * 1.6) for (let index = start; index <= end; index += 1) removed[index] = true
  }
  const pieces: Point[][] = []
  let run: Point[] = []
  points.forEach((point, index) => {
    if (removed[index]) {
      if (run.length >= 2 && polylineLength(run) >= 30) pieces.push(run)
      run = []
    } else {
      run.push(point)
    }
  })
  if (run.length >= 2 && polylineLength(run) >= 30) pieces.push(run)
  return pieces
}

function buildNetwork(params: CityParams): OrganicNetwork {
  const random = createRandom((params.seed ^ 0x68e31da4) >>> 0)
  const halfX = params.width / 2
  const halfZ = params.depth / 2
  const size = Math.max(params.width, params.depth)
  const field = tensorField(params, random)
  const spacing = ORGANIC_STYLE.spacing
  const riverStyle = ORGANIC_STYLE.river
  const bank = ORGANIC_STYLE.roads.collector
  const riverSize = riverStyle.waterHalf + riverStyle.promenade + bank.sidewalk + carriagewayWidth(bank) / 2
  // 河道连两岸沿河路约 130 米宽；范围窄于它的一倍半时放不下几栋楼，就不放河
  const riverFits = Math.min(params.width, params.depth) >= 1.5 * 2 * (riverSize + roadWidth(bank) / 2)
  const minor = streamlineParams(spacing.local, 0.75, 2, size)
  const network = new RoadNetwork(field, new Vector(-halfX, -halfZ), new Vector(params.width, params.depth), {
    main: streamlineParams(spacing.arterial, 0.5, 1.25, size),
    major: streamlineParams(spacing.collector, 0.3, 2, size),
    minor,
    water: params.river && riverFits
      ? {
        ...minor, pathIterations: Math.ceil((4 * size) / DSTEP), simplifyTolerance: 1, riverNoise: { noiseEnabled: true, noiseSize: 220, noiseAngle: 20 },
        riverSize, riverBankSize: riverSize - riverStyle.waterHalf, seedRegion: 0.4,
      }
      : null,
    roadNoise: params.curvature > 0 ? { size: 350, angle: 15 * params.curvature } : null,
  }, random)
  network.generateTrunk()
  const bounds = rectPath(halfX, halfZ)
  const parkRings = params.parks ? chooseParks(network, bounds, params, random) : []
  network.generateMinor(parkRings.map(ring => ring.map(toVector)))

  const parks = new PolygonSet(parkRings.map(ring => [ring]))
  const roads: NetworkRoad[] = []
  const add = (roadClass: CameraStageRoadClass, lines: readonly Point[][]): void => {
    const carriage = carriagewayWidth(ORGANIC_STYLE.roads[roadClass])
    for (const line of lines) if (line.length >= 2) for (const points of withoutTightLoops(line, carriage)) roads.push({ roadClass, points })
  }
  const points = (lines: readonly Vector[][]): Point[][] => lines.map(line => line.map(toPoint))
  add('arterial', points(network.mainRoads))
  add('collector', points(network.majorRoads))
  add('collector', points(network.river?.bankRoads ?? []))
  const paths: Point[][] = []
  for (const line of network.minorRoads) {
    if (line.length < 2) continue
    const split = splitByParks(line.map(toPoint), parks)
    add('local', split.roads)
    paths.push(...split.paths)
  }
  const river = network.river ? toPath(network.river.polygon.map(toPoint)) : null
  return { bounds: { halfX, halfZ }, roads, paths, ground: buildGround(roads, paths, river, parkRings, bounds) }
}

function buildGround(roads: readonly NetworkRoad[], paths: readonly Point[][], river: PathD | null, parkRings: readonly Point[][], bounds: PathD): OrganicGround {
  const byClass = (roadClass: CameraStageRoadClass): Point[][] => roads.filter(road => road.roadClass === roadClass).map(road => road.points)
  const classes = ['local', 'collector', 'arterial'] as const
  const carriage = unionD(classes.flatMap(roadClass => inflateLines(byClass(roadClass), carriagewayWidth(ORGANIC_STYLE.roads[roadClass]) / 2)), [], FillRule.NonZero, PRECISION)
  const redline = unionD(classes.flatMap(roadClass => inflateLines(byClass(roadClass), roadWidth(ORGANIC_STYLE.roads[roadClass]) / 2)), [], FillRule.NonZero, PRECISION)
  const radius = ORGANIC_STYLE.curbRadius
  const carriageClosed = closeAreas(carriage, radius)
  const redlineClosed = closeAreas(redline, radius)
  // 桥面：过河的路在红线以内不画水
  const waterPaths = river ? intersectD(differenceD([river], redline, FillRule.NonZero, PRECISION), [bounds], FillRule.NonZero, PRECISION) : []
  const water = intersectTree(waterPaths, [bounds], 4)
  const sidewalk = differenceTree([bounds], [...carriageClosed, ...waterPaths], 2)
  const parks = parkRings.map(toPath)
  const pathArea = inflateLines(paths, ORGANIC_STYLE.pathWidth / 2)
  const lawn = parks.length === 0 ? [] : differenceTree(intersectD(parks, [bounds], FillRule.NonZero, PRECISION), [...redlineClosed, ...waterPaths, ...pathArea], 20)
  const lots = differenceTree([bounds], [...redlineClosed, ...inflateAreas(waterPaths, 3), ...parks], 60)
  return { sidewalk, water, lawn, lots }
}

/** 最近用过的两张路网：数楼和生成用同一组参数时不重算。 */
const networkCache = new Map<string, OrganicNetwork>()

function networkFor(params: CityParams): OrganicNetwork {
  const key = JSON.stringify([params.seed, params.width, params.depth, params.curvature, params.river, params.parks])
  const cached = networkCache.get(key)
  if (cached) {
    networkCache.delete(key)
    networkCache.set(key, cached)
    return cached
  }
  const network = buildNetwork(params)
  networkCache.set(key, network)
  if (networkCache.size > 2) networkCache.delete(networkCache.keys().next().value!)
  return network
}

// ---------------------------------------------------------------------------------------------
// 沿弯路的中心线
// ---------------------------------------------------------------------------------------------

/** 折线道路：横向偏移在折点处按斜接（miter）取，车道线与路缘线在弯道上连续。 */
class PolylinePath implements RoadPath {
  readonly rightSide = 1 as const
  readonly length: number
  private readonly cumulative: number[]
  private readonly tangents: Point[]
  private readonly miters: Point[]

  constructor(
    private readonly points: readonly Point[],
    readonly section: RoadSection,
    readonly roadClass: CameraStageRoadClass,
    readonly treeVariant: number,
    private readonly canPlace: (point: Point, on: 'sidewalk' | 'carriageway') => boolean,
  ) {
    this.cumulative = [0]
    this.tangents = []
    for (let index = 1; index < points.length; index += 1) {
      const dx = points[index].x - points[index - 1].x
      const dz = points[index].z - points[index - 1].z
      const segment = Math.hypot(dx, dz) || 1e-9
      this.cumulative.push(this.cumulative[index - 1] + segment)
      this.tangents.push({ x: dx / segment, z: dz / segment })
    }
    this.length = this.cumulative[this.cumulative.length - 1]
    // 法向取 (-tz, tx)：沿 +along 行驶时指向右手边
    const normal = (tangent: Point): Point => ({ x: -tangent.z, z: tangent.x })
    this.miters = points.map((_, index) => {
      const before = normal(this.tangents[Math.max(0, index - 1)])
      const after = normal(this.tangents[Math.min(this.tangents.length - 1, index)])
      const sum = { x: before.x + after.x, z: before.z + after.z }
      const length = Math.hypot(sum.x, sum.z) || 1
      const unit = { x: sum.x / length, z: sum.z / length }
      const scale = 1 / Math.max(0.6, unit.x * after.x + unit.z * after.z)
      return { x: unit.x * scale, z: unit.z * scale }
    })
  }

  private locate(along: number): { index: number; t: number } {
    const clamped = Math.min(this.length, Math.max(0, along))
    let low = 0
    let high = this.cumulative.length - 2
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (this.cumulative[middle] <= clamped) low = middle
      else high = middle - 1
    }
    const span = this.cumulative[low + 1] - this.cumulative[low]
    return { index: low, t: span > 0 ? (clamped - this.cumulative[low]) / span : 0 }
  }

  point(along: number, across: number): Point {
    const { index, t } = this.locate(along)
    const a = this.points[index]
    const b = this.points[index + 1]
    const ma = this.miters[index]
    const mb = this.miters[index + 1]
    return {
      x: lerp(a.x + ma.x * across, b.x + mb.x * across, t),
      z: lerp(a.z + ma.z * across, b.z + mb.z * across, t),
    }
  }

  heading(along: number, forward: boolean): number {
    const tangent = this.tangents[this.locate(along).index]
    const yaw = (Math.atan2(tangent.x, tangent.z) * 180) / Math.PI
    return forward ? yaw : yaw + 180
  }

  lampYaw(along: number, side: 1 | -1): number {
    const tangent = this.tangents[this.locate(along).index]
    // 灯臂朝 -side × 法向，即伸向路中心
    return (Math.atan2(side * tangent.z, -side * tangent.x) * 180) / Math.PI
  }

  /** from 到 to 之间的折点（不含两端） */
  private stops(from: number, to: number): number[] {
    const stops = [from]
    for (const at of this.cumulative) if (at > from + 0.01 && at < to - 0.01) stops.push(at)
    stops.push(to)
    return stops
  }

  line(writer: DecorWriter, kind: StageSetMarkingKind, from: number, to: number, across: number): void {
    if (kind === 'laneDashed') {
      // 虚线逐段写出：每段都比一个节奏短，渲染时整段亮着，节奏不因折点重新起算
      for (let dash = from; dash < to; dash += LANE_DASH.period) {
        writer.marking(kind, this.point(dash, across), this.point(Math.min(dash + LANE_DASH.on, to), across))
      }
      return
    }
    const stops = this.stops(from, to)
    for (let index = 1; index < stops.length; index += 1) writer.marking(kind, this.point(stops[index - 1], across), this.point(stops[index], across))
  }

  median(writer: DecorWriter, from: number, to: number): void {
    const half = this.section.median / 2
    const stops = this.stops(from, to)
    const ring = [...stops.map(at => this.point(at, half)), ...stops.reverse().map(at => this.point(at, -half))]
    writer.area('median', [ring])
  }

  placeable(point: Point, on: 'sidewalk' | 'carriageway'): boolean {
    return this.canPlace(point, on)
  }
}

// ---------------------------------------------------------------------------------------------
// 路口：某条路的中心线走进别的路的车行道就是路口
// ---------------------------------------------------------------------------------------------

interface SegmentRef { road: number; a: Point; b: Point; half: number }

class RoadIndex {
  private readonly cells = new Map<string, SegmentRef[]>()
  private static readonly CELL = 40

  constructor(roads: readonly NetworkRoad[]) {
    roads.forEach((road, index) => {
      const half = carriagewayWidth(ORGANIC_STYLE.roads[road.roadClass]) / 2
      for (let segment = 1; segment < road.points.length; segment += 1) {
        const ref = { road: index, a: road.points[segment - 1], b: road.points[segment], half }
        const reach = half + 2
        const x0 = Math.floor((Math.min(ref.a.x, ref.b.x) - reach) / RoadIndex.CELL)
        const x1 = Math.floor((Math.max(ref.a.x, ref.b.x) + reach) / RoadIndex.CELL)
        const z0 = Math.floor((Math.min(ref.a.z, ref.b.z) - reach) / RoadIndex.CELL)
        const z1 = Math.floor((Math.max(ref.a.z, ref.b.z) + reach) / RoadIndex.CELL)
        for (let x = x0; x <= x1; x += 1) {
          for (let z = z0; z <= z1; z += 1) {
            const key = `${x},${z}`
            const bucket = this.cells.get(key)
            if (bucket) bucket.push(ref)
            else this.cells.set(key, [ref])
          }
        }
      }
    })
  }

  /** point 是否在 except 以外某条路的车行道里（外扩 margin）。 */
  inOtherCarriage(point: Point, except: number, margin: number): boolean {
    const bucket = this.cells.get(`${Math.floor(point.x / RoadIndex.CELL)},${Math.floor(point.z / RoadIndex.CELL)}`)
    if (!bucket) return false
    for (const ref of bucket) {
      if (ref.road === except) continue
      const dx = ref.b.x - ref.a.x
      const dz = ref.b.z - ref.a.z
      const lengthSq = dx * dx + dz * dz
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((point.x - ref.a.x) * dx + (point.z - ref.a.z) * dz) / lengthSq)) : 0
      const distance = Math.hypot(point.x - (ref.a.x + dx * t), point.z - (ref.a.z + dz * t))
      if (distance < ref.half + margin) return true
    }
    return false
  }
}

/** 路口之间的一段段路：[起点, 终点, 起点是不是路口, 终点是不是路口] */
function roadPieces(path: PolylinePath, index: number, roads: RoadIndex): Array<{ start: number; end: number; startJunction: boolean; endJunction: boolean }> {
  const step = 1
  const pieces: Array<{ start: number; end: number; startJunction: boolean; endJunction: boolean }> = []
  let open: number | null = null
  let openJunction = false
  for (let along = 0; along <= path.length + 1e-6; along += step) {
    const covered = roads.inOtherCarriage(path.point(along, 0), index, 0.2)
    if (!covered && open === null) {
      open = along
      openJunction = along > 0
    } else if (covered && open !== null) {
      pieces.push({ start: open, end: along, startJunction: openJunction, endJunction: true })
      open = null
    }
  }
  if (open !== null) pieces.push({ start: open, end: path.length, startJunction: openJunction, endJunction: false })
  return pieces
}

// ---------------------------------------------------------------------------------------------
// 楼
// ---------------------------------------------------------------------------------------------

type Quad = [Point, Point, Point, Point]

/** 已放下的楼的平面，按格子查重叠（分离轴）。 */
class FootprintIndex {
  private readonly cells = new Map<string, Quad[]>()
  private static readonly CELL = 32

  private keys(quad: Quad): string[] {
    const xs = quad.map(point => point.x)
    const zs = quad.map(point => point.z)
    const keys: string[] = []
    for (let x = Math.floor(Math.min(...xs) / FootprintIndex.CELL); x <= Math.floor(Math.max(...xs) / FootprintIndex.CELL); x += 1) {
      for (let z = Math.floor(Math.min(...zs) / FootprintIndex.CELL); z <= Math.floor(Math.max(...zs) / FootprintIndex.CELL); z += 1) keys.push(`${x},${z}`)
    }
    return keys
  }

  overlaps(quad: Quad): boolean {
    for (const key of this.keys(quad)) {
      for (const other of this.cells.get(key) ?? []) if (quadsOverlap(quad, other)) return true
    }
    return false
  }

  add(quad: Quad): void {
    for (const key of this.keys(quad)) {
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(quad)
      else this.cells.set(key, [quad])
    }
  }
}

function quadsOverlap(a: Quad, b: Quad): boolean {
  for (const quad of [a, b]) {
    for (let index = 0; index < 4; index += 1) {
      const p = quad[index]
      const q = quad[(index + 1) % 4]
      const axis = { x: -(q.z - p.z), z: q.x - p.x }
      const project = (points: Quad): [number, number] => {
        let min = Infinity
        let max = -Infinity
        for (const point of points) {
          const value = point.x * axis.x + point.z * axis.z
          min = Math.min(min, value)
          max = Math.max(max, value)
        }
        return [min, max]
      }
      const [minA, maxA] = project(a)
      const [minB, maxB] = project(b)
      // 贴着不算重叠
      const tolerance = 0.05 * Math.hypot(axis.x, axis.z)
      if (maxA <= minB + tolerance || maxB <= minA + tolerance) return false
    }
  }
  return true
}

interface Frontage { origin: Point; u: Point; v: Point }

/** 局部坐标（沿街 x、向地块里 z）里的体块换到布景坐标，朝向跟着街。 */
function placePart(part: BuildingPart, frame: Frontage): BuildingPart {
  return {
    ...part,
    x: frame.origin.x + frame.u.x * part.x + frame.v.x * part.z,
    z: frame.origin.z + frame.u.z * part.x + frame.v.z * part.z,
    yaw: (Math.atan2(-frame.u.z, frame.u.x) * 180) / Math.PI,
  }
}

function quadOf(frame: Frontage, width: number, depth: number): Quad {
  const at = (x: number, z: number): Point => ({ x: frame.origin.x + frame.u.x * x + frame.v.x * z, z: frame.origin.z + frame.u.z * x + frame.v.z * z })
  return [at(0, 0), at(width, 0), at(width, depth), at(0, depth)]
}

/** 楼的平面整个落在地块里：四角与四边每 5 米一点都在里面。 */
function fitsLot(quad: Quad, lot: Polygon): boolean {
  for (let index = 0; index < 4; index += 1) {
    const a = quad[index]
    const b = quad[(index + 1) % 4]
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 5))
    for (let step = 0; step < steps; step += 1) {
      if (!insideRings({ x: lerp(a.x, b.x, step / steps), z: lerp(a.z, b.z, step / steps) }, lot)) return false
    }
  }
  return true
}

/**
 * 沿一个地块的每一圈边（建筑红线）往前排楼：取一段弦当临街面，往地块里退进进深。
 * 写字楼面宽 30–42 米、进深 26–36 米，裙楼加塔楼；其余是面宽 8–18 米、进深 14–26 米的沿街楼。放不下就往前挪几米再试。
 */
function frontageBuildings(lot: Polygon, context: HeightContext, footprints: FootprintIndex): BuildingSpec[] {
  const random = context.random
  const buildings: BuildingSpec[] = []
  lot.forEach((ring, ringIndex) => {
    const n = ring.length
    const cumulative = [0]
    for (let index = 1; index <= n; index += 1) {
      const a = ring[index - 1]
      const b = ring[index % n]
      cumulative.push(cumulative[index - 1] + Math.hypot(b.x - a.x, b.z - a.z))
    }
    const perimeter = cumulative[n]
    if (perimeter < 20) return
    const at = (along: number): Point => {
      const s = ((along % perimeter) + perimeter) % perimeter
      let index = 0
      while (index < n - 1 && cumulative[index + 1] < s) index += 1
      const a = ring[index]
      const b = ring[(index + 1) % n]
      const span = cumulative[index + 1] - cumulative[index]
      const t = span > 0 ? (s - cumulative[index]) / span : 0
      return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) }
    }
    // 外圈逆时针、洞顺时针时地块都在前进方向左手边；按实际绕向判断
    const signedArea = areaD(toPath(ring))
    const lotOnLeft = (ringIndex === 0) === (signedArea > 0)
    let cursor = random() * 6
    while (cursor < perimeter - 6) {
      const a = at(cursor)
      const floorsRaw = floorsAt(context.floors, heightBias(context, a.x, a.z))
      const tall = floorsRaw >= TOWER_MIN_FLOORS
      const attempts = tall
        ? [{ width: lerp(30, 42, random()), depth: lerp(26, 36, random()), tall: true }, { width: lerp(8, 18, random()), depth: lerp(14, 26, random()), tall: false }]
        : [{ width: lerp(8, 18, random()), depth: lerp(14, 26, random()), tall: false }]
      let placed = 0
      for (const attempt of attempts) {
        if (cursor + attempt.width > perimeter) continue
        const b = at(cursor + attempt.width)
        const chord = Math.hypot(b.x - a.x, b.z - a.z)
        // 临街面跨过转角或急弯时弦明显短于沿边长度，换个位置
        if (chord < attempt.width * 0.9) continue
        const middle = at(cursor + attempt.width / 2)
        let u = { x: (b.x - a.x) / chord, z: (b.z - a.z) / chord }
        const left = { x: -u.z, z: u.x }
        let origin = a
        if (!lotOnLeft) {
          u = { x: -u.x, z: -u.z }
          origin = b
        }
        const v = { x: -u.z, z: u.x }
        // 弦离边超过 2.5 米（弯得厉害）也不放
        const bulge = Math.abs((middle.x - a.x) * left.x + (middle.z - a.z) * left.z)
        if (bulge > 2.5) continue
        const frame = { origin: { x: origin.x + v.x * SETBACK, z: origin.z + v.z * SETBACK }, u, v }
        let depth = attempt.depth
        let quad = quadOf(frame, chord, depth)
        if (!fitsLot(quad, lot) || footprints.overlaps(quad)) {
          depth *= 0.6
          if (depth < 8) continue
          quad = quadOf(frame, chord, depth)
          if (!fitsLot(quad, lot) || footprints.overlaps(quad)) continue
        }
        placed = chord
        if (random() >= context.density) break
        footprints.add(quad)
        const lotRect = { x0: 0, x1: chord, z0: 0, z1: depth }
        if (attempt.tall && depth >= 20) {
          const range = clampFloorRange(BUILDING_TYPES.office.floors, context.floors)
          const floors = Math.min(range.max, Math.max(range.min, floorsRaw))
          buildings.push(towerMassing(lotRect, floors, BUILDING_TYPES.office, 3 + Math.floor(random() * 3)).map(part => placePart(part, frame)))
        } else {
          const range = clampFloorRange(BUILDING_TYPES.rowhouse.floors, context.floors)
          const floors = Math.min(range.max, Math.max(range.min, floorsRaw))
          buildings.push([placePart(box(lotRect, 0, buildingHeight(floors, BUILDING_TYPES.rowhouse.heights)), frame)])
        }
        break
      }
      cursor += placed > 0 ? placed + (random() < 0.2 ? lerp(2, 6, random()) : 0) : 3
    }
  })
  return buildings
}

// ---------------------------------------------------------------------------------------------
// 布局
// ---------------------------------------------------------------------------------------------

export function organicCityLayout(params: CityParams, random: Random, decorRandom: Random | null): StageSetLayout {
  const network = networkFor(params)
  const { halfX, halfZ } = network.bounds
  const context: HeightContext = {
    random,
    floors: params.floors,
    density: params.density,
    downtown: params.heightProfile === 'downtown',
    distance: (x, z) => Math.min(1, Math.hypot(x / halfX, z / halfZ) / Math.SQRT2),
  }
  const footprints = new FootprintIndex()
  const buildings = network.ground.lots.flatMap(lot => frontageBuildings(lot, context, footprints))
  if (!decorRandom) return { buildings, decor: null }

  const writer = new DecorWriter(decorRandom)
  // 底下整片是沥青，人行道、水面、草地按形状铺在上面；剩下露出来的就是车行道
  writer.surface('road', { x0: -halfX, x1: halfX, z0: -halfZ, z1: halfZ })
  for (const polygon of network.ground.sidewalk) writer.area('sidewalk', polygon)
  for (const polygon of network.ground.water) writer.area('water', polygon)
  for (const polygon of network.ground.lawn) writer.area('lawn', polygon)

  const sidewalk = new PolygonSet(network.ground.sidewalk)
  const water = new PolygonSet(network.ground.water)
  const index = new RoadIndex(network.roads)
  network.roads.forEach((road, roadIndex) => {
    const section = ORGANIC_STYLE.roads[road.roadClass]
    // 树和灯以实际铺出来的人行道为准（路口倒圆、窄岛填平之后）；停的车不能在水上或别的路的车行道里
    const placeable = (point: Point, on: 'sidewalk' | 'carriageway'): boolean => on === 'sidewalk'
      ? sidewalk.contains(point)
      : Math.abs(point.x) < halfX - 0.5 && Math.abs(point.z) < halfZ - 0.5 && !water.contains(point) && !index.inOtherCarriage(point, roadIndex, 1)
    const path = new PolylinePath(road.points, section, road.roadClass, pick(ORGANIC_STYLE.treeVariants, writer.random), placeable)
    for (const piece of roadPieces(path, roadIndex, index)) {
      decorateSegment(writer, path, piece.start, piece.end, { start: piece.startJunction, end: piece.endJunction, treeSpacing: ORGANIC_STYLE.treeSpacing })
    }
  })

  // 公园草地里按泊松圆盘撒树，离草地边至少 2.5 米
  for (const polygon of network.ground.lawn) {
    const inner = new PolygonSet(differenceTree(inflateAreas(polygon.map(toPath), -2.5), [], 1))
    const xs = polygon[0].map(point => point.x)
    const zs = polygon[0].map(point => point.z)
    const x0 = Math.min(...xs)
    const z0 = Math.min(...zs)
    const width = Math.max(...xs) - x0
    const depth = Math.max(...zs) - z0
    if (width < 10 || depth < 10) continue
    const sampler = new PoissonDiskSampling({ shape: [width, depth], minDistance: 9, maxDistance: 16, tries: 12 }, writer.random)
    for (const [x, z] of sampler.fill()) {
      const point = { x: x0 + x, z: z0 + z }
      if (inner.contains(point)) writer.tree(point, pick(ORGANIC_STYLE.treeVariants, writer.random))
    }
  }
  return { buildings, decor: writer.decor }
}
