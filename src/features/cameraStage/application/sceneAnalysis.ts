import type {
  StageObject,
  StageObjectType,
  StagePrimitiveKind,
  StageTransform,
  StageVec3,
} from '../domain/sceneTypes'

export type CameraStageObjectRole = 'subject' | 'prop' | 'character' | 'camera' | 'environment'
export type CameraStageReusePolicy = 'prefer_existing' | 'require_new'
export type CameraStagePlacementMode = 'auto' | 'beside' | 'surround' | 'foreground' | 'background'

export interface CameraStageObjectSpec {
  objectId?: string
  objectType: StageObjectType
  primitiveKind?: StagePrimitiveKind
  name?: string
  role?: CameraStageObjectRole
  reusePolicy: CameraStageReusePolicy
}

export interface CameraStagePlacementIntent {
  mode: CameraStagePlacementMode
  position?: StageVec3
  rotation?: StageVec3
  scale?: StageVec3
  dimensions?: StageVec3
  targetObjectId?: string
  spacing: number
  allowOverlap: boolean
}

export interface StageObjectBounds {
  objectId: string
  min: StageVec3
  max: StageVec3
  center: StageVec3
  size: StageVec3
}

export interface CameraStageReuseDecision {
  object: StageObject | null
  reason: string
}

export interface CameraStageLayoutDecision {
  position: StageVec3
  bounds: StageObjectBounds
  conflicts: string[]
  reason: string
  explicit: boolean
}

const BASE_DIMENSIONS: Record<StagePrimitiveKind, StageVec3> = {
  box: { x: 1, y: 1, z: 1 },
  sphere: { x: 1, y: 1, z: 1 },
  cylinder: { x: 1, y: 1, z: 1 },
  cone: { x: 1, y: 1, z: 1 },
  pyramid: { x: 1, y: 1, z: 1 },
  torus: { x: 1.5, y: 0.5, z: 1.5 },
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function normalizedName(value: string | undefined): string {
  return value?.normalize('NFKC').trim().toLocaleLowerCase() ?? ''
}

function matchesType(object: StageObject, spec: CameraStageObjectSpec): boolean {
  if (object.type !== spec.objectType) return false
  return object.type !== 'primitive' || !spec.primitiveKind || object.kind === spec.primitiveKind
}

function roleMatches(object: StageObject, role: CameraStageObjectRole | undefined): boolean {
  if (!role) return true
  if (role === 'camera') return object.type === 'camera'
  if (role === 'character') return object.type === 'character'
  if (role === 'subject') return object.type !== 'camera'
  if (role === 'prop') return object.type === 'primitive'
  return object.type === 'primitive'
}

export function matchReusableSceneObject(
  objects: StageObject[],
  spec: CameraStageObjectSpec,
  activeCameraId: string | null,
): CameraStageReuseDecision {
  if (spec.reusePolicy === 'require_new') {
    return { object: null, reason: '调用方明确要求新建对象。' }
  }
  if (spec.objectId) {
    const explicit = objects.find((object) => object.id === spec.objectId)
    if (!explicit) throw new Error('NOT_FOUND')
    if (!matchesType(explicit, spec)) throw new Error('OBJECT_TYPE_MISMATCH')
    return { object: explicit, reason: '复用调用方提供的稳定对象引用。' }
  }
  if (spec.objectType === 'camera' && activeCameraId) {
    const active = objects.find((object) => object.id === activeCameraId && object.type === 'camera')
    if (active) return { object: active, reason: '复用当前工程的活动摄像机。' }
  }

  const candidates = objects.filter((object) => matchesType(object, spec) && roleMatches(object, spec.role))
  const wantedName = normalizedName(spec.name)
  if (wantedName) {
    const exact = candidates.find((object) => normalizedName(object.name) === wantedName)
    if (exact) return { object: exact, reason: '按对象类型和名称别名复用已有对象。' }
  }
  if (candidates.length === 1 && spec.role) {
    return { object: candidates[0], reason: '按场景角色复用唯一匹配对象。' }
  }
  return { object: null, reason: candidates.length > 1 ? '存在多个候选，避免猜测并新建明确对象。' : '场景中没有满足约束的对象。' }
}

export function baseDimensionsForObject(object: Pick<StageObject, 'type'> & Partial<StageObject>): StageVec3 {
  if (object.type === 'primitive') {
    const kind = 'kind' in object && object.kind ? object.kind : 'box'
    return { ...BASE_DIMENSIONS[kind] }
  }
  if (object.type === 'character') return { x: 0.8, y: 1.8, z: 0.5 }
  return { x: 0.5, y: 0.35, z: 0.7 }
}

export function dimensionsToScale(
  object: Pick<StageObject, 'type'> & Partial<StageObject>,
  dimensions: StageVec3,
): StageVec3 {
  const base = baseDimensionsForObject(object)
  return {
    x: finitePositive(dimensions.x, base.x) / base.x,
    y: finitePositive(dimensions.y, base.y) / base.y,
    z: finitePositive(dimensions.z, base.z) / base.z,
  }
}

export function calculateStageObjectBounds(
  object: StageObject,
  transform: StageTransform = object.transform,
): StageObjectBounds {
  const base = baseDimensionsForObject(object)
  const size = {
    x: base.x * finitePositive(Math.abs(transform.scale.x), 1),
    y: base.y * finitePositive(Math.abs(transform.scale.y), 1),
    z: base.z * finitePositive(Math.abs(transform.scale.z), 1),
  }
  const center = object.type === 'character'
    ? { ...transform.position, y: transform.position.y + size.y / 2 }
    : { ...transform.position }
  return {
    objectId: object.id,
    center,
    size,
    min: { x: center.x - size.x / 2, y: center.y - size.y / 2, z: center.z - size.z / 2 },
    max: { x: center.x + size.x / 2, y: center.y + size.y / 2, z: center.z + size.z / 2 },
  }
}

export function stageBoundsOverlap(a: StageObjectBounds, b: StageObjectBounds, margin = 0): boolean {
  return a.min.x < b.max.x + margin && a.max.x > b.min.x - margin
    && a.min.y < b.max.y + margin && a.max.y > b.min.y - margin
    && a.min.z < b.max.z + margin && a.max.z > b.min.z - margin
}

export function listStageBoundsConflicts(
  bounds: StageObjectBounds,
  objects: StageObject[],
  excludedObjectId?: string,
  margin = 0,
): string[] {
  return objects
    .filter((object) => object.id !== excludedObjectId && object.type !== 'camera' && object.visible)
    .filter((object) => stageBoundsOverlap(bounds, calculateStageObjectBounds(object), margin))
    .map((object) => object.id)
}

function sceneCenter(objects: StageObject[]): StageVec3 {
  const visible = objects.filter((object) => object.type !== 'camera' && object.visible)
  if (visible.length === 0) return { x: 0, y: 0.5, z: 0 }
  return {
    x: visible.reduce((total, object) => total + object.transform.position.x, 0) / visible.length,
    y: visible.reduce((total, object) => total + object.transform.position.y, 0) / visible.length,
    z: visible.reduce((total, object) => total + object.transform.position.z, 0) / visible.length,
  }
}

function candidatePositions(
  mode: CameraStagePlacementMode,
  origin: StageVec3,
  targetBounds: StageObjectBounds | null,
  objectSize: StageVec3,
  spacing: number,
): StageVec3[] {
  const target = targetBounds?.center ?? origin
  const targetSize = targetBounds?.size ?? { x: 0, y: 0, z: 0 }
  const dx = targetSize.x / 2 + objectSize.x / 2 + spacing
  const dz = targetSize.z / 2 + objectSize.z / 2 + spacing
  if (mode === 'foreground') return [{ x: target.x, y: origin.y, z: target.z + dz }]
  if (mode === 'background') return [{ x: target.x, y: origin.y, z: target.z - dz }]
  if (mode === 'beside') {
    return [
      { x: target.x + dx, y: origin.y, z: target.z },
      { x: target.x - dx, y: origin.y, z: target.z },
      { x: target.x, y: origin.y, z: target.z + dz },
      { x: target.x, y: origin.y, z: target.z - dz },
    ]
  }
  if (mode === 'surround') {
    const radius = Math.max(dx, dz)
    return Array.from({ length: 8 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 8
      return { x: target.x + Math.cos(angle) * radius, y: origin.y, z: target.z + Math.sin(angle) * radius }
    })
  }
  const step = Math.max(objectSize.x, objectSize.z) + spacing
  return [
    origin,
    ...Array.from({ length: 4 }, (_, ring) => ring + 1).flatMap((radius) => [
      { x: origin.x + step * radius, y: origin.y, z: origin.z },
      { x: origin.x - step * radius, y: origin.y, z: origin.z },
      { x: origin.x, y: origin.y, z: origin.z + step * radius },
      { x: origin.x, y: origin.y, z: origin.z - step * radius },
    ]),
  ]
}

export function resolveScenePlacement(
  object: StageObject,
  objects: StageObject[],
  intent: CameraStagePlacementIntent,
): CameraStageLayoutDecision {
  const scale = intent.dimensions ? dimensionsToScale(object, intent.dimensions) : intent.scale ?? object.transform.scale
  const baseTransform = { ...object.transform, scale }
  const explicitPosition = intent.position
  if (explicitPosition) {
    const transform = { ...baseTransform, position: explicitPosition }
    const bounds = calculateStageObjectBounds(object, transform)
    const conflicts = listStageBoundsConflicts(bounds, objects, object.id, 0)
    return {
      position: explicitPosition,
      bounds,
      conflicts,
      reason: conflicts.length > 0
        ? '采用用户明确坐标；该坐标与已有对象相交。'
        : '采用用户明确坐标。',
      explicit: true,
    }
  }

  const target = intent.targetObjectId
    ? objects.find((candidate) => candidate.id === intent.targetObjectId) ?? null
    : null
  if (intent.targetObjectId && !target) throw new Error('NOT_FOUND')
  const origin = target?.transform.position ?? sceneCenter(objects)
  const probe = calculateStageObjectBounds(object, { ...baseTransform, position: origin })
  const margin = Math.max(0, intent.spacing)
  const candidates = candidatePositions(
    intent.mode,
    origin,
    target ? calculateStageObjectBounds(target) : null,
    probe.size,
    margin,
  )
  for (const position of candidates) {
    const bounds = calculateStageObjectBounds(object, { ...baseTransform, position })
    const conflicts = listStageBoundsConflicts(bounds, objects, object.id, margin)
    if (conflicts.length === 0 || intent.allowOverlap) {
      return {
        position,
        bounds,
        conflicts,
        reason: intent.allowOverlap && conflicts.length > 0
          ? '调用方允许重叠，采用首个满足关系的候选位置。'
          : `采用 ${intent.mode} 关系下的首个无冲突候选位置。`,
        explicit: false,
      }
    }
  }
  throw new Error('NO_CONFLICT_FREE_POSITION')
}

export function listSceneCollisionPairs(objects: StageObject[]): Array<{ objectIds: [string, string] }> {
  const candidates = objects.filter((object) => object.type !== 'camera' && object.visible)
  const result: Array<{ objectIds: [string, string] }> = []
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (stageBoundsOverlap(calculateStageObjectBounds(candidates[left]), calculateStageObjectBounds(candidates[right]))) {
        result.push({ objectIds: [candidates[left].id, candidates[right].id] })
      }
    }
  }
  return result
}
