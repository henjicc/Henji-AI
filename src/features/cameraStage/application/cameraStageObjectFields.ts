import { z } from 'zod'

import { fieldWriterTable, type ApplicationRef, type ApplicationPropertyMutation, type ApplicationPropertyValue, type JsonValue } from '@/core/application-control'
import { CAMERA_STAGE_NAME_MAX_LENGTH } from '@/core/assistant/capabilities/cameraStageCapabilitySchemas'

import { getAnimatablePropByPath, listAnimatablePropertyPaths } from '../domain/animatableProps'
import type { StageAnimatableValueType, StageKeyframeValue } from '../domain/animationTypes'
import { POSE_PRESETS } from '../domain/posePresets.gen'
import type { StageObject, StageTransform } from '../domain/sceneTypes'
import type { CameraStageObjectUpdate } from './cameraStageApplicationService'
import {
  booleanCodec, colorCodec, enumCodec, nameCodec, nullableEnumCodec, numberCodec, refIdCodec, stageDescriptor,
  stageField, vector3Codec, type ValueCodec,
} from './cameraStageFieldShared'

/*
 * 三维对象与摄像机 16 条建模属性（object 7 + camera 9）的统一定义——1.3 迁移；2.4 又加了
 * 63 条逐分量动画属性（object 55 + camera 8）与 1 条姿态预设。
 *
 * 建模属性写入目标是累积器 `CameraStageObjectDraft` 的 `update` / `transform` /
 * `transformTouched` / `current`：变换三轴要先累积进同一个 transform 再一次性提交，
 * 逐轴提交会在时间轴上打出三个独立改动；`current` 供画幅与注视点互读。这条路径最终落到
 * `cameraStageApplicationService.updateObject()`——**建模语义**，一律同步全部镜头卡、
 * 从不自动打点。
 *
 * 动画属性（`animatable.*` 与 `pose_preset`）写目标是同一个 draft 上另外两个累加字段
 * （`animatable` / `posePresetId`），最终落到 `updateAnimatableProperties()` /
 * `applyObjectPosePreset()`——**动画编辑语义**，只在专业模式下可写，且只在轨道已有关键帧时
 * 才打点。两条语义故意分流到不同的 draft 字段、不同的落地方法，混用会重新打开重要记录 002
 * 描述的陷阱（静态值刚写完，播放头一动就被插值结果覆盖回去）；`CameraStageMutationExecutor`
 * 在提交前会拒绝同一批写入里混用两种语义。
 *
 * `updateObject` / `updateObjectAcrossShots` 两个 store 动作一次改好几条属性——
 * `fieldLedgerEntries()` 按声明顺序把它们累进同一条账本绑定（见 fieldDefinition.ts 的账本
 * 累积逻辑，这正是促成那处修复的实例）。
 */

const OBJECT_ENTITY_TYPE = 'camera_stage.object' as const
const CAMERA_ENTITY_TYPE = 'camera_stage.camera' as const

/**
 * 变换三轴要累积进同一个 transform 再一次性提交，`current` 供画幅与注视点互读。
 * `animatable` / `posePresetId` 是动画编辑语义的独立累加字段，与 `update` 互斥使用。
 */
export interface CameraStageObjectDraft {
  readonly current: StageObject
  readonly update: CameraStageObjectUpdate
  transform: StageTransform
  transformTouched: boolean
  animatable: Record<string, StageKeyframeValue>
  posePresetId?: string
}

function touchTransform(draft: CameraStageObjectDraft): void {
  draft.transformTouched = true
}

type NonCameraObject = Exclude<StageObject, { type: 'camera' }>
type CameraObject = Extract<StageObject, { type: 'camera' }>
interface CameraFieldSource {
  readonly projectId: string
  readonly camera: CameraObject
}

/** 固定 `TSource = Exclude<StageObject,{type:'camera'}>`，原因见 cameraStageSceneFields.ts 里同名手法。 */
function objectField<T, TAction extends string>(
  suffix: string,
  title: string,
  codec: ValueCodec<T>,
  options: {
    read: (object: NonCameraObject) => T
    write: (draft: CameraStageObjectDraft, value: T) => void
    storeActions: readonly TAction[]
    unit?: string
    nullable?: boolean
  },
) {
  return stageField<NonCameraObject, CameraStageObjectDraft, T, TAction>(OBJECT_ENTITY_TYPE, suffix, title, codec, options)
}

/** 固定 `TSource = { projectId, camera }`：`look_at_object_ref` 的读取要把 objectId 拼成 ref，离不开 projectId。 */
function cameraField<T, TAction extends string>(
  suffix: string,
  title: string,
  codec: ValueCodec<T>,
  options: {
    read: (source: CameraFieldSource) => T
    write: (draft: CameraStageObjectDraft, value: T) => void
    storeActions: readonly TAction[]
    unit?: string
    nullable?: boolean
  },
) {
  return stageField<CameraFieldSource, CameraStageObjectDraft, T, TAction>(CAMERA_ENTITY_TYPE, suffix, title, codec, options)
}

/*
 * 逐分量动画属性（2.4）：63 条由这一个工厂生成，不逐条手写。id 生成规则与反射层曾经的
 * 只读版本完全一致（只替换路径里的大写字母，不动点号），避免属性 id 迁移改名。
 *
 * 写入落进 `draft.animatable[path]`，只是累加、不直接调 store——真正的 store 调用（按
 * transform 分组 / 关节合并 / color·fov 直写）在 `cameraStageApplicationService
 * .updateAnimatableProperties()` 里，因为要在提交前判断专业/简易模式、且要把同一批里的
 * 多个分量按 store 方法的参数形状分组，不是纯粹的字段级累加能做完的事。
 */
const ANIMATABLE_DESCRIPTION = '逐分量动画属性：该轨道此刻没有关键帧时，写入是普通静态值；'
  + '该轨道已有关键帧时，写入等价于在当前播放时间点新建或更新一个关键帧（与人在界面上拖动手柄时的'
  + '自动打点行为一致）。只在专业模式下可写；简易模式请改用 camera_stage.shot.capture_object_refs，'
  + '或先用 bake_camera_stage_to_pro 转到专业模式。'

/** 与反射层曾经的只读版本保持完全一致的 id 生成规则，避免属性 id 迁移改名。 */
function animatablePropertyPathId(path: string): string {
  return path.replace(/[A-Z]/g, (character) => `_${character.toLocaleLowerCase()}`)
}

function animatableValueSchema(valueType: StageAnimatableValueType): ApplicationPropertyValue {
  return valueType === 'color' ? { kind: 'color', format: 'hex' } : { kind: 'number' }
}

function parseAnimatableValue(valueType: StageAnimatableValueType, raw: JsonValue | undefined): StageKeyframeValue {
  return valueType === 'color' ? z.string().parse(raw) : z.number().parse(raw)
}

type AnimatableStoreAction = 'updateTransform' | 'updateObject' | 'updatePoseJoint'

function animatableStoreActions(path: string): readonly AnimatableStoreAction[] {
  if (path.startsWith('transform.')) return ['updateTransform']
  if (path === 'color' || path === 'fov') return ['updateObject']
  if (path.startsWith('pose.joints.')) return ['updatePoseJoint']
  return []
}

function animatableField<TSource>(
  entityType: string,
  path: string,
  getObject: (source: TSource) => StageObject,
) {
  const descriptor = getAnimatablePropByPath(path)
  if (!descriptor) throw new Error(`ANIMATABLE_PATH_UNKNOWN:${path}`)
  const suffix = `animatable.${animatablePropertyPathId(path)}`
  return {
    propertyId: `${entityType}.${suffix}`,
    descriptor: stageDescriptor(entityType, suffix, `可动画属性 ${descriptor.label}`, animatableValueSchema(descriptor.valueType), {
      description: ANIMATABLE_DESCRIPTION,
    }),
    read: (source: TSource): JsonValue => descriptor.getValue(getObject(source)) as JsonValue,
    writer: {
      write: (draft: CameraStageObjectDraft, mutation: ApplicationPropertyMutation) => {
        draft.animatable[path] = parseAnimatableValue(descriptor.valueType, mutation.value)
      },
    },
    storeActions: animatableStoreActions(path),
  }
}

const OBJECT_ANIMATABLE_PATHS = listAnimatablePropertyPaths().filter((path) => path !== 'fov')
const CAMERA_ANIMATABLE_PATHS = listAnimatablePropertyPaths().filter((path) => (
  path.startsWith('transform.position.') || path.startsWith('transform.rotation.') || path === 'color' || path === 'fov'
))

export const OBJECT_ANIMATABLE_FIELDS = OBJECT_ANIMATABLE_PATHS
  .map((path) => animatableField<NonCameraObject>(OBJECT_ENTITY_TYPE, path, (object) => object))
export const CAMERA_ANIMATABLE_FIELDS = CAMERA_ANIMATABLE_PATHS
  .map((path) => animatableField<CameraFieldSource>(CAMERA_ENTITY_TYPE, path, ({ camera }) => camera))

/** 供反射层按对象实际类型过滤"这条动画属性对这个对象是否可用"（如姿态关节只对角色可用）。 */
export const OBJECT_ANIMATABLE_PATH_BY_PROPERTY_ID = new Map(
  OBJECT_ANIMATABLE_FIELDS.map((field, index) => [field.propertyId, OBJECT_ANIMATABLE_PATHS[index]]),
)
export const CAMERA_ANIMATABLE_PATH_BY_PROPERTY_ID = new Map(
  CAMERA_ANIMATABLE_FIELDS.map((field, index) => [field.propertyId, CAMERA_ANIMATABLE_PATHS[index]]),
)

/**
 * 一键套用预设姿势（2.4）：整体替换角色姿态，与逐分量写入同属"动画编辑"语义，落进
 * `draft.posePresetId` 单独累加，由 `applyObjectPosePreset()` 落地。没有持久化的
 * "当前预设"概念（姿态只是一堆关节偏移，不会记住是从哪个预设来的），读取始终为空；
 * 写入是否生效可通过读取 animatable.pose_joints_* 或观察场景验证。
 */
const POSE_PRESET_FIELD = {
  propertyId: `${OBJECT_ENTITY_TYPE}.pose_preset`,
  descriptor: stageDescriptor(OBJECT_ENTITY_TYPE, 'pose_preset', '姿态预设', {
    kind: 'enum',
    values: POSE_PRESETS.map((preset) => ({ value: preset.id, label: preset.name })),
  }, {
    nullable: true,
    description: '一键套用预设姿势，整体替换角色当前姿态（对已有关键帧轨道的关节自动打点）。'
      + '只在专业模式下可写；没有持久化的"当前预设"概念，读取始终为空。',
  }),
  read: (): JsonValue => null,
  writer: {
    write: (draft: CameraStageObjectDraft, mutation: ApplicationPropertyMutation) => {
      draft.posePresetId = z.string().min(1).parse(mutation.value)
    },
  },
  storeActions: ['applyPosePreset'] as const,
}

const CHARACTER_VARIANT_LABELS = { standard: 'standard', strong: 'strong', slim: 'slim', child: 'child' } as const
const OBJECT_IDENTITY_ACTIONS = ['updateObject', 'updateObjectAcrossShots'] as const

/*
 * object 7 项：`name`/`visible`/`color`/`character_variant` 由 `updateObject` 与
 * `updateObjectAcrossShots` 两个 store 动作共用；变换三轴由 `updateTransform` 独占。
 * 数组不标注宽泛类型，理由同 cameraStageSceneFields.ts：会拍扁 TAction 字面量。
 */
export const OBJECT_FIELDS = [
  objectField('name', '对象名称', nameCodec(CAMERA_STAGE_NAME_MAX_LENGTH), {
    read: (o) => o.name, write: (draft, v) => { draft.update.name = v }, storeActions: OBJECT_IDENTITY_ACTIONS,
  }),
  objectField('visible', '可见性', booleanCodec, {
    read: (o) => o.visible, write: (draft, v) => { draft.update.visible = v }, storeActions: OBJECT_IDENTITY_ACTIONS,
  }),
  objectField('color', '材质颜色', colorCodec, {
    read: (o) => o.color, write: (draft, v) => { draft.update.color = v }, storeActions: OBJECT_IDENTITY_ACTIONS,
  }),
  objectField('character_variant', '角色体型', nullableEnumCodec(['standard', 'strong', 'slim', 'child'] as const, CHARACTER_VARIANT_LABELS), {
    read: (o) => (o.type === 'character' ? o.variant : null),
    write: (draft, v) => {
      if (v === null) throw new Error('INVALID_INPUT')
      draft.update.variant = v
    },
    storeActions: OBJECT_IDENTITY_ACTIONS,
    nullable: true,
  }),
  objectField('transform.position', '位置', vector3Codec('scene_unit'), {
    read: (o) => o.transform.position,
    write: (draft, v) => { draft.transform.position = v; touchTransform(draft) },
    storeActions: ['updateTransform'] as const,
  }),
  objectField('transform.rotation', '旋转', vector3Codec('degree'), {
    read: (o) => o.transform.rotation,
    write: (draft, v) => { draft.transform.rotation = v; touchTransform(draft) },
    storeActions: ['updateTransform'] as const,
  }),
  objectField('transform.scale', '缩放', vector3Codec('scene_unit'), {
    read: (o) => o.transform.scale,
    write: (draft, v) => { draft.transform.scale = v; touchTransform(draft) },
    storeActions: ['updateTransform'] as const,
  }),
  ...OBJECT_ANIMATABLE_FIELDS,
  POSE_PRESET_FIELD,
]

/*
 * camera 9 项。`look_at_object_ref` 的 encode 要拼 `{projectId}:{objectId}` 形式的 ref，
 * 不走通用 codec（codec 只知道值本身，不知道 projectId），直接手写字段对象。
 * 只有 transform.position / transform.rotation / look_at_target 被 `updateCameraView`
 * 引用——这是迁移前账本就有的既有事实（camera.name/visible/fov 等目前没有对应的界面
 * 动作绑定），迁移只原样保留，不在这里扩大覆盖面。
 */
export const CAMERA_FIELDS = [
  cameraField('name', '摄像机名称', nameCodec(CAMERA_STAGE_NAME_MAX_LENGTH), {
    read: ({ camera }) => camera.name, write: (draft, v) => { draft.update.name = v }, storeActions: [] as const,
  }),
  cameraField('visible', '可见性', booleanCodec, {
    read: ({ camera }) => camera.visible, write: (draft, v) => { draft.update.visible = v }, storeActions: [] as const,
  }),
  cameraField('transform.position', '位置', vector3Codec('scene_unit'), {
    read: ({ camera }) => camera.transform.position,
    write: (draft, v) => { draft.transform.position = v; touchTransform(draft) },
    storeActions: ['updateCameraView'] as const,
  }),
  cameraField('transform.rotation', '旋转', vector3Codec('degree'), {
    read: ({ camera }) => camera.transform.rotation,
    write: (draft, v) => { draft.transform.rotation = v; touchTransform(draft) },
    storeActions: ['updateCameraView'] as const,
  }),
  cameraField('fov', '视野角', numberCodec({ min: 1, max: 179 }, { min: 15, max: 100 }), {
    read: ({ camera }) => camera.fov, write: (draft, v) => { draft.update.fov = v }, unit: 'degree', storeActions: [] as const,
  }),
  cameraField('look_at_target', '注视点', vector3Codec('scene_unit'), {
    read: ({ camera }) => (camera.lookAt.mode === 'manual' ? camera.lookAt.target : camera.lookAt.fallbackTarget),
    write: (draft, v) => { draft.update.lookAt = { mode: 'manual', target: v } },
    storeActions: ['updateCameraView'] as const,
  }),
  cameraField('aspect_ratio_preset', '画幅预设', enumCodec(['16:9', '4:3', '1:1', '9:16', 'custom'] as const, {
    '16:9': '16:9', '4:3': '4:3', '1:1': '1:1', '9:16': '9:16', custom: 'custom',
  }), {
    read: ({ camera }) => camera.aspectRatio.preset,
    write: (draft, v) => {
      if (draft.current.type !== 'camera') throw new Error('OBJECT_TYPE_MISMATCH')
      draft.update.aspectRatio = { preset: v, ratio: draft.update.aspectRatio?.ratio ?? draft.current.aspectRatio.ratio }
    },
    storeActions: [] as const,
  }),
  cameraField('aspect_ratio', '画幅比例', numberCodec({ min: 0.1, max: 10 }), {
    read: ({ camera }) => camera.aspectRatio.ratio,
    write: (draft, v) => {
      if (draft.current.type !== 'camera') throw new Error('OBJECT_TYPE_MISMATCH')
      draft.update.aspectRatio = { preset: draft.update.aspectRatio?.preset ?? draft.current.aspectRatio.preset, ratio: v }
    },
    storeActions: [] as const,
  }),
  {
    propertyId: `${CAMERA_ENTITY_TYPE}.look_at_object_ref`,
    descriptor: stageDescriptor(CAMERA_ENTITY_TYPE, 'look_at_object_ref', '注视对象', { kind: 'ref', refKinds: [OBJECT_ENTITY_TYPE] }, {
      nullable: true,
      relation: { targetEntityTypes: [OBJECT_ENTITY_TYPE], cardinality: 'optional' },
    }),
    read: ({ projectId, camera }: CameraFieldSource): JsonValue => (camera.lookAt.mode === 'object'
      ? ({ kind: OBJECT_ENTITY_TYPE, id: `${projectId}:${camera.lookAt.objectId}` } satisfies ApplicationRef)
      : null),
    writer: {
      write: (draft: CameraStageObjectDraft, mutation: ApplicationPropertyMutation) => {
        const id = refIdCodec([OBJECT_ENTITY_TYPE]).parse(mutation.value)
        if (!id || draft.current.type !== 'camera') throw new Error('INVALID_REFERENCE')
        draft.update.lookAt = {
          mode: 'object',
          objectId: id,
          fallbackTarget: draft.current.lookAt.mode === 'manual' ? draft.current.lookAt.target : draft.current.lookAt.fallbackTarget,
        }
      },
    },
    storeActions: [] as const,
  },
  ...CAMERA_ANIMATABLE_FIELDS,
]

export const CAMERA_STAGE_OBJECT_WRITERS = fieldWriterTable(OBJECT_FIELDS)
export const CAMERA_STAGE_CAMERA_WRITERS = fieldWriterTable(CAMERA_FIELDS)
