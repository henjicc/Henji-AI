import { z } from 'zod'

import { fieldWriterTable, type ApplicationPropertyMutation, type ApplicationRef, type JsonValue } from '@/core/application-control'

import { STAGE_RENDER_STYLE_LABELS, STAGE_RENDER_STYLE_VALUES } from '../domain/renderStyles'
import type { StageSceneSettings } from '../domain/sceneTypes'
import type { CameraStageProjectSnapshot } from '../projects/cameraStageProjectService'
import type { useCameraStageStore } from '../store/cameraStageStore'
import {
  booleanCodec, colorCodec, enumCodec, numberCodec, stageDescriptor, stageField, vector3Codec,
  type ValueCodec,
} from './cameraStageFieldShared'

/*
 * 三维场景属性（外观 26 + 活动摄像机）的统一定义。
 *
 * 迁移前这 28 条要碰 3 个文件、4 个位置（描述符 / 读取 / 写入 / 账本），场景外观 24 项
 * 当初就是这样只漏了描述符和读取两处、界面能改助手却完全看不见。现在每条只在这里出现一次，
 * 四个消费方（cameraStageReflection.ts / cameraStageWriterTables.ts / cameraStageStoreLedger.ts）
 * 从这张表派生，漏一条就是整条从三处一起消失，会被 storeActionCoverage 门禁当场抓到。
 *
 * 通用的描述符/编解码/字段构造器收在 cameraStageFieldShared.ts，供本文件与其余实体的
 * Fields 文件（1.3 迁移的 object/camera/project/stateKeyframe/keyframe/playback）共用。
 */

type CameraStageState = ReturnType<typeof useCameraStageStore.getState>

const SCENE_ENTITY_TYPE = 'camera_stage.scene' as const
const CAMERA_ENTITY_TYPE = 'camera_stage.camera' as const

/**
 * 固定 `TSource = StageSceneSettings` 的薄封装：不这样固定的话，`stageField()` 里
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
) {
  const { storeAction, ...rest } = options
  return stageField<StageSceneSettings, CameraStageState, T, TAction>(
    SCENE_ENTITY_TYPE, suffix, title, codec, { ...rest, storeActions: [storeAction] },
  )
}

/*
 * 场景外观 26 项：读取源是 `StageSceneSettings`，与 `sceneAppearanceProperties()` 的入参一致。
 * 特意不给数组标注宽泛的 `ApplicationFieldDefinition<...>[]` 类型——那会把每个字段的
 * `TAction` 字面量提前拍扁成 `string`，账本侧的编译期完整性检查就没了意义。让 TS 直接
 * 从下面这些 `appearanceField()` 调用推出联合类型。
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
  appearanceField('render_style', '渲染方式', enumCodec(STAGE_RENDER_STYLE_VALUES, STAGE_RENDER_STYLE_LABELS), {
    read: (s) => s.render.style, write: (store, v) => store.setSceneRenderStyle(v), storeAction: 'setSceneRenderStyle',
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
 * 活动摄像机引用需要工程 id 拼装稳定 ref，因此直接定义读写函数。
 */
export const SCENE_TIMELINE_FIELDS = [
  {
    propertyId: `${SCENE_ENTITY_TYPE}.active_camera_ref`,
    descriptor: stageDescriptor(SCENE_ENTITY_TYPE, 'active_camera_ref', '活动摄像机', { kind: 'ref', refKinds: [CAMERA_ENTITY_TYPE] }, {
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
]

export const CAMERA_STAGE_SCENE_WRITERS = {
  ...fieldWriterTable(SCENE_APPEARANCE_FIELDS),
  ...fieldWriterTable(SCENE_TIMELINE_FIELDS),
}
