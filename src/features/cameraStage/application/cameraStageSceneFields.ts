import { z } from 'zod'

import {
  fieldWriterTable,
  type ApplicationFieldDefinition,
  type ApplicationPropertyDescriptor,
  type ApplicationPropertyMutation,
  type ApplicationPropertyValue,
  type ApplicationRef,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import type { StageSceneSettings, StageVec3 } from '../domain/sceneTypes'
import type { CameraStageProjectSnapshot } from '../projects/cameraStageProjectService'
import type { useCameraStageStore } from '../store/cameraStageStore'

/*
 * 三维场景 28 条属性（外观 25 + 时间轴 3）的统一定义——1.1 统一字段定义机制的首个试点。
 *
 * 迁移前这 28 条要碰 3 个文件、4 个位置（描述符 / 读取 / 写入 / 账本），场景外观 24 项
 * 当初就是这样只漏了描述符和读取两处、界面能改助手却完全看不见。现在每条只在这里出现一次，
 * 四个消费方（cameraStageReflection.ts / cameraStageWriterTables.ts / cameraStageStoreLedger.ts）
 * 从这张表派生，漏一条就是整条从三处一起消失，会被 storeActionCoverage 门禁当场抓到。
 */

type CameraStageState = ReturnType<typeof useCameraStageStore.getState>

const SCENE_ENTITY_TYPE = 'camera_stage.scene' as const
const CAMERA_ENTITY_TYPE = 'camera_stage.camera' as const
const SCENE_REVISION_SCOPE = 'toolbox' as const

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function sceneDescriptor(
  suffix: string,
  title: string,
  value: ApplicationPropertyValue,
  options: {
    unit?: string
    nullable?: boolean
    relation?: ApplicationPropertyDescriptor['relation']
  } = {},
): ApplicationPropertyDescriptor {
  const id = `${SCENE_ENTITY_TYPE}.${suffix}`
  return {
    id,
    entityType: SCENE_ENTITY_TYPE,
    version: 1,
    title,
    description: `三维${title}的稳定控制属性。`,
    value,
    ...(options.unit ? { unit: options.unit } : {}),
    nullable: options.nullable ?? false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['camera_stage:read'], write: ['camera_stage:write'] },
    revisionScopes: [SCENE_REVISION_SCOPE],
    schemaRef: {
      catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
      kind: 'property',
      id,
      version: 1,
      digest: digest(`property:${id}`),
    },
    ...(options.relation ? { relation: options.relation } : {}),
  }
}

/** 一条属性的值编解码：怎么从 JSON 解析出领域值、怎么把领域值编回 JSON。 */
interface ValueCodec<T> {
  readonly value: ApplicationPropertyValue
  parse(raw: JsonValue | undefined): T
  encode(value: T): JsonValue
}

const colorCodec: ValueCodec<string> = {
  value: { kind: 'color', format: 'hex' },
  parse: (raw) => z.string().parse(raw),
  encode: (value) => value,
}
const booleanCodec: ValueCodec<boolean> = {
  value: { kind: 'boolean' },
  parse: (raw) => z.boolean().parse(raw),
  encode: (value) => value,
}
function numberCodec(hardRange?: { min?: number; max?: number }): ValueCodec<number> {
  return { value: { kind: 'number', hardRange }, parse: (raw) => z.number().parse(raw), encode: (value) => value }
}
function integerCodec(hardRange?: { min?: number; max?: number }): ValueCodec<number> {
  return { value: { kind: 'integer', hardRange }, parse: (raw) => z.number().parse(raw), encode: (value) => value }
}
function enumCodec<T extends string>(values: readonly T[], labels: Record<T, string>): ValueCodec<T> {
  return {
    value: { kind: 'enum', values: values.map((value) => ({ value, label: labels[value] })) },
    parse: (raw) => z.enum(values as [T, ...T[]]).parse(raw),
    encode: (value) => value,
  }
}
function vector3Codec(unit?: string): ValueCodec<StageVec3> {
  return {
    value: unit ? { kind: 'vector3', unit } : { kind: 'vector3' },
    parse: (raw) => z.object({ x: z.number(), y: z.number(), z: z.number() }).strict().parse(raw),
    encode: (value) => ({ x: value.x, y: value.y, z: value.z }),
  }
}

/**
 * 每条声明只写一次：标题、值类型、从哪读、怎么写、对应哪个界面动作。
 *
 * `TAction` 特意不标注、靠 TS 从 `storeAction` 的字符串字面量参数推导——这样账本侧
 * `fieldLedgerEntries()` 才能拿到字面量 key 联合，保住 `Record<ActionName, …>` 的
 * 编译期完整性检查。调用处一旦给 `storeAction` 显式标注成 `string` 就会破坏这一点。
 */
function sceneField<TSource, T, TAction extends string>(
  suffix: string,
  title: string,
  codec: ValueCodec<T>,
  options: {
    read: (source: TSource) => T
    write: (store: CameraStageState, value: T) => void
    storeAction: TAction
    unit?: string
    nullable?: boolean
  },
): ApplicationFieldDefinition<TSource, CameraStageState, TAction> {
  return {
    propertyId: `${SCENE_ENTITY_TYPE}.${suffix}`,
    descriptor: sceneDescriptor(suffix, title, codec.value, { unit: options.unit, nullable: options.nullable }),
    read: (source) => codec.encode(options.read(source)),
    writer: { write: (draft, mutation) => { options.write(draft, codec.parse(mutation.value)) } },
    storeActions: [options.storeAction],
  }
}

/**
 * 固定 `TSource = StageSceneSettings` 的薄封装：不这样固定的话，`sceneField()` 里
 * 未标注类型的 `read: (s) => …` 会因为没有外部上下文可推导 TSource 而退化成 `unknown`。
 */
function appearanceField<T, TAction extends string>(
  suffix: string,
  title: string,
  codec: ValueCodec<T>,
  options: {
    read: (settings: StageSceneSettings) => T
    write: (store: CameraStageState, value: T) => void
    storeAction: TAction
    unit?: string
    nullable?: boolean
  },
): ApplicationFieldDefinition<StageSceneSettings, CameraStageState, TAction> {
  return sceneField<StageSceneSettings, T, TAction>(suffix, title, codec, options)
}

/** 固定 `TSource = CameraStageProjectSnapshot` 的薄封装，原因同上。 */
function timelineField<T, TAction extends string>(
  suffix: string,
  title: string,
  codec: ValueCodec<T>,
  options: {
    read: (snapshot: CameraStageProjectSnapshot) => T
    write: (store: CameraStageState, value: T) => void
    storeAction: TAction
    unit?: string
    nullable?: boolean
  },
): ApplicationFieldDefinition<CameraStageProjectSnapshot, CameraStageState, TAction> {
  return sceneField<CameraStageProjectSnapshot, T, TAction>(suffix, title, codec, options)
}

/*
 * 场景外观 25 项：读取源是 `StageSceneSettings`，与 `sceneAppearanceProperties()` 的入参一致。
 * 特意不给数组标注宽泛的 `ApplicationFieldDefinition<...>[]` 类型——那会把每个字段的
 * `TAction` 字面量提前拍扁成 `string`，账本侧的编译期完整性检查就没了意义。让 TS 直接
 * 从下面这些 `sceneField()` 调用推出联合类型。
 */
export const SCENE_APPEARANCE_FIELDS = [
  appearanceField('sky_color', '天空颜色', colorCodec, {
    read: (s) => s.sky.color, write: (store, v) => store.setSceneSkyColor(v), storeAction: 'setSceneSkyColor',
  }),
  appearanceField('ground_color', '地面颜色', colorCodec, {
    read: (s) => s.ground.color, write: (store, v) => store.setSceneGroundColor(v), storeAction: 'setSceneGroundColor',
  }),
  appearanceField('ground_pattern', '地面图案', enumCodec(['none', 'grid', 'checker'] as const, { none: '纯色', grid: '网格', checker: '棋盘' }), {
    read: (s) => s.ground.pattern, write: (store, v) => store.setSceneGroundPattern(v), storeAction: 'setSceneGroundPattern',
  }),
  appearanceField('ground_density', '地面图案密度', numberCodec({ min: 0, max: 1000 }), {
    read: (s) => s.ground.density, write: (store, v) => store.setSceneGroundDensity(v), storeAction: 'setSceneGroundDensity',
  }),
  appearanceField('ground_grid_line_color', '网格线颜色', colorCodec, {
    read: (s) => s.ground.gridLineColor, write: (store, v) => store.setSceneGroundGridLineColor(v), storeAction: 'setSceneGroundGridLineColor',
  }),
  appearanceField('ground_grid_line_thickness', '网格线粗细', numberCodec({ min: 0, max: 100 }), {
    read: (s) => s.ground.gridLineThickness, write: (store, v) => store.setSceneGroundGridLineThickness(v), storeAction: 'setSceneGroundGridLineThickness',
  }),
  appearanceField('ground_checker_light_color', '棋盘浅色', colorCodec, {
    read: (s) => s.ground.checkerLightColor, write: (store, v) => store.setSceneGroundCheckerLightColor(v), storeAction: 'setSceneGroundCheckerLightColor',
  }),
  appearanceField('ground_checker_dark_color', '棋盘深色', colorCodec, {
    read: (s) => s.ground.checkerDarkColor, write: (store, v) => store.setSceneGroundCheckerDarkColor(v), storeAction: 'setSceneGroundCheckerDarkColor',
  }),
  appearanceField('sunlight_enabled', '阳光开启', booleanCodec, {
    read: (s) => s.sunlight.enabled, write: (store, v) => store.setSceneSunlightEnabled(v), storeAction: 'setSceneSunlightEnabled',
  }),
  appearanceField('sunlight_intensity', '阳光强度', numberCodec({ min: 0, max: 100 }), {
    read: (s) => s.sunlight.intensity, write: (store, v) => store.setSceneSunlightIntensity(v), storeAction: 'setSceneSunlightIntensity',
  }),
  appearanceField('sunlight_time_of_day', '一天中的时间', numberCodec({ min: 0, max: 24 }), {
    read: (s) => s.sunlight.timeOfDay, write: (store, v) => store.setSceneSunlightTimeOfDay(v), storeAction: 'setSceneSunlightTimeOfDay', unit: 'hour',
  }),
  appearanceField('fog_enabled', '雾开启', booleanCodec, {
    read: (s) => s.fog.enabled, write: (store, v) => store.setSceneFogEnabled(v), storeAction: 'setSceneFogEnabled',
  }),
  appearanceField('fog_distance', '雾距离', numberCodec({ min: 0, max: 10_000 }), {
    read: (s) => s.fog.distance, write: (store, v) => store.setSceneFogDistance(v), storeAction: 'setSceneFogDistance', unit: 'scene_unit',
  }),
  appearanceField('show_name_labels', '显示名称标签', booleanCodec, {
    read: (s) => s.display.showNameLabels, write: (store, v) => store.setSceneShowNameLabels(v), storeAction: 'setSceneShowNameLabels',
  }),
  appearanceField('name_label_scale', '名称标签缩放', numberCodec({ min: 0, max: 100 }), {
    read: (s) => s.display.nameLabel.scale, write: (store, v) => store.setSceneNameLabelScale(v), storeAction: 'setSceneNameLabelScale',
  }),
  appearanceField('name_label_offset', '名称标签偏移', vector3Codec('scene_unit'), {
    read: (s) => s.display.nameLabel.offset, write: (store, v) => store.setSceneNameLabelOffset(v), storeAction: 'setSceneNameLabelOffset',
  }),
  appearanceField('name_label_text_color', '名称标签文字颜色', colorCodec, {
    read: (s) => s.display.nameLabel.textColor, write: (store, v) => store.setSceneNameLabelTextColor(v), storeAction: 'setSceneNameLabelTextColor',
  }),
  appearanceField('name_label_follow_object_color', '名称标签跟随对象颜色', booleanCodec, {
    read: (s) => s.display.nameLabel.followObjectColor, write: (store, v) => store.setSceneNameLabelFollowObjectColor(v), storeAction: 'setSceneNameLabelFollowObjectColor',
  }),
  appearanceField('name_label_background_color', '名称标签背景色', colorCodec, {
    read: (s) => s.display.nameLabel.backgroundColor, write: (store, v) => store.setSceneNameLabelBackgroundColor(v), storeAction: 'setSceneNameLabelBackgroundColor',
  }),
  appearanceField('name_label_background_opacity', '名称标签背景不透明度', numberCodec({ min: 0, max: 1 }), {
    read: (s) => s.display.nameLabel.backgroundOpacity, write: (store, v) => store.setSceneNameLabelBackgroundOpacity(v), storeAction: 'setSceneNameLabelBackgroundOpacity',
  }),
  appearanceField('name_label_shadow_color', '名称标签阴影颜色', colorCodec, {
    read: (s) => s.display.nameLabel.shadowColor, write: (store, v) => store.setSceneNameLabelShadowColor(v), storeAction: 'setSceneNameLabelShadowColor',
  }),
  appearanceField('name_label_shadow_opacity', '名称标签阴影不透明度', numberCodec({ min: 0, max: 1 }), {
    read: (s) => s.display.nameLabel.shadowOpacity, write: (store, v) => store.setSceneNameLabelShadowOpacity(v), storeAction: 'setSceneNameLabelShadowOpacity',
  }),
  appearanceField('name_label_shadow_blur', '名称标签阴影模糊', numberCodec({ min: 0, max: 100 }), {
    read: (s) => s.display.nameLabel.shadowBlur, write: (store, v) => store.setSceneNameLabelShadowBlur(v), storeAction: 'setSceneNameLabelShadowBlur',
  }),
  appearanceField('name_label_shadow_distance', '名称标签阴影距离', numberCodec({ min: 0, max: 100 }), {
    read: (s) => s.display.nameLabel.shadowDistance, write: (store, v) => store.setSceneNameLabelShadowDistance(v), storeAction: 'setSceneNameLabelShadowDistance',
  }),
  appearanceField('name_label_shadow_angle', '名称标签阴影角度', numberCodec({ min: -360, max: 360 }), {
    read: (s) => s.display.nameLabel.shadowAngle, write: (store, v) => store.setSceneNameLabelShadowAngle(v), storeAction: 'setSceneNameLabelShadowAngle', unit: 'degree',
  }),
]

/*
 * 时间轴 3 项：读取源是整份工程快照（duration/fps 在 animation 下，active_camera_ref 要拼装 ref）。
 * 同样不标注数组类型，理由见上——`active_camera_ref` 那条不走 sceneField()（encode 需要
 * snapshot.id 拼 ref，与其余字段的 codec 形状不同），`storeActions` 用 `as const` 保住字面量。
 */
export const SCENE_TIMELINE_FIELDS = [
  {
    propertyId: `${SCENE_ENTITY_TYPE}.active_camera_ref`,
    descriptor: sceneDescriptor('active_camera_ref', '活动摄像机', { kind: 'ref', refKinds: [CAMERA_ENTITY_TYPE] }, {
      nullable: true,
      relation: { targetEntityTypes: [CAMERA_ENTITY_TYPE], cardinality: 'optional' },
    }),
    read: (snapshot: CameraStageProjectSnapshot): JsonValue => (snapshot.activeCameraId
      ? ({ kind: CAMERA_ENTITY_TYPE, id: `${snapshot.id}:${snapshot.activeCameraId}` } satisfies ApplicationRef)
      : null),
    writer: {
      write: (draft: CameraStageState, mutation: ApplicationPropertyMutation) => {
        const value = mutation.value
        const id = value === null || value === undefined
          ? null
          : (z.object({ kind: z.string(), id: z.string() }).passthrough().parse(value).id.split(':').pop() ?? null)
        draft.setActiveCameraId(id)
      },
    },
    storeActions: ['setActiveCameraId'] as const,
  },
  timelineField('duration', '动画时长', numberCodec({ min: 0, max: 3600 }), {
    read: (snapshot) => snapshot.animation.duration, write: (store, v) => store.setDuration(v), storeAction: 'setDuration', unit: 'second',
  }),
  timelineField('fps', '帧率', integerCodec({ min: 1, max: 240 }), {
    read: (snapshot) => snapshot.animation.fps, write: (store, v) => store.setFps(v), storeAction: 'setFps', unit: 'fps',
  }),
]

export const CAMERA_STAGE_SCENE_WRITERS = {
  ...fieldWriterTable(SCENE_APPEARANCE_FIELDS),
  ...fieldWriterTable(SCENE_TIMELINE_FIELDS),
}
