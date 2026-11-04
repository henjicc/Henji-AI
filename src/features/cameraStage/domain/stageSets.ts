import { v4 as uuidv4 } from 'uuid'

import { CAMERA_STAGE_OBJECT_PALETTE_HEX, CAMERA_STAGE_SET_BUILDING_PALETTE_HEX } from '@/core/theme/colorTokens'
import {
  CAMERA_STAGE_SET_PRESET_LABELS,
  CITY_STYLE_DEFAULT_FLOORS,
  STAGE_SET_DEFAULTS,
  type CameraStageSetLayoutInput,
  type CameraStageSetParams,
} from '@/core/application-control/domains/cameraStage/cameraStageSetSchemas'

import type { StageBodyVariantId } from './bodyVariants'
import { createCharacterObject } from './sceneDefaults'
import { STAGE_SET_DECOR_STRIDE, type StageObject, type StagePrimitiveKind, type StageSet, type StageSetDecor } from './sceneTypes'
import { layoutStageSet, type BuildingPart, type BuildingSpec } from './stageSetLayout'
import { stageSetPlacement, stageSetToWorld, type StageSetPlacement } from './stageSetPlacement'

/*
 * 布景生成：按意图参数一次算出一片抽象布景的全部对象，以及地面铺装与比例参照物。
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

/** 装饰用另一条随机序列：开关参照物不改变楼的布局。 */
function decorRandomOf(params: CameraStageSetParams): (() => number) | null {
  return 'props' in params && params.props ? createRandom((params.seed ^ 0x5bd1e995) >>> 0) : null
}

export function randomStageSetSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647)
}

/**
 * 补齐参数：输入里给了的用输入；重新生成同一预设时没给的沿用上一次，其余取默认值。
 * 种子省略时新建取随机、重新生成沿用，这样“改一个参数再生成”不会把整片布景打乱。
 * 城市换了风格又没给楼层时，楼层取新风格的默认值：老城沿用方格城市的 40 层就不像老城了。
 */
export function resolveStageSetParams(input: CameraStageSetLayoutInput, previous?: CameraStageSetParams): CameraStageSetParams {
  const base = previous && previous.preset === input.preset ? previous : { ...structuredClone(STAGE_SET_DEFAULTS[input.preset]), seed: randomStageSetSeed() }
  const defined = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
  const resolved = { ...base, ...defined } as CameraStageSetParams
  if (resolved.preset === 'city' && input.preset === 'city' && !input.floors && input.style && (base as Params<'city'>).style !== input.style) {
    resolved.floors = { ...CITY_STYLE_DEFAULT_FLOORS[input.style] }
  }
  return resolved
}

function uniqueSetName(existing: readonly StageSet[], requested: string, excludedId?: string): string {
  const taken = new Set(existing.filter(set => set.id !== excludedId).map(set => set.name))
  if (!taken.has(requested)) return requested
  for (let index = 2; ; index += 1) {
    const candidate = `${requested} ${index}`
    if (!taken.has(candidate)) return candidate
  }
}

function paddedIndex(index: number, total: number): string {
  return String(index + 1).padStart(Math.max(2, String(total).length), '0')
}

const PART_SUFFIX: Record<BuildingPart['role'], string> = { main: '', podium: ' 裙楼', tower: ' 塔楼', crown: ' 屋顶' }

function primitive(set: StageSet, placement: StageSetPlacement, kind: StagePrimitiveKind, name: string, color: string, part: BuildingPart): StageObject {
  const world = stageSetToWorld(placement, part.x, part.z)
  return {
    id: uuidv4(),
    type: 'primitive',
    kind,
    name,
    color,
    visible: true,
    setId: set.id,
    transform: {
      position: { x: world.x, y: part.base + part.height / 2, z: world.z },
      rotation: { x: 0, y: placement.rotation, z: 0 },
      scale: { x: part.width, y: part.height, z: part.depth },
    },
  }
}

/** 楼体颜色按楼取：同一栋楼的裙楼、塔楼、屋顶同色。颜色另用一条随机序列，不影响布局。 */
function buildingObjects(set: StageSet, buildings: readonly BuildingSpec[]): StageObject[] {
  const placement = stageSetPlacement(set.params)
  const random = createRandom((set.params.seed ^ 0x2545f491) >>> 0)
  const objects: StageObject[] = []
  buildings.forEach((parts, index) => {
    const color = CAMERA_STAGE_SET_BUILDING_PALETTE_HEX[Math.floor(random() * CAMERA_STAGE_SET_BUILDING_PALETTE_HEX.length)]
    const name = `${set.name} 楼${paddedIndex(index, buildings.length)}`
    const seen = new Map<BuildingPart['role'], number>()
    for (const part of parts) {
      const count = (seen.get(part.role) ?? 0) + 1
      seen.set(part.role, count)
      // 同一栋楼里同一种体块有几个时（一座裙楼上两座塔楼）按序号区分名称
      const repeated = parts.filter(candidate => candidate.role === part.role).length > 1
      objects.push(primitive(set, placement, 'box', `${name}${PART_SUFFIX[part.role]}${repeated ? count : ''}`, color, part))
    }
  })
  return objects
}

/** 广场中心的纪念碑：真实尺度，直径 10 米的基座上立 16 米的方柱。 */
function monumentObjects(set: StageSet): StageObject[] {
  const placement = stageSetPlacement(set.params)
  const color = CAMERA_STAGE_SET_BUILDING_PALETTE_HEX[3]
  return [
    primitive(set, placement, 'cylinder', `${set.name} 纪念碑基座`, color, { x: 0, z: 0, width: 10, depth: 10, base: 0, height: 1.2, role: 'main' }),
    primitive(set, placement, 'box', `${set.name} 纪念碑`, color, { x: 0, z: 0, width: 2.2, depth: 2.2, base: 1.2, height: 16, role: 'main' }),
  ]
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
  const placement = stageSetPlacement(params)
  return crowdPositions(params, random).map((local, index) => {
    const character = createCharacterObject(
      `${set.name} 人${paddedIndex(index, params.count)}`,
      CAMERA_STAGE_OBJECT_PALETTE_HEX[Math.floor(random() * CAMERA_STAGE_OBJECT_PALETTE_HEX.length)],
    )
    const world = stageSetToWorld(placement, local.x, local.z)
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

/** 一片布景的成员对象与装饰。装饰只在参照物打开时才有。 */
export function generateStageSet(set: Omit<StageSet, 'decor'>): { objects: StageObject[]; decor?: StageSetDecor; buildingCount: number } {
  const params = set.params
  if (params.preset === 'crowd') return { objects: crowdObjects(set, createRandom(params.seed)), buildingCount: 0 }
  const layout = layoutStageSet(params, createRandom(params.seed), decorRandomOf(params))
  const objects = buildingObjects(set, layout.buildings)
  if (params.preset === 'plaza' && params.monument) objects.push(...monumentObjects(set))
  return { objects, ...(layout.decor ? { decor: layout.decor } : {}), buildingCount: layout.buildings.length }
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
  const base = { id, name: uniqueSetName(existing, requestedName, id), params }
  const { objects, decor } = generateStageSet(base)
  // 空布景没有成员就等于不存在；在任何写入之前拒绝，替换时也不会先把旧布景删掉。
  if (objects.length === 0) {
    throw new Error('STAGE_SET_EMPTY：这组参数一个对象都生成不了（密度为 0 或太低），请调大密度。')
  }
  return { set: decor ? { ...base, decor } : base, objects }
}

/** 不建对象就数出这组参数会生成几栋楼、几个对象（同一份布局算法，只是不生成装饰与对象）。 */
export function estimateStageSet(params: CameraStageSetParams): { objects: number; buildings: number } {
  if (params.preset === 'crowd') return { objects: params.count, buildings: 0 }
  const layout = layoutStageSet(params, createRandom(params.seed), null)
  const parts = layout.buildings.reduce((total, building) => total + building.length, 0)
  return { objects: parts + (params.preset === 'plaza' && params.monument ? 2 : 0), buildings: layout.buildings.length }
}

export interface StageSetDecorCounts { trees: number; lamps: number; vehicles: number }

export function countStageSetDecor(decor: StageSetDecor | undefined): StageSetDecorCounts {
  if (!decor) return { trees: 0, lamps: 0, vehicles: 0 }
  return {
    trees: Math.floor(decor.trees.length / STAGE_SET_DECOR_STRIDE.tree),
    lamps: Math.floor(decor.lamps.length / STAGE_SET_DECOR_STRIDE.lamp),
    vehicles: Math.floor(decor.vehicles.length / STAGE_SET_DECOR_STRIDE.vehicle),
  }
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
