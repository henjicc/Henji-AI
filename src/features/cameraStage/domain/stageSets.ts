import { v4 as uuidv4 } from 'uuid'

import { CAMERA_STAGE_OBJECT_PALETTE_HEX, CAMERA_STAGE_SET_BUILDING_PALETTE_HEX } from '@/core/theme/colorTokens'
import {
  CAMERA_STAGE_SET_PRESET_LABELS,
  STAGE_SET_DEFAULTS,
  type CameraStageSetLayoutInput,
  type CameraStageSetParams,
} from '@/core/application-control/domains/cameraStage/cameraStageSetSchemas'

import type { StageBodyVariantId } from './bodyVariants'
import { createCharacterObject } from './sceneDefaults'
import type { StageObject, StagePrimitiveKind, StageSet } from './sceneTypes'

/*
 * 布景生成：按意图参数一次算出一片抽象布景的全部对象。
 *
 * 纯函数、确定性：同一组补齐后的参数（含种子）总是得到同样的位置、尺寸和颜色，只有对象 ID 每次新取。
 * 成员是普通对象（几何体与角色），带 setId 指回布景，所以生成后可以逐个移动、改色、删除；
 * 重新生成与删除布景按 setId 整体替换。界面与助手都经这里生成，再交给 store.applyStageSet 落地。
 */

type Params<P extends CameraStageSetParams['preset']> = Extract<CameraStageSetParams, { preset: P }>

/** mulberry32：足够均匀、可复现，种子取 32 位整数。 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function randomStageSetSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647)
}

/**
 * 补齐参数：输入里给了的用输入；重新生成同一预设时没给的沿用上一次，其余取默认值。
 * 种子省略时新建取随机、重新生成沿用，这样“改一个参数再生成”不会把整片布景打乱。
 */
export function resolveStageSetParams(input: CameraStageSetLayoutInput, previous?: CameraStageSetParams): CameraStageSetParams {
  const base = previous && previous.preset === input.preset ? previous : { ...STAGE_SET_DEFAULTS[input.preset], seed: randomStageSetSeed() }
  const defined = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
  return { ...base, ...defined } as CameraStageSetParams
}

function uniqueSetName(existing: readonly StageSet[], requested: string, excludedId?: string): string {
  const taken = new Set(existing.filter(set => set.id !== excludedId).map(set => set.name))
  if (!taken.has(requested)) return requested
  for (let index = 2; ; index += 1) {
    const candidate = `${requested} ${index}`
    if (!taken.has(candidate)) return candidate
  }
}

interface Placement {
  centerX: number
  centerZ: number
  cos: number
  sin: number
  rotation: number
}

function placementOf(params: CameraStageSetParams): Placement {
  const radians = (params.rotation * Math.PI) / 180
  return { centerX: params.center.x, centerZ: params.center.z, cos: Math.cos(radians), sin: Math.sin(radians), rotation: params.rotation }
}

/** 布景局部坐标 → 场景坐标；与 three.js 绕 Y 轴旋转同向，物体自身朝向加上同一个角度。 */
function toWorld(placement: Placement, x: number, z: number): { x: number; z: number } {
  return {
    x: placement.centerX + x * placement.cos + z * placement.sin,
    z: placement.centerZ - x * placement.sin + z * placement.cos,
  }
}

interface BuildingSpec { x: number; z: number; width: number; depth: number; height: number; yaw?: number }

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t
}

/** 楼高：多数偏矮、少数接近最高（平方分布），和真实城市天际线一致。 */
function buildingHeight(random: () => number, range: { min: number; max: number }, falloff = 1): number {
  return lerp(range.min, range.max, random() ** 2 * falloff)
}

/** 每个方向的街区数取偶数，场景中心才总是落在路口上（主角摆在原点不会压进楼里）。 */
function cityBlockCount(span: number, pitch: number): number {
  return Math.max(2, 2 * Math.round(span / pitch / 2))
}

function cityBuildings(params: Params<'city'>, random: () => number): BuildingSpec[] {
  const pitch = params.blockSize + params.streetWidth
  const blocksX = cityBlockCount(params.width, pitch)
  const blocksZ = cityBlockCount(params.depth, pitch)
  const lots = Math.max(1, Math.floor(params.blockSize / params.lotSize))
  const lot = params.blockSize / lots
  const halfWidth = (blocksX * pitch) / 2
  const halfDepth = (blocksZ * pitch) / 2
  const buildings: BuildingSpec[] = []
  for (let blockX = 0; blockX < blocksX; blockX += 1) {
    // 街区中心落在 (i + 0.5) × 间距 上，街区数为偶数，场景中心正好是路口。
    const blockCenterX = (blockX - blocksX / 2 + 0.5) * pitch
    for (let blockZ = 0; blockZ < blocksZ; blockZ += 1) {
      const blockCenterZ = (blockZ - blocksZ / 2 + 0.5) * pitch
      for (let lotX = 0; lotX < lots; lotX += 1) {
        for (let lotZ = 0; lotZ < lots; lotZ += 1) {
          if (random() >= params.density) continue
          const x = blockCenterX - params.blockSize / 2 + (lotX + 0.5) * lot
          const z = blockCenterZ - params.blockSize / 2 + (lotZ + 0.5) * lot
          const distance = Math.min(1, Math.hypot(x / halfWidth, z / halfDepth) / Math.SQRT2)
          const falloff = params.heightProfile === 'downtown' ? 0.12 + 0.88 * (1 - distance) ** 2 : 1
          buildings.push({
            x, z,
            width: lot * lerp(0.7, 0.92, random()),
            depth: lot * lerp(0.7, 0.92, random()),
            height: buildingHeight(random, params.height, falloff),
          })
        }
      }
    }
  }
  return buildings
}

function streetBuildings(params: Params<'street'>, random: () => number): BuildingSpec[] {
  const lots = Math.max(1, Math.floor(params.length / params.lotWidth))
  const lot = params.length / lots
  const buildings: BuildingSpec[] = []
  for (const side of [-1, 1]) {
    for (let index = 0; index < lots; index += 1) {
      if (random() >= params.density) continue
      const depth = params.buildingDepth * lerp(0.75, 1, random())
      buildings.push({
        x: -params.length / 2 + (index + 0.5) * lot,
        z: side * (params.streetWidth / 2 + depth / 2),
        width: lot * lerp(0.82, 0.96, random()),
        depth,
        height: buildingHeight(random, params.height),
      })
    }
  }
  return buildings
}

function plazaBuildings(params: Params<'plaza'>, random: () => number): BuildingSpec[] {
  const buildings: BuildingSpec[] = []
  const inner = params.size / 2
  const ring = inner + params.buildingDepth / 2
  // 南北两边连同四角一起排，东西两边只排中段，四角不重复。
  const sides: Array<{ along: 'x' | 'z'; offset: number; span: number }> = [
    { along: 'x', offset: -ring, span: params.size + params.buildingDepth * 2 },
    { along: 'x', offset: ring, span: params.size + params.buildingDepth * 2 },
    { along: 'z', offset: -ring, span: params.size },
    { along: 'z', offset: ring, span: params.size },
  ]
  for (const side of sides) {
    const lots = Math.max(1, Math.floor(side.span / params.lotWidth))
    const lot = side.span / lots
    for (let index = 0; index < lots; index += 1) {
      if (random() >= params.density) continue
      const along = -side.span / 2 + (index + 0.5) * lot
      const facade = lot * lerp(0.86, 0.98, random())
      const depth = params.buildingDepth * lerp(0.8, 1, random())
      const height = buildingHeight(random, params.height)
      buildings.push(side.along === 'x'
        ? { x: along, z: side.offset, width: facade, depth, height }
        : { x: side.offset, z: along, width: depth, depth: facade, height })
    }
  }
  return buildings
}

function paddedIndex(index: number, total: number): string {
  return String(index + 1).padStart(Math.max(2, String(total).length), '0')
}

function primitive(
  set: StageSet,
  placement: Placement,
  kind: StagePrimitiveKind,
  name: string,
  color: string,
  spec: BuildingSpec,
): StageObject {
  const world = toWorld(placement, spec.x, spec.z)
  return {
    id: uuidv4(),
    type: 'primitive',
    kind,
    name,
    color,
    visible: true,
    setId: set.id,
    transform: {
      position: { x: world.x, y: spec.height / 2, z: world.z },
      rotation: { x: 0, y: placement.rotation + (spec.yaw ?? 0), z: 0 },
      scale: { x: spec.width, y: spec.height, z: spec.depth },
    },
  }
}

function buildingObjects(set: StageSet, specs: BuildingSpec[], random: () => number): StageObject[] {
  const placement = placementOf(set.params)
  return specs.map((spec, index) => primitive(
    set, placement, 'box', `${set.name} 楼${paddedIndex(index, specs.length)}`,
    CAMERA_STAGE_SET_BUILDING_PALETTE_HEX[Math.floor(random() * CAMERA_STAGE_SET_BUILDING_PALETTE_HEX.length)],
    spec,
  ))
}

function monumentObjects(set: StageSet): StageObject[] {
  const placement = placementOf(set.params)
  const color = CAMERA_STAGE_SET_BUILDING_PALETTE_HEX[3]
  const base = primitive(set, placement, 'cylinder', `${set.name} 纪念碑基座`, color, { x: 0, z: 0, width: 6, depth: 6, height: 1 })
  const column = primitive(set, placement, 'box', `${set.name} 纪念碑`, color, { x: 0, z: 0, width: 1.2, depth: 1.2, height: 9 })
  column.transform.position.y += 1
  return [base, column]
}

const CROWD_VARIANTS: StageBodyVariantId[] = ['standard', 'strong', 'slim']

function crowdPositions(params: Params<'crowd'>, random: () => number): Array<{ x: number; z: number }> {
  if (params.formation === 'grid') {
    const columns = Math.ceil(Math.sqrt(params.count))
    const rows = Math.ceil(params.count / columns)
    return Array.from({ length: params.count }, (_, index) => ({
      x: ((index % columns) - (columns - 1) / 2) * params.spacing,
      z: (Math.floor(index / columns) - (rows - 1) / 2) * params.spacing,
    }))
  }
  if (params.formation === 'ring') {
    const radius = Math.max(params.spacing, (params.count * params.spacing) / (Math.PI * 2))
    return Array.from({ length: params.count }, (_, index) => {
      const angle = (index / params.count) * Math.PI * 2
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
    })
  }
  // 散开：在约等于方阵面积的圆里随机取点，间距不足就换个点；多次换不到时接受当前点，人数照给。
  // 邻近检查按间距大小的格子查周围 9 格，人数上万也是线性。
  const radius = Math.max(params.spacing, Math.sqrt(params.count / Math.PI) * params.spacing * 1.25)
  const minDistance = params.spacing * 0.8
  const cell = Math.max(minDistance, 1e-6)
  const grid = new Map<string, Array<{ x: number; z: number }>>()
  const key = (x: number, z: number): string => `${Math.floor(x / cell)},${Math.floor(z / cell)}`
  const crowded = (point: { x: number; z: number }): boolean => {
    const cx = Math.floor(point.x / cell)
    const cz = Math.floor(point.z / cell)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const other of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (Math.hypot(other.x - point.x, other.z - point.z) < minDistance) return true
        }
      }
    }
    return false
  }
  const placed: Array<{ x: number; z: number }> = []
  for (let index = 0; index < params.count; index += 1) {
    let candidate = { x: 0, z: 0 }
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const angle = random() * Math.PI * 2
      const distance = Math.sqrt(random()) * radius
      candidate = { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance }
      if (!crowded(candidate)) break
    }
    placed.push(candidate)
    const cellKey = key(candidate.x, candidate.z)
    const bucket = grid.get(cellKey)
    if (bucket) bucket.push(candidate)
    else grid.set(cellKey, [candidate])
  }
  return placed
}

function crowdObjects(set: StageSet, random: () => number): StageObject[] {
  const params = set.params as Params<'crowd'>
  const placement = placementOf(params)
  return crowdPositions(params, random).map((local, index) => {
    const character = createCharacterObject(
      `${set.name} 人${paddedIndex(index, params.count)}`,
      CAMERA_STAGE_OBJECT_PALETTE_HEX[Math.floor(random() * CAMERA_STAGE_OBJECT_PALETTE_HEX.length)],
    )
    const world = toWorld(placement, local.x, local.z)
    // 角色模型正面朝局部 +Z；面向中心时转到指向布景中心的方向。
    const yaw = params.facing === 'center'
      ? (Math.atan2(-local.x, -local.z) * 180) / Math.PI
      : params.facing === 'random' ? random() * 360 : 0
    return {
      ...character,
      setId: set.id,
      variant: CROWD_VARIANTS[Math.floor(random() * CROWD_VARIANTS.length)],
      transform: { ...character.transform, position: { x: world.x, y: 0, z: world.z }, rotation: { x: 0, y: placement.rotation + yaw, z: 0 } },
    }
  })
}

export function generateStageSetObjects(set: StageSet): StageObject[] {
  const random = createRandom(set.params.seed)
  const params = set.params
  if (params.preset === 'crowd') return crowdObjects(set, random)
  if (params.preset === 'city') return buildingObjects(set, cityBuildings(params, random), random)
  if (params.preset === 'street') return buildingObjects(set, streetBuildings(params, random), random)
  return [...buildingObjects(set, plazaBuildings(params, random), random), ...(params.monument ? monumentObjects(set) : [])]
}

/**
 * 建出一片布景：新建时取新 ID 和不重名的名称；替换已有布景时沿用它的 ID，名称不变（除非另给）。
 */
export function buildStageSet(
  existing: readonly StageSet[],
  input: { layout: CameraStageSetLayoutInput; name?: string; replaceSetId?: string },
): { set: StageSet; objects: StageObject[] } {
  const previous = input.replaceSetId ? existing.find(set => set.id === input.replaceSetId) : undefined
  if (input.replaceSetId && !previous) {
    const available = existing.map(set => `${set.id}（${set.name}）`)
    throw new Error(`STAGE_SET_NOT_FOUND：«${input.replaceSetId}» 不是本场景中的布景 id。`
      + (available.length > 0 ? `当前布景：${available.join('、')}。` : '当前场景没有布景，省略 replaceSetId 即可新建。'))
  }
  const params = resolveStageSetParams(input.layout, previous?.params)
  const id = previous?.id ?? uuidv4()
  const requestedName = input.name?.trim() || previous?.name || CAMERA_STAGE_SET_PRESET_LABELS[params.preset]
  const set: StageSet = { id, name: uniqueSetName(existing, requestedName, id), params }
  const objects = generateStageSetObjects(set)
  // 空布景没有成员就等于不存在；在任何写入之前拒绝，替换时也不会先把旧布景删掉。
  if (objects.length === 0) {
    throw new Error('STAGE_SET_EMPTY：这组参数一个对象都生成不了（密度为 0 或太低），请调大密度。')
  }
  return { set, objects }
}

/** 不生成就估出大约多少个对象（按密度取期望值），给人在生成前判断规模。 */
export function estimateStageSetObjectCount(params: CameraStageSetParams): number {
  if (params.preset === 'crowd') return params.count
  if (params.preset === 'city') {
    const pitch = params.blockSize + params.streetWidth
    const lots = Math.max(1, Math.floor(params.blockSize / params.lotSize))
    return Math.round(cityBlockCount(params.width, pitch) * cityBlockCount(params.depth, pitch) * lots * lots * params.density)
  }
  if (params.preset === 'street') return Math.round(2 * Math.max(1, Math.floor(params.length / params.lotWidth)) * params.density)
  const longSide = Math.max(1, Math.floor((params.size + params.buildingDepth * 2) / params.lotWidth))
  const shortSide = Math.max(1, Math.floor(params.size / params.lotWidth))
  return Math.round(2 * (longSide + shortSide) * params.density) + (params.monument ? 2 : 0)
}

/** 已知的布景类型；更新版本写出的其他类型照样保留记录，只是本版本不能重新生成。 */
export function isKnownStageSetPreset(preset: string): preset is CameraStageSetParams['preset'] {
  return preset in STAGE_SET_DEFAULTS
}

/** 还有成员的布景；成员被逐个删光的布景不再算数。 */
export function liveStageSets(sets: readonly StageSet[], objects: readonly StageObject[]): StageSet[] {
  if (sets.length === 0) return []
  const used = new Set<string>()
  for (const object of objects) if (object.setId) used.add(object.setId)
  return sets.filter(set => used.has(set.id))
}
