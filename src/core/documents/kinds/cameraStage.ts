import { persistedStageSettingsSchema } from '../../persistence/businessSchemas'
import { z } from 'zod'

import { henjiExtension, henjiLegacyExtensions } from '../../fileExtensions'
import type { DocumentKindDescriptor } from './registry'

/*
 * 镜头参考（`.hjstg`，3.2 镜头参考接入，工具接入的样板）。
 * 可以独立存放（作品目录“镜头参考”文件夹），也可以放进项目。
 *
 * 内容 = 三维场景的持久部分（内存形态，位置都是绝对路径）：
 * - objects：场景对象（几何体、角色、摄像机），每项至少有 id / type / name；
 * - activeCameraId：当前取景摄像机；
 * - sceneSettings：地面、天空（含全景环境图路径）、阳光、雾、渲染方式、标签显示；
 * - stateKeyframes：状态关键帧，唯一可编辑的时间轴真相源（派生动画只在运行时编译，不进文件）；
 * - sets：生成过的布景（id、名称、补齐后的生成参数）。成员是 objects 里的普通对象，用 setId 指回布景，
 *   所以旧程序不认识布景也能照常显示和编辑这些对象。
 *
 * 这里只校验外层结构，对象、关键帧与场景设置的细节由工具读取时逐字段规范化
 * （`sceneFromDocumentContent`，与旧工程数据的读取规则相同）。嵌套对象一律保留未知字段：
 * 主进程保存时持久化的是 schema 解析结果，剥掉字段就等于丢数据。
 *
 * 本文件主进程与渲染层共用，只用相对导入（不依赖界面颜色令牌等渲染层模块），
 * 所以“空内容”是一份什么都没有的场景：工具打开空场景时自己补上默认摄像机与第一张状态关键帧。
 */

const stageObjectSchema = z.looseObject({
  id: z.string().min(1),
  type: z.enum(['primitive', 'character', 'camera']),
  name: z.string(),
})

const stateKeyframeSchema = z.looseObject({
  id: z.string().min(1),
})

const numbers = z.array(z.number())

/**
 * 布景的地面铺装与比例参照物（v3 起）：生成时算好的扁平数字数组，坐标为布景局部坐标（米）。
 * 每项占几个数见 STAGE_SET_DECOR_STRIDE：铺装 [中心 x, 中心 z, 宽, 深]，标线 [起点 x, 起点 z, 终点 x, 终点 z]，
 * 树 [x, z, 朝向, 缩放, 树种]，路灯 [x, z, 灯臂朝向, 杆高]，车辆 [x, z, 车头朝向, 车型, 颜色]。
 * 任意形状铺装 areas（v5 起，自然路网才有）每块写 [圈数, 第一圈点数, x, z…, 第二圈点数, …]，第一圈外轮廓、其余是洞。
 */
const stageSetDecorSchema = z.looseObject({
  surfaces: z.looseObject({ road: numbers, sidewalk: numbers, curb: numbers, median: numbers, lawn: numbers, plaza: numbers }),
  markings: z.looseObject({ laneDashed: numbers, edgeLine: numbers, centerLine: numbers, stopLine: numbers, crosswalk: numbers }),
  trees: numbers,
  lamps: numbers,
  vehicles: numbers,
  areas: z.looseObject({ sidewalk: numbers, median: numbers, lawn: numbers, water: numbers }).optional(),
})

const stageSetSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  params: z.looseObject({ preset: z.string().min(1) }),
  decor: stageSetDecorSchema.optional(),
})

type LooseRecord = Record<string, unknown>

/** v2 的楼高范围（米）换成楼层范围：按 3.2 米一层取整。 */
function floorsFromHeight(height: unknown, fallback: { min: number; max: number }): { min: number; max: number } {
  const range = height as { min?: unknown; max?: unknown } | undefined
  if (typeof range?.min !== 'number' || typeof range.max !== 'number') return fallback
  const min = Math.max(1, Math.round(range.min / 3.2))
  return { min, max: Math.max(min, Math.round(range.max / 3.2)) }
}

/**
 * 2 → 3：布景参数从“街区边长、街道宽、地块宽、楼高（米）”换成“城市风格、道路等级、楼层”。
 * 已生成的楼是普通对象，画面不变；换算后的参数只决定以后重新生成成什么样。
 * 旧布景没有装饰，参照物开关取默认的开，重新生成时补上。
 */
function migrateStageSetV2(set: LooseRecord): LooseRecord {
  const params = set.params as LooseRecord
  if (params.preset === 'city') {
    const { blockSize: _block, streetWidth: _street, lotSize: _lot, height, ...rest } = params
    return { ...set, params: { ...rest, style: 'grid', floors: floorsFromHeight(height, { min: 4, max: 40 }), props: true } }
  }
  if (params.preset === 'street') {
    const { streetWidth, lotWidth: _lot, buildingDepth: _depth, height, ...rest } = params
    const width = typeof streetWidth === 'number' ? streetWidth : 0
    const road = width >= 35 ? 'arterial' : width >= 22 ? 'collector' : 'local'
    return { ...set, params: { ...rest, road, floors: floorsFromHeight(height, { min: 3, max: 8 }), props: true } }
  }
  if (params.preset === 'plaza') {
    const { lotWidth: _lot, buildingDepth: _depth, height, ...rest } = params
    return { ...set, params: { ...rest, floors: floorsFromHeight(height, { min: 4, max: 10 }), props: true } }
  }
  return set
}

/**
 * 4 → 5：城市布景新增自然路网风格的三个参数（路网弯曲程度、河流、公园）。已有城市布景补上默认值，
 * 方格类风格不读它们，画面与重新生成的结果都不变。
 */
function migrateStageSetV4(set: LooseRecord): LooseRecord {
  const params = set.params as LooseRecord
  if (params.preset !== 'city') return set
  return { ...set, params: { curvature: 0.5, river: true, parks: true, ...params } }
}

export const cameraStageContentSchema = z.object({
  objects: z.array(stageObjectSchema),
  activeCameraId: z.string().nullable(),
  /** 场景级设置；缺字段或不合法时工具按默认值补齐。 */
  sceneSettings: persistedStageSettingsSchema,
  stateKeyframes: z.array(stateKeyframeSchema),
  sets: z.array(stageSetSchema),
})

export type CameraStageDocumentContent = z.infer<typeof cameraStageContentSchema>

/** 场景里引用了图片的唯一位置：天空的全景环境图。 */
function environmentImageOf(content: CameraStageDocumentContent): unknown {
  const sky = content.sceneSettings.sky
  return sky && typeof sky === 'object' ? (sky as Record<string, unknown>).environmentImageUrl : null
}

/**
 * 空内容：除了（最多）一台摄像机外没有任何对象，状态关键帧不超过一张，也没有全景环境图。
 * 新建后只是挪了挪摄像机、改了改天空颜色的草稿离开时直接删除，不询问。
 */
function isEmptyCameraStageContent(content: CameraStageDocumentContent): boolean {
  const cameras = content.objects.filter((object) => object.type === 'camera').length
  const others = content.objects.length - cameras
  const environmentImage = environmentImageOf(content)
  return others === 0
    && cameras <= 1
    && content.stateKeyframes.length <= 1
    && !(typeof environmentImage === 'string' && environmentImage.trim().length > 0)
}

export const cameraStageDocumentKind: DocumentKindDescriptor<CameraStageDocumentContent> = {
  id: 'camera_stage',
  extension: henjiExtension('camera_stage'),
  legacyExtensions: henjiLegacyExtensions('camera_stage'),
  standaloneFolderNames: { zh: '镜头参考', en: 'Camera Stages' },
  untitledNames: { zh: '未命名镜头参考', en: 'Untitled Camera Stage' },
  storage: 'json',
  // 版本 1 = 旧工程场景数据第 14 版的持久字段（去掉 schemaVersion，由外壳的 kindVersion 表达）。
  // 版本 2 = 新增布景列表 sets 与对象上可选的 setId；成员仍是普通对象，旧程序照常读写，最低可读版本不变。
  // 版本 3 = 布景按真实尺度生成：参数换成城市风格、道路等级与楼层，并新增可选的装饰 decor。
  //   版本 2 的程序会按旧字段重新生成而算出无效布景，所以最低可读版本提高到 3。
  // 版本 4 = 雾距 sceneSettings.fog.distance 的取值范围从 30–200 米放宽到 30–10000 米，供上千米的城区布景用。
  //   版本 3 的程序把超过 200 的雾距当成非法值换回默认 90 米，保存时会改掉用户的雾，所以最低可读版本提高到 4。
  // 版本 5 = 城市新增自然路网风格（style = organic）与路网弯曲程度、河流、公园三个参数，装饰新增任意形状铺装 areas。
  //   版本 4 的程序不认识这个风格：画不出人行道与水面，重新生成会失败，所以最低可读版本提高到 5。
  version: 5,
  minReaderVersion: 5,
  contentSchema: cameraStageContentSchema,
  migrations: {
    // 1 → 2：旧文件没有生成过布景，补一个空列表。
    1: (content) => ({ ...structuredClone(content as Record<string, unknown>), sets: [] }),
    2: (content) => {
      const next = structuredClone(content as LooseRecord)
      next.sets = (Array.isArray(next.sets) ? next.sets as LooseRecord[] : []).map(migrateStageSetV2)
      return next
    },
    // 3 → 4：只放宽雾距的取值范围，旧文件里的值都在新范围内，内容原样保留。
    3: (content) => structuredClone(content as LooseRecord),
    4: (content) => {
      const next = structuredClone(content as LooseRecord)
      next.sets = (Array.isArray(next.sets) ? next.sets as LooseRecord[] : []).map(migrateStageSetV4)
      return next
    },
  },
  createEmptyContent: () => ({ objects: [], activeCameraId: null, sceneSettings: {}, stateKeyframes: [], sets: [] }),
  isEmptyContent: isEmptyCameraStageContent,
  summarize: (content) => ({
    objects: content.objects.length,
    stateKeyframes: content.stateKeyframes.length,
  }),
}
