import {
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationPropertyValue,
  type ApplicationRef,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import type { StageObject } from '../domain/sceneTypes'
import { getAnimatablePropByPath, listAnimatablePropertyPaths } from '../domain/animatableProps'
import type { CameraStageProjectSnapshot } from '../projects/cameraStageProjectService'
import { cameraStageApplicationService } from './cameraStageApplicationService'
import { calculateStageObjectBounds } from './sceneAnalysis'

const DOMAIN = 'camera_stage'
const REVISION_SCOPE = 'toolbox'
const ENTITY_TYPES = {
  project: 'camera_stage.project',
  scene: 'camera_stage.scene',
  object: 'camera_stage.object',
  camera: 'camera_stage.camera',
  shot: 'camera_stage.shot',
  trajectory: 'camera_stage.trajectory',
  keyframe: 'camera_stage.keyframe',
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
const NUMBER = { kind: 'number' } as const
const INTEGER = { kind: 'integer', hardRange: { min: 0 } } as const
const VECTOR3 = { kind: 'vector3', unit: 'scene_unit' } as const
const BOOLEAN = { kind: 'boolean' } as const
const COLOR = { kind: 'color', format: 'hex' } as const

function propertyPathId(path: string): string {
  return path.replace(/[A-Z]/g, (character) => `_${character.toLocaleLowerCase()}`)
}

function animatableProperties(entityType: typeof ENTITY_TYPES.object | typeof ENTITY_TYPES.camera): ApplicationPropertyDescriptor[] {
  return listAnimatablePropertyPaths().flatMap((path) => {
    const cameraCompatible = path.startsWith('transform.position.')
      || path.startsWith('transform.rotation.') || path === 'color' || path === 'fov'
    const objectCompatible = path !== 'fov'
    if ((entityType === ENTITY_TYPES.camera && !cameraCompatible) || (entityType === ENTITY_TYPES.object && !objectCompatible)) return []
    const id = `${entityType}.animatable.${propertyPathId(path)}`
    return [{
      ...property(entityType, `animatable.${propertyPathId(path)}`, `可动画属性 ${path}`, path === 'color' ? COLOR : NUMBER, {
        readOnly: '逐分量动画值通过关键帧实体或领域语义操作修改。',
      }),
      id,
      schemaRef: schemaRef('property', id),
    }]
  })
}

const propertiesByEntity: Record<EntityType, ApplicationPropertyDescriptor[]> = {
  [ENTITY_TYPES.project]: [
    property(ENTITY_TYPES.project, 'name', '工程名称', { kind: 'string', minLength: 1, maxLength: 120 }),
    property(ENTITY_TYPES.project, 'editor_mode', '编辑模式', { kind: 'enum', values: [{ value: 'simple', label: '简易' }, { value: 'pro', label: '专业' }] }, { readOnly: '编辑模式只能通过正式烘焙操作切换。' }),
    property(ENTITY_TYPES.project, 'object_count', '对象数量', INTEGER, { readOnly: '对象数量由场景内容计算。' }),
    property(ENTITY_TYPES.project, 'shot_count', '镜头数量', INTEGER, { readOnly: '镜头数量由镜头列表计算。' }),
  ],
  [ENTITY_TYPES.scene]: [
    property(ENTITY_TYPES.scene, 'project_ref', '所属工程', { kind: 'ref', refKinds: [ENTITY_TYPES.project] }, { readOnly: '所属工程不可变更。', relation: { targetEntityTypes: [ENTITY_TYPES.project], cardinality: 'one' } }),
    property(ENTITY_TYPES.scene, 'active_camera_ref', '活动摄像机', { kind: 'ref', refKinds: [ENTITY_TYPES.camera] }, { nullable: true, relation: { targetEntityTypes: [ENTITY_TYPES.camera], cardinality: 'optional' } }),
    property(ENTITY_TYPES.scene, 'object_refs', '场景对象', { kind: 'ref_list', refKinds: [ENTITY_TYPES.object, ENTITY_TYPES.camera] }, { readOnly: '对象集合通过正式创建和删除操作维护。', relation: { targetEntityTypes: [ENTITY_TYPES.object, ENTITY_TYPES.camera], cardinality: 'many' } }),
    property(ENTITY_TYPES.scene, 'shot_refs', '镜头卡', { kind: 'ref_list', refKinds: [ENTITY_TYPES.shot] }, { readOnly: '镜头集合通过正式镜头操作维护。', relation: { targetEntityTypes: [ENTITY_TYPES.shot], cardinality: 'many' } }),
    property(ENTITY_TYPES.scene, 'duration', '动画时长', { kind: 'number', hardRange: { min: 0, max: 3600 } }, { unit: 'second' }),
    property(ENTITY_TYPES.scene, 'fps', '帧率', { kind: 'integer', hardRange: { min: 1, max: 240 } }, { unit: 'fps' }),
  ],
  [ENTITY_TYPES.object]: [
    property(ENTITY_TYPES.object, 'name', '对象名称', { kind: 'string', minLength: 1, maxLength: 120 }),
    property(ENTITY_TYPES.object, 'type', '对象类型', { kind: 'enum', values: [{ value: 'primitive', label: '基础几何体' }, { value: 'character', label: '角色' }] }, { readOnly: '对象类型创建后不可变更。' }),
    property(ENTITY_TYPES.object, 'visible', '可见性', BOOLEAN),
    property(ENTITY_TYPES.object, 'color', '材质颜色', COLOR),
    property(ENTITY_TYPES.object, 'primitive_kind', '几何体类型', { kind: 'enum', values: ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus'].map((value) => ({ value, label: value })) }, { nullable: true, readOnly: '几何体类型创建后不可变更。' }),
    property(ENTITY_TYPES.object, 'character_variant', '角色体型', { kind: 'enum', values: ['standard', 'strong', 'slim', 'child'].map((value) => ({ value, label: value })) }, { nullable: true }),
    property(ENTITY_TYPES.object, 'transform.position', '位置', VECTOR3),
    property(ENTITY_TYPES.object, 'transform.rotation', '旋转', { kind: 'vector3', unit: 'degree' }),
    property(ENTITY_TYPES.object, 'transform.scale', '缩放', VECTOR3),
    property(ENTITY_TYPES.object, 'bounds.min', '边界盒最小点', VECTOR3, { readOnly: '边界盒由对象尺寸和变换计算。' }),
    property(ENTITY_TYPES.object, 'bounds.max', '边界盒最大点', VECTOR3, { readOnly: '边界盒由对象尺寸和变换计算。' }),
    ...animatableProperties(ENTITY_TYPES.object),
  ],
  [ENTITY_TYPES.camera]: [
    property(ENTITY_TYPES.camera, 'name', '摄像机名称', { kind: 'string', minLength: 1, maxLength: 120 }),
    property(ENTITY_TYPES.camera, 'visible', '可见性', BOOLEAN),
    property(ENTITY_TYPES.camera, 'transform.position', '位置', VECTOR3),
    property(ENTITY_TYPES.camera, 'transform.rotation', '旋转', { kind: 'vector3', unit: 'degree' }),
    property(ENTITY_TYPES.camera, 'fov', '视野角', { kind: 'number', hardRange: { min: 1, max: 179 }, softRange: { min: 15, max: 100 } }, { unit: 'degree' }),
    property(ENTITY_TYPES.camera, 'look_at_mode', '注视模式', { kind: 'enum', values: [{ value: 'manual', label: '坐标' }, { value: 'object', label: '对象' }] }, { readOnly: '注视模式由注视点或注视对象修改推导。' }),
    property(ENTITY_TYPES.camera, 'look_at_target', '注视点', VECTOR3),
    property(ENTITY_TYPES.camera, 'look_at_object_ref', '注视对象', { kind: 'ref', refKinds: [ENTITY_TYPES.object] }, { nullable: true, relation: { targetEntityTypes: [ENTITY_TYPES.object], cardinality: 'optional' } }),
    property(ENTITY_TYPES.camera, 'aspect_ratio_preset', '画幅预设', { kind: 'enum', values: ['16:9', '4:3', '1:1', '9:16', 'custom'].map((value) => ({ value, label: value })) }),
    property(ENTITY_TYPES.camera, 'aspect_ratio', '画幅比例', { kind: 'number', hardRange: { min: 0.1, max: 10 } }),
    property(ENTITY_TYPES.camera, 'effector_count', '效果器数量', INTEGER, { readOnly: '效果器数量由效果器列表计算。' }),
    ...animatableProperties(ENTITY_TYPES.camera),
  ],
  [ENTITY_TYPES.shot]: [
    property(ENTITY_TYPES.shot, 'name', '镜头名称', { kind: 'string', minLength: 1, maxLength: 120 }),
    property(ENTITY_TYPES.shot, 'time', '时间点', { kind: 'number', hardRange: { min: 0, max: 3600 } }, { unit: 'second' }),
    property(ENTITY_TYPES.shot, 'hold', '停留时长', { kind: 'number', hardRange: { min: 0, max: 3600 } }, { unit: 'second' }),
    property(ENTITY_TYPES.shot, 'transition_duration', '过渡时长', { kind: 'number', hardRange: { min: 0, max: 3600 } }, { unit: 'second' }),
    property(ENTITY_TYPES.shot, 'continuity', '连续性', { kind: 'enum', values: [{ value: 'stop', label: '停靠' }, { value: 'smooth', label: '连续' }] }),
    property(ENTITY_TYPES.shot, 'camera_ref', '拍摄机位', { kind: 'ref', refKinds: [ENTITY_TYPES.camera] }, { nullable: true, relation: { targetEntityTypes: [ENTITY_TYPES.camera], cardinality: 'optional' } }),
  ],
  [ENTITY_TYPES.trajectory]: [
    property(ENTITY_TYPES.trajectory, 'shot_ref', '起始镜头', { kind: 'ref', refKinds: [ENTITY_TYPES.shot] }, { readOnly: '轨迹所属镜头不可变更。', relation: { targetEntityTypes: [ENTITY_TYPES.shot], cardinality: 'one' } }),
    property(ENTITY_TYPES.trajectory, 'object_ref', '运动对象', { kind: 'ref', refKinds: [ENTITY_TYPES.object, ENTITY_TYPES.camera] }, { readOnly: '轨迹对象不可变更。', relation: { targetEntityTypes: [ENTITY_TYPES.object, ENTITY_TYPES.camera], cardinality: 'one' } }),
    property(ENTITY_TYPES.trajectory, 'source', '轨迹来源', STRING, { readOnly: '轨迹来源由语义操作或手动编辑产生。' }),
    property(ENTITY_TYPES.trajectory, 'knot_count', '控制点数量', INTEGER, { readOnly: '控制点数量由轨迹计算。' }),
  ],
  [ENTITY_TYPES.keyframe]: [
    property(ENTITY_TYPES.keyframe, 'object_ref', '关键帧对象', { kind: 'ref', refKinds: [ENTITY_TYPES.object, ENTITY_TYPES.camera] }, { readOnly: '关键帧对象不可变更。', relation: { targetEntityTypes: [ENTITY_TYPES.object, ENTITY_TYPES.camera], cardinality: 'one' } }),
    property(ENTITY_TYPES.keyframe, 'property_path', '属性路径', STRING, { readOnly: '属性路径由轨道定义。' }),
    property(ENTITY_TYPES.keyframe, 'time', '时间', { kind: 'number', hardRange: { min: 0, max: 3600 } }, { unit: 'second' }),
    property(ENTITY_TYPES.keyframe, 'value', '值摘要', STRING),
    property(ENTITY_TYPES.keyframe, 'easing', '缓动', STRING),
  ],
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

function valueSummary(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
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
    const properties = await this.readProperties(ref)
    return {
      ref,
      entityType: this.entityType,
      revisions: { [REVISION_SCOPE]: this.readRevision() },
      properties: filterProperties(properties, request.propertyIds),
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    await this.readProperties(ref)
    const descriptors = new Map(propertiesByEntity[this.entityType].map((item) => [item.id, item]))
    return propertyIds.map((propertyId) => {
      const descriptor = descriptors.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return {
        propertyId,
        readable: true,
        writable: !descriptor.readOnlyReason,
        reasons: descriptor.readOnlyReason ? [descriptor.readOnlyReason] : [],
        requiredPermissions: ['camera_stage:read'],
        revisions: { [REVISION_SCOPE]: this.readRevision() },
      }
    })
  }

  private async snapshots(): Promise<CameraStageProjectSnapshot[]> {
    const projects = await cameraStageApplicationService.listProjects()
    return await Promise.all(projects.map((project) => cameraStageApplicationService.readSnapshot(project.id)))
  }

  private async allRefs(): Promise<ApplicationRef[]> {
    const snapshots = await this.snapshots()
    return snapshots.flatMap((snapshot) => {
      if (this.entityType === ENTITY_TYPES.project) return [{ kind: this.entityType, id: snapshot.id, label: snapshot.name }]
      if (this.entityType === ENTITY_TYPES.scene) return [{ kind: this.entityType, id: snapshot.id, label: `${snapshot.name} 场景` }]
      if (this.entityType === ENTITY_TYPES.object) return snapshot.objects.filter((object) => object.type !== 'camera').map((object) => childRef(this.entityType, snapshot.id, object.id, object.name))
      if (this.entityType === ENTITY_TYPES.camera) return snapshot.objects.filter((object) => object.type === 'camera').map((object) => childRef(this.entityType, snapshot.id, object.id, object.name))
      if (this.entityType === ENTITY_TYPES.shot) return snapshot.shots.map((shot) => childRef(this.entityType, snapshot.id, shot.id, shot.name))
      if (this.entityType === ENTITY_TYPES.trajectory) return snapshot.shots.flatMap((shot) => Object.entries(shot.transition.perObject).flatMap(([objectId, detail]) => detail.spatialPath ? [childRef(this.entityType, snapshot.id, `${shot.id}:${objectId}`)] : []))
      return snapshot.animation.tracks.flatMap((track) => track.keyframes.map((keyframe) => childRef(this.entityType, snapshot.id, `${track.objectId}:${track.propertyPath}:${keyframe.time}`)))
    })
  }

  private async readProperties(ref: ApplicationRef): Promise<Record<string, JsonValue>> {
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
    if (this.entityType === ENTITY_TYPES.shot) {
      const shot = snapshot.shots.find((candidate) => candidate.id === childId)
      if (!shot) throw new Error('NOT_FOUND')
      return this.shotProperties(projectId, shot)
    }
    if (this.entityType === ENTITY_TYPES.trajectory) return this.trajectoryProperties(projectId, snapshot, childId)
    return this.keyframeProperties(projectId, snapshot, childId)
  }

  private projectProperties(snapshot: CameraStageProjectSnapshot): Record<string, JsonValue> {
    return {
      [`${ENTITY_TYPES.project}.name`]: snapshot.name,
      [`${ENTITY_TYPES.project}.editor_mode`]: snapshot.editorMode,
      [`${ENTITY_TYPES.project}.object_count`]: snapshot.objects.length,
      [`${ENTITY_TYPES.project}.shot_count`]: snapshot.shots.length,
    }
  }

  private sceneProperties(snapshot: CameraStageProjectSnapshot): Record<string, JsonValue> {
    return {
      [`${ENTITY_TYPES.scene}.project_ref`]: { kind: ENTITY_TYPES.project, id: snapshot.id, label: snapshot.name },
      [`${ENTITY_TYPES.scene}.active_camera_ref`]: snapshot.activeCameraId ? childRef(ENTITY_TYPES.camera, snapshot.id, snapshot.activeCameraId) : null,
      [`${ENTITY_TYPES.scene}.object_refs`]: snapshot.objects.map((object) => childRef(object.type === 'camera' ? ENTITY_TYPES.camera : ENTITY_TYPES.object, snapshot.id, object.id, object.name)),
      [`${ENTITY_TYPES.scene}.shot_refs`]: snapshot.shots.map((shot) => childRef(ENTITY_TYPES.shot, snapshot.id, shot.id, shot.name)),
      [`${ENTITY_TYPES.scene}.duration`]: snapshot.animation.duration,
      [`${ENTITY_TYPES.scene}.fps`]: snapshot.animation.fps,
    }
  }

  private objectProperties(object: Exclude<StageObject, { type: 'camera' }>): Record<string, JsonValue> {
    const bounds = calculateStageObjectBounds(object)
    return {
      [`${ENTITY_TYPES.object}.name`]: object.name,
      [`${ENTITY_TYPES.object}.type`]: object.type,
      [`${ENTITY_TYPES.object}.visible`]: object.visible,
      [`${ENTITY_TYPES.object}.color`]: object.color,
      [`${ENTITY_TYPES.object}.primitive_kind`]: object.type === 'primitive' ? object.kind : null,
      [`${ENTITY_TYPES.object}.character_variant`]: object.type === 'character' ? object.variant : null,
      [`${ENTITY_TYPES.object}.transform.position`]: vec3Value(object.transform.position),
      [`${ENTITY_TYPES.object}.transform.rotation`]: vec3Value(object.transform.rotation),
      [`${ENTITY_TYPES.object}.transform.scale`]: vec3Value(object.transform.scale),
      [`${ENTITY_TYPES.object}.bounds.min`]: vec3Value(bounds.min),
      [`${ENTITY_TYPES.object}.bounds.max`]: vec3Value(bounds.max),
      ...this.animatableValues(ENTITY_TYPES.object, object),
    }
  }

  private cameraProperties(projectId: string, camera: Extract<StageObject, { type: 'camera' }>): Record<string, JsonValue> {
    return {
      [`${ENTITY_TYPES.camera}.name`]: camera.name,
      [`${ENTITY_TYPES.camera}.visible`]: camera.visible,
      [`${ENTITY_TYPES.camera}.transform.position`]: vec3Value(camera.transform.position),
      [`${ENTITY_TYPES.camera}.transform.rotation`]: vec3Value(camera.transform.rotation),
      [`${ENTITY_TYPES.camera}.fov`]: camera.fov,
      [`${ENTITY_TYPES.camera}.look_at_mode`]: camera.lookAt.mode,
      [`${ENTITY_TYPES.camera}.look_at_target`]: vec3Value(camera.lookAt.mode === 'manual' ? camera.lookAt.target : camera.lookAt.fallbackTarget),
      [`${ENTITY_TYPES.camera}.look_at_object_ref`]: camera.lookAt.mode === 'object' ? childRef(ENTITY_TYPES.object, projectId, camera.lookAt.objectId) : null,
      [`${ENTITY_TYPES.camera}.aspect_ratio_preset`]: camera.aspectRatio.preset,
      [`${ENTITY_TYPES.camera}.aspect_ratio`]: camera.aspectRatio.ratio,
      [`${ENTITY_TYPES.camera}.effector_count`]: camera.effectors.length,
      ...this.animatableValues(ENTITY_TYPES.camera, camera),
    }
  }

  private animatableValues(
    entityType: typeof ENTITY_TYPES.object | typeof ENTITY_TYPES.camera,
    object: StageObject,
  ): Record<string, JsonValue> {
    return Object.fromEntries(listAnimatablePropertyPaths().flatMap((path) => {
      const descriptor = getAnimatablePropByPath(path)
      if (!descriptor?.isAvailable(object)) return []
      const value = descriptor.getValue(object)
      return typeof value === 'number' || typeof value === 'string'
        ? [[`${entityType}.animatable.${propertyPathId(path)}`, value]]
        : []
    }))
  }

  private shotProperties(projectId: string, shot: CameraStageProjectSnapshot['shots'][number]): Record<string, JsonValue> {
    return {
      [`${ENTITY_TYPES.shot}.name`]: shot.name,
      [`${ENTITY_TYPES.shot}.time`]: shot.time,
      [`${ENTITY_TYPES.shot}.hold`]: shot.hold,
      [`${ENTITY_TYPES.shot}.transition_duration`]: shot.transitionDuration,
      [`${ENTITY_TYPES.shot}.continuity`]: shot.continuity,
      [`${ENTITY_TYPES.shot}.camera_ref`]: shot.cameraId ? childRef(ENTITY_TYPES.camera, projectId, shot.cameraId) : null,
    }
  }

  private trajectoryProperties(projectId: string, snapshot: CameraStageProjectSnapshot, id: string): Record<string, JsonValue> {
    const [shotId, objectId] = id.split(':')
    const path = snapshot.shots.find((shot) => shot.id === shotId)?.transition.perObject[objectId]?.spatialPath
    if (!path) throw new Error('NOT_FOUND')
    const object = snapshot.objects.find((candidate) => candidate.id === objectId)
    return {
      [`${ENTITY_TYPES.trajectory}.shot_ref`]: childRef(ENTITY_TYPES.shot, projectId, shotId),
      [`${ENTITY_TYPES.trajectory}.object_ref`]: childRef(object?.type === 'camera' ? ENTITY_TYPES.camera : ENTITY_TYPES.object, projectId, objectId),
      [`${ENTITY_TYPES.trajectory}.source`]: path.source.kind === 'preset' ? path.source.preset.kind : 'custom',
      [`${ENTITY_TYPES.trajectory}.knot_count`]: path.knots.length,
    }
  }

  private keyframeProperties(projectId: string, snapshot: CameraStageProjectSnapshot, id: string): Record<string, JsonValue> {
    const parts = id.split(':')
    const objectId = parts.shift()
    const time = Number(parts.pop())
    const propertyPath = parts.join(':')
    const track = snapshot.animation.tracks.find((candidate) => candidate.objectId === objectId && candidate.propertyPath === propertyPath)
    const keyframe = track?.keyframes.find((candidate) => candidate.time === time)
    if (!objectId || !track || !keyframe) throw new Error('NOT_FOUND')
    const object = snapshot.objects.find((candidate) => candidate.id === objectId)
    return {
      [`${ENTITY_TYPES.keyframe}.object_ref`]: childRef(object?.type === 'camera' ? ENTITY_TYPES.camera : ENTITY_TYPES.object, projectId, objectId),
      [`${ENTITY_TYPES.keyframe}.property_path`]: propertyPath,
      [`${ENTITY_TYPES.keyframe}.time`]: keyframe.time,
      [`${ENTITY_TYPES.keyframe}.value`]: valueSummary(keyframe.value),
      [`${ENTITY_TYPES.keyframe}.easing`]: valueSummary(keyframe.easing),
    }
  }
}

const ENTITY_META: Record<EntityType, { title: string; description: string; parents: EntityType[]; queryIds: string[] }> = {
  [ENTITY_TYPES.project]: { title: '三维工程', description: '可持久化的三维场景与运镜工程。', parents: [], queryIds: ['get_camera_stage_project'] },
  [ENTITY_TYPES.scene]: { title: '三维场景', description: '工程中的对象、活动摄像机和动画集合。', parents: [ENTITY_TYPES.project], queryIds: ['observe_camera_stage_scene'] },
  [ENTITY_TYPES.object]: { title: '三维对象', description: '基础几何体或角色对象。', parents: [ENTITY_TYPES.scene], queryIds: ['observe_camera_stage_scene'] },
  [ENTITY_TYPES.camera]: { title: '三维摄像机', description: '具有取景、注视和轨迹控制的摄像机。', parents: [ENTITY_TYPES.scene], queryIds: ['observe_camera_stage_scene'] },
  [ENTITY_TYPES.shot]: { title: '三维镜头', description: '场景状态关键点和过渡定义。', parents: [ENTITY_TYPES.scene], queryIds: ['observe_camera_stage_scene'] },
  [ENTITY_TYPES.trajectory]: { title: '三维轨迹', description: '对象或摄像机在相邻镜头间的空间路径。', parents: [ENTITY_TYPES.shot], queryIds: ['observe_camera_stage_scene'] },
  [ENTITY_TYPES.keyframe]: { title: '三维关键帧', description: '动画轨道上的时间和值控制点。', parents: [ENTITY_TYPES.scene], queryIds: ['observe_camera_stage_scene'] },
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
        ...(entityType === ENTITY_TYPES.trajectory ? {
          writeExclusion: {
            reason: '轨迹由 apply_camera_stage_camera_move 的轨迹采样算法产生，属算法型操作的产物。',
          },
        } : {}),
        ...(entityType === ENTITY_TYPES.keyframe ? {
          /**
           * 关键帧可增删。这一句就是"助手能不能做动画"的开关：实体、属性、provider 早就注册
           * 齐了，助手能读能改，却因为没有创建路径而做不了任何对象动画——上下漂浮、自转、
           * 位移全都做不了，只能回一句"没有专用能力"。
           */
          collectionWrite: {
            creatable: true,
            removable: true,
            requiredPropertyIds: [
              `${ENTITY_TYPES.keyframe}.object_ref`,
              `${ENTITY_TYPES.keyframe}.property_path`,
              `${ENTITY_TYPES.keyframe}.time`,
              `${ENTITY_TYPES.keyframe}.value`,
            ],
            maxItemsPerChange: 128,
          },
        } : {}),
      },
      properties: propertiesByEntity[entityType],
      provider: new CameraStageReflectionProvider(entityType, readRevision),
    }
  })
}

export { ENTITY_TYPES as CAMERA_STAGE_ENTITY_TYPES }
