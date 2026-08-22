import {
  fieldDescriptors,
  fieldReadValues,
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationPropertyValue,
  type ApplicationRef,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import type { StageObject, StageSceneSettings } from '../domain/sceneTypes'
import { getAnimatablePropByPath } from '../domain/animatableProps'
import type { CameraStageProjectSnapshot } from '../projects/cameraStageProjectService'
import { cameraStageApplicationService } from './cameraStageApplicationService'
import {
  cameraStageCollectionAvailability,
  cameraStageProjectIdFromRef,
  cameraStagePropertyRestriction,
} from './cameraStageAvailability'
import {
  CAMERA_ANIMATABLE_PATH_BY_PROPERTY_ID,
  CAMERA_FIELDS,
  OBJECT_ANIMATABLE_PATH_BY_PROPERTY_ID,
  OBJECT_FIELDS,
} from './cameraStageObjectFields'
import { SCENE_APPEARANCE_FIELDS, SCENE_TIMELINE_FIELDS } from './cameraStageSceneFields'
import { PLAYBACK_FIELDS, PROJECT_FIELDS, STATE_KEYFRAME_FIELDS } from './cameraStageTimelineFields'
import { TRAJECTORY_FIELDS } from './cameraStageTrajectoryFields'
import { calculateStageObjectBounds } from './sceneAnalysis'

const DOMAIN = 'camera_stage'
const REVISION_SCOPE = 'toolbox'
const ENTITY_TYPES = {
  project: 'camera_stage.project',
  scene: 'camera_stage.scene',
  object: 'camera_stage.object',
  camera: 'camera_stage.camera',
  stateKeyframe: 'camera_stage.state_keyframe',
  trajectory: 'camera_stage.trajectory',
  playback: 'camera_stage.playback',
} as const

type EntityType = typeof ENTITY_TYPES[keyof typeof ENTITY_TYPES]
type RevisionReader = () => number

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(kind: 'entity' | 'property', id: string) {
  return {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    kind,
    id,
    version: 1,
    digest: digest(`${kind}:${id}`),
  } as const
}

function vec3Value(value: { x: number; y: number; z: number }): JsonValue {
  return { x: value.x, y: value.y, z: value.z }
}

/**
 * 动画属性的描述符是按实体类型注册的（同一类型下每个实例的可写属性集合一样），但具体某个
 * 实例是否真的具备某条属性（姿态关节只有角色才有）是实例级判断。`fieldReadValues()` 对
 * 每条字段无条件求值，这里按 `isAvailable()` 把不适用于这个实例的键从结果里摘掉，
 * 维持"读到的属性就是这个对象真的具备的属性"这条既有约定。
 */
function omitUnavailableAnimatableValues(
  values: Record<string, JsonValue>,
  pathByPropertyId: ReadonlyMap<string, string>,
  object: StageObject,
): Record<string, JsonValue> {
  const filtered = { ...values }
  for (const [propertyId, path] of pathByPropertyId) {
    if (!getAnimatablePropByPath(path)?.isAvailable(object)) delete filtered[propertyId]
  }
  return filtered
}

function property(
  entityType: EntityType,
  suffix: string,
  title: string,
  value: ApplicationPropertyValue,
  options: {
    description?: string
    nullable?: boolean
    readOnly?: string
    unit?: string
    relation?: ApplicationPropertyDescriptor['relation']
  } = {},
): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: options.description ?? `三维${title}的稳定控制属性。`,
    value,
    ...(options.unit ? { unit: options.unit } : {}),
    nullable: options.nullable ?? false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: {
      read: ['camera_stage:read'],
      write: options.readOnly ? [] : ['camera_stage:write'],
    },
    revisionScopes: [REVISION_SCOPE],
    schemaRef: schemaRef('property', id),
    ...(options.readOnly ? { readOnlyReason: options.readOnly } : {}),
    ...(options.relation ? { relation: options.relation } : {}),
  }
}

const STRING = { kind: 'string', maxLength: 500 } as const
const INTEGER = { kind: 'integer', hardRange: { min: 0 } } as const
const VECTOR3 = { kind: 'vector3', unit: 'scene_unit' } as const

const propertiesByEntity: Record<EntityType, ApplicationPropertyDescriptor[]> = {
  [ENTITY_TYPES.project]: [
    ...fieldDescriptors(PROJECT_FIELDS),
    property(ENTITY_TYPES.project, 'object_count', '对象数量', INTEGER, { readOnly: '对象数量由场景内容计算。' }),
    property(ENTITY_TYPES.project, 'state_keyframe_count', '状态关键帧数量', INTEGER, { readOnly: '数量由状态关键帧集合计算。' }),
  ],
  [ENTITY_TYPES.scene]: [
    property(ENTITY_TYPES.scene, 'project_ref', '所属工程', { kind: 'ref', refKinds: [ENTITY_TYPES.project] }, { readOnly: '所属工程不可变更。', relation: { targetEntityTypes: [ENTITY_TYPES.project], cardinality: 'one' } }),
    property(ENTITY_TYPES.scene, 'object_refs', '场景对象', { kind: 'ref_list', refKinds: [ENTITY_TYPES.object, ENTITY_TYPES.camera] }, { readOnly: '对象集合通过正式创建和删除操作维护。', relation: { targetEntityTypes: [ENTITY_TYPES.object, ENTITY_TYPES.camera], cardinality: 'many' } }),
    property(ENTITY_TYPES.scene, 'state_keyframe_refs', '状态关键帧', { kind: 'ref_list', refKinds: [ENTITY_TYPES.stateKeyframe] }, { readOnly: '状态关键帧的增删排序通过 camera_stage.state_keyframe 的集合写入维护，这里只读列出当前集合。', relation: { targetEntityTypes: [ENTITY_TYPES.stateKeyframe], cardinality: 'many' } }),
    /*
     * 场景外观 26 项 + 活动摄像机：界面上有的每一项这里都要有。
     *
     * 这一组此前一项都没注册，于是"把天空改成深蓝""地面换成网格""把太阳调到黄昏"这类
     * 请求助手全都做不了——不是被权限挡住，是通用动词**根本看不见**这些字段。按项目规则
     * （注册实体属性后走通用动词，不为设值手写专用能力），补注册就是唯一正确的修法。
     * 定义收敛在 cameraStageSceneFields.ts，这里只派生，不再逐条手写。
     */
    ...fieldDescriptors(SCENE_APPEARANCE_FIELDS),
    ...fieldDescriptors(SCENE_TIMELINE_FIELDS),
  ],
  [ENTITY_TYPES.object]: [
    ...fieldDescriptors(OBJECT_FIELDS),
    property(ENTITY_TYPES.object, 'type', '对象类型', { kind: 'enum', values: [{ value: 'primitive', label: '基础几何体' }, { value: 'character', label: '角色' }] }, { readOnly: '对象类型创建后不可变更。' }),
    property(ENTITY_TYPES.object, 'primitive_kind', '几何体类型', { kind: 'enum', values: ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus'].map((value) => ({ value, label: value })) }, { nullable: true, readOnly: '几何体类型创建后不可变更。' }),
    property(ENTITY_TYPES.object, 'bounds.min', '边界盒最小点', VECTOR3, { readOnly: '边界盒由对象尺寸和变换计算。' }),
    property(ENTITY_TYPES.object, 'bounds.max', '边界盒最大点', VECTOR3, { readOnly: '边界盒由对象尺寸和变换计算。' }),
  ],
  [ENTITY_TYPES.camera]: [
    ...fieldDescriptors(CAMERA_FIELDS),
    property(ENTITY_TYPES.camera, 'look_at_mode', '注视模式', { kind: 'enum', values: [{ value: 'manual', label: '坐标' }, { value: 'object', label: '对象' }] }, { readOnly: '注视模式由注视点或注视对象修改推导。' }),
    property(ENTITY_TYPES.camera, 'effector_count', '效果器数量', INTEGER, { readOnly: '效果器数量由效果器列表计算。' }),
  ],
  [ENTITY_TYPES.stateKeyframe]: [
    ...fieldDescriptors(STATE_KEYFRAME_FIELDS),
  ],
  [ENTITY_TYPES.playback]: [
    ...fieldDescriptors(PLAYBACK_FIELDS),
  ],
  [ENTITY_TYPES.trajectory]: [
    property(ENTITY_TYPES.trajectory, 'state_keyframe_ref', '起始状态关键帧', { kind: 'ref', refKinds: [ENTITY_TYPES.stateKeyframe] }, { readOnly: '轨迹所属状态关键帧不可变更。', relation: { targetEntityTypes: [ENTITY_TYPES.stateKeyframe], cardinality: 'one' } }),
    property(ENTITY_TYPES.trajectory, 'object_ref', '运动对象', { kind: 'ref', refKinds: [ENTITY_TYPES.object, ENTITY_TYPES.camera] }, { readOnly: '轨迹对象不可变更。', relation: { targetEntityTypes: [ENTITY_TYPES.object, ENTITY_TYPES.camera], cardinality: 'one' } }),
    property(ENTITY_TYPES.trajectory, 'source', '轨迹来源', STRING, { readOnly: '轨迹来源由语义操作或手动编辑产生；手动编辑后由写入自动标记为 custom，见 knots 等可写属性。' }),
    property(ENTITY_TYPES.trajectory, 'knot_count', '控制点数量', INTEGER, { readOnly: '控制点数量由 knots 属性的数组长度计算，写 knots 即可增减控制点。' }),
    ...fieldDescriptors(TRAJECTORY_FIELDS),
  ],
}

/**
 * 场景外观属性的读取侧，与 SCENE_APPEARANCE_WRITERS 一一对应。
 *
 * 写得进去读不回来等于没写：结算要靠读回的值当证据，助手也要靠它确认改对没有。
 */
export function sceneAppearanceProperties(settings: StageSceneSettings): Record<string, JsonValue> {
  return fieldReadValues(SCENE_APPEARANCE_FIELDS, settings)
}

function childRef(kind: EntityType, projectId: string, id: string, label?: string): ApplicationRef {
  return { kind, id: `${projectId}:${id}`, ...(label ? { label } : {}) }
}

function splitChildRef(ref: ApplicationRef, expected: EntityType): { projectId: string; childId: string } {
  if (ref.kind !== expected) throw new Error('NOT_FOUND')
  const separator = ref.id.indexOf(':')
  if (separator < 1) throw new Error('NOT_FOUND')
  return { projectId: ref.id.slice(0, separator), childId: ref.id.slice(separator + 1) }
}

function filterProperties(properties: Record<string, JsonValue>, requested?: string[]): Record<string, JsonValue> {
  if (!requested) return properties
  const allowed = new Set(requested)
  return Object.fromEntries(Object.entries(properties).filter(([id]) => allowed.has(id)))
}

class CameraStageReflectionProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: EntityType, private readonly readRevision: RevisionReader) {}

  async listEntities(request: { cursor?: string; limit: number }) {
    const refs = await this.allRefs()
    const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
    const page = refs.slice(offset, offset + request.limit)
    return {
      refs: page,
      nextCursor: offset + page.length < refs.length ? String(offset + page.length) : null,
      revisions: { [REVISION_SCOPE]: this.readRevision() },
    }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    const normalizedRef = await this.normalizeRef(ref)
    const properties = await this.readProperties(normalizedRef)
    return {
      ref: normalizedRef,
      entityType: this.entityType,
      revisions: { [REVISION_SCOPE]: this.readRevision() },
      properties: filterProperties(properties, request.propertyIds),
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    const normalizedRef = await this.normalizeRef(ref)
    await this.readProperties(normalizedRef)
    const snapshot = await cameraStageApplicationService.readSnapshot(cameraStageProjectIdFromRef(normalizedRef))
    const descriptors = new Map(propertiesByEntity[this.entityType].map((item) => [item.id, item]))
    return propertyIds.map((propertyId) => {
      const descriptor = descriptors.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      const restriction = cameraStagePropertyRestriction(this.entityType, propertyId, snapshot)
      return {
        propertyId,
        readable: true,
        writable: !descriptor.readOnlyReason && !restriction,
        reasons: [descriptor.readOnlyReason, restriction?.reason].filter((reason): reason is string => Boolean(reason)),
        ...(restriction ? { blocks: restriction.blocks } : {}),
        ...(restriction ? { recoveries: restriction.recoveries } : {}),
        requiredPermissions: ['camera_stage:read'],
        revisions: { [REVISION_SCOPE]: this.readRevision() },
      }
    })
  }

  async getCollectionAvailability(parent: ApplicationRef) {
    const snapshot = await cameraStageApplicationService.readSnapshot(cameraStageProjectIdFromRef(parent))
    return cameraStageCollectionAvailability(this.entityType, parent, snapshot, this.readRevision())
  }

  private async snapshots(): Promise<CameraStageProjectSnapshot[]> {
    const projects = await cameraStageApplicationService.listProjects()
    const results = await Promise.allSettled(
      projects.map((project) => cameraStageApplicationService.readSnapshot(project.id)),
    )
    return results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  }

  private async allRefs(): Promise<ApplicationRef[]> {
    const snapshots = await this.snapshots()
    return snapshots.flatMap((snapshot) => {
      if (this.entityType === ENTITY_TYPES.project) return [{ kind: this.entityType, id: snapshot.id, label: snapshot.name }]
      if (this.entityType === ENTITY_TYPES.scene) return [{ kind: this.entityType, id: snapshot.id, label: `${snapshot.name} 场景` }]
      // 播放是会话态：只有当前打开的那个工程才有播放头，没打开的工程列出来也读不到值。
      if (this.entityType === ENTITY_TYPES.playback) {
        return cameraStageApplicationService.readPlayback(snapshot.id)
          ? [{ kind: this.entityType, id: snapshot.id, label: `${snapshot.name} 播放` }]
          : []
      }
      if (this.entityType === ENTITY_TYPES.object) return snapshot.objects.filter((object) => object.type !== 'camera').map((object) => childRef(this.entityType, snapshot.id, object.id, object.name))
      if (this.entityType === ENTITY_TYPES.camera) return snapshot.objects.filter((object) => object.type === 'camera').map((object) => childRef(this.entityType, snapshot.id, object.id, object.name))
      if (this.entityType === ENTITY_TYPES.stateKeyframe) return snapshot.stateKeyframes.map((stateKeyframe) => childRef(this.entityType, snapshot.id, stateKeyframe.id, stateKeyframe.name))
      if (this.entityType === ENTITY_TYPES.trajectory) return snapshot.stateKeyframes.flatMap((stateKeyframe) => Object.entries(stateKeyframe.transition.perObject).flatMap(([objectId, detail]) => detail.spatialPath ? [childRef(this.entityType, snapshot.id, `${stateKeyframe.id}:${objectId}`)] : []))
      return []
    })
  }

  /**
   * 接受当前工程内唯一的子实体短 ID，并立即规范化成正式的 `projectId:childId`。
   *
   * 模型偶尔会从已返回的稳定引用里只保留末段 UUID。让它因此多失败、再 list 一轮没有任何
   * 安全价值：短 ID 只有在全工程唯一时才解析，存在歧义仍按 NOT_FOUND 拒绝。
   */
  private async normalizeRef(ref: ApplicationRef): Promise<ApplicationRef> {
    if (ref.kind !== this.entityType || ref.id.includes(':')) return ref
    const shortRefEntityTypes = new Set<EntityType>([
      ENTITY_TYPES.object, ENTITY_TYPES.camera, ENTITY_TYPES.stateKeyframe,
    ])
    if (!shortRefEntityTypes.has(this.entityType)) return ref
    const matches = (await this.snapshots()).flatMap((snapshot) => {
      if (this.entityType === ENTITY_TYPES.stateKeyframe) {
        return snapshot.stateKeyframes.some((item) => item.id === ref.id)
          ? [childRef(this.entityType, snapshot.id, ref.id, ref.label)]
          : []
      }
      const expectsCamera = this.entityType === ENTITY_TYPES.camera
      const object = snapshot.objects.find((item) => item.id === ref.id
        && (item.type === 'camera') === expectsCamera)
      return object ? [childRef(this.entityType, snapshot.id, ref.id, ref.label ?? object.name)] : []
    })
    return matches.length === 1 ? matches[0] : ref
  }

  private async readProperties(ref: ApplicationRef): Promise<Record<string, JsonValue>> {
    if (this.entityType === ENTITY_TYPES.playback) {
      if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
      const playback = cameraStageApplicationService.readPlayback(ref.id)
      if (!playback) throw new Error('NOT_FOUND')
      return fieldReadValues(PLAYBACK_FIELDS, playback)
    }
    if (this.entityType === ENTITY_TYPES.project || this.entityType === ENTITY_TYPES.scene) {
      if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
      const snapshot = await cameraStageApplicationService.readSnapshot(ref.id)
      if (this.entityType === ENTITY_TYPES.project) return this.projectProperties(snapshot)
      return this.sceneProperties(snapshot)
    }
    const { projectId, childId } = splitChildRef(ref, this.entityType)
    const snapshot = await cameraStageApplicationService.readSnapshot(projectId)
    if (this.entityType === ENTITY_TYPES.object || this.entityType === ENTITY_TYPES.camera) {
      const object = snapshot.objects.find((candidate) => candidate.id === childId)
      if (!object || (this.entityType === ENTITY_TYPES.camera) !== (object.type === 'camera')) throw new Error('NOT_FOUND')
      return object.type === 'camera' ? this.cameraProperties(projectId, object) : this.objectProperties(object)
    }
    if (this.entityType === ENTITY_TYPES.stateKeyframe) {
      const stateKeyframe = snapshot.stateKeyframes.find((candidate) => candidate.id === childId)
      if (!stateKeyframe) throw new Error('NOT_FOUND')
      return this.stateKeyframeProperties(projectId, stateKeyframe, snapshot.objects)
    }
    if (this.entityType === ENTITY_TYPES.trajectory) return this.trajectoryProperties(projectId, snapshot, childId)
    throw new Error('NOT_FOUND')
  }

  private projectProperties(snapshot: CameraStageProjectSnapshot): Record<string, JsonValue> {
    return {
      ...fieldReadValues(PROJECT_FIELDS, snapshot),
      [`${ENTITY_TYPES.project}.object_count`]: snapshot.objects.length,
      [`${ENTITY_TYPES.project}.state_keyframe_count`]: snapshot.stateKeyframes.length,
    }
  }

  private sceneProperties(snapshot: CameraStageProjectSnapshot): Record<string, JsonValue> {
    return {
      [`${ENTITY_TYPES.scene}.project_ref`]: { kind: ENTITY_TYPES.project, id: snapshot.id, label: snapshot.name },
      [`${ENTITY_TYPES.scene}.object_refs`]: snapshot.objects.map((object) => childRef(object.type === 'camera' ? ENTITY_TYPES.camera : ENTITY_TYPES.object, snapshot.id, object.id, object.name)),
      [`${ENTITY_TYPES.scene}.state_keyframe_refs`]: snapshot.stateKeyframes.map((stateKeyframe) => childRef(ENTITY_TYPES.stateKeyframe, snapshot.id, stateKeyframe.id, stateKeyframe.name)),
      ...fieldReadValues(SCENE_TIMELINE_FIELDS, snapshot),
      ...sceneAppearanceProperties(snapshot.sceneSettings),
    }
  }

  private objectProperties(object: Exclude<StageObject, { type: 'camera' }>): Record<string, JsonValue> {
    const bounds = calculateStageObjectBounds(object)
    return {
      ...omitUnavailableAnimatableValues(fieldReadValues(OBJECT_FIELDS, object), OBJECT_ANIMATABLE_PATH_BY_PROPERTY_ID, object),
      [`${ENTITY_TYPES.object}.type`]: object.type,
      [`${ENTITY_TYPES.object}.primitive_kind`]: object.type === 'primitive' ? object.kind : null,
      [`${ENTITY_TYPES.object}.bounds.min`]: vec3Value(bounds.min),
      [`${ENTITY_TYPES.object}.bounds.max`]: vec3Value(bounds.max),
    }
  }

  private cameraProperties(projectId: string, camera: Extract<StageObject, { type: 'camera' }>): Record<string, JsonValue> {
    return {
      ...omitUnavailableAnimatableValues(fieldReadValues(CAMERA_FIELDS, { projectId, camera }), CAMERA_ANIMATABLE_PATH_BY_PROPERTY_ID, camera),
      [`${ENTITY_TYPES.camera}.look_at_mode`]: camera.lookAt.mode,
      [`${ENTITY_TYPES.camera}.effector_count`]: camera.effectors.length,
    }
  }

  private stateKeyframeProperties(projectId: string, stateKeyframe: CameraStageProjectSnapshot['stateKeyframes'][number], objects: StageObject[]): Record<string, JsonValue> {
    return fieldReadValues(STATE_KEYFRAME_FIELDS, { projectId, stateKeyframe, objects })
  }

  private trajectoryProperties(projectId: string, snapshot: CameraStageProjectSnapshot, id: string): Record<string, JsonValue> {
    const [stateKeyframeId, objectId] = id.split(':')
    const index = snapshot.stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === stateKeyframeId)
    const stateKeyframe = snapshot.stateKeyframes[index]
    const nextStateKeyframe = snapshot.stateKeyframes[index + 1]
    const path = stateKeyframe?.transition.perObject[objectId]?.spatialPath
    const startPosition = stateKeyframe?.objectStates[objectId]?.transform.position
    const endPosition = nextStateKeyframe?.objectStates[objectId]?.transform.position
    if (!path || !startPosition || !endPosition) throw new Error('NOT_FOUND')
    const object = snapshot.objects.find((candidate) => candidate.id === objectId)
    return {
      [`${ENTITY_TYPES.trajectory}.state_keyframe_ref`]: childRef(ENTITY_TYPES.stateKeyframe, projectId, stateKeyframeId),
      [`${ENTITY_TYPES.trajectory}.object_ref`]: childRef(object?.type === 'camera' ? ENTITY_TYPES.camera : ENTITY_TYPES.object, projectId, objectId),
      [`${ENTITY_TYPES.trajectory}.source`]: path.source.kind === 'preset' ? path.source.preset.kind : 'custom',
      [`${ENTITY_TYPES.trajectory}.knot_count`]: path.knots.length,
      ...fieldReadValues(TRAJECTORY_FIELDS, { path, startPosition, endPosition }),
    }
  }

}

const ENTITY_META: Record<EntityType, { title: string; description: string; parents: EntityType[]; queryIds: string[] }> = {
  [ENTITY_TYPES.project]: { title: '三维工程', description: '可持久化的三维场景与运镜工程。', parents: [], queryIds: ['get_camera_stage_project'] },
  [ENTITY_TYPES.scene]: { title: '三维场景', description: '工程中的对象、活动摄像机和状态关键帧集合。', parents: [ENTITY_TYPES.project], queryIds: ['observe_camera_stage_scene'] },
  [ENTITY_TYPES.object]: { title: '三维对象', description: '基础几何体或角色对象。', parents: [ENTITY_TYPES.scene], queryIds: ['observe_camera_stage_scene'] },
  [ENTITY_TYPES.camera]: { title: '三维摄像机', description: '具有取景、注视和轨迹控制的摄像机。', parents: [ENTITY_TYPES.scene], queryIds: ['observe_camera_stage_scene'] },
  [ENTITY_TYPES.stateKeyframe]: { title: '状态关键帧', description: '指定时刻的完整场景状态和到下一时刻的过渡定义。', parents: [ENTITY_TYPES.scene], queryIds: ['observe_camera_stage_scene'] },
  [ENTITY_TYPES.trajectory]: { title: '三维轨迹', description: '对象或摄像机在相邻状态关键帧间的空间路径。', parents: [ENTITY_TYPES.stateKeyframe], queryIds: ['observe_camera_stage_scene'] },
  [ENTITY_TYPES.playback]: { title: '三维播放控制', description: '时间轴的播放、播放头位置与循环开关。只对当前打开的工程有意义。', parents: [ENTITY_TYPES.project], queryIds: ['observe_camera_stage_scene'] },
}

export function createCameraStageReflectionRegistrations(readRevision: RevisionReader): ApplicationEntityRegistration[] {
  return Object.values(ENTITY_TYPES).map((entityType) => {
    const meta = ENTITY_META[entityType]
    return {
      entity: {
        id: entityType,
        domain: DOMAIN,
        version: 1,
        title: meta.title,
        description: meta.description,
        refKind: entityType,
        dataClass: 'C1',
        exposures: ['ui', 'assistant', 'local_adapter'],
        parentTypes: meta.parents,
        revisionScopes: [REVISION_SCOPE],
        queryCapabilityIds: meta.queryIds,
        schemaRef: schemaRef('entity', entityType),
        ...(entityType === ENTITY_TYPES.stateKeyframe ? {
          collectionWrite: {
            creatable: true,
            removable: true,
            requiredPropertyIds: [`${ENTITY_TYPES.stateKeyframe}.time`],
            maxItemsPerChange: 64,
          },
        } : {}),
      },
      properties: propertiesByEntity[entityType],
      provider: new CameraStageReflectionProvider(entityType, readRevision),
    }
  })
}

export { ENTITY_TYPES as CAMERA_STAGE_ENTITY_TYPES }
