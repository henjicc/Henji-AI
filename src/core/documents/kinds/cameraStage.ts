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
 * - cameraCuts：机位切换点（时间轴上的“机位”轨），与状态关键帧互不牵连；
 * - coverages：多机位覆盖，记每台摄像机在一段戏里担任什么镜头、谁在什么时候说话。
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

/** 机位切换点（v8 起）：从 time 起由 cameraId 拍摄，null 回到活动摄像机。 */
const cameraCutSchema = z.looseObject({
  id: z.string().min(1),
  time: z.number().nonnegative(),
  cameraId: z.string().min(1).nullable(),
})

/** 多机位覆盖（v8 起）：一段戏的主体、时段、台词与每台摄像机担任的镜头。 */
const coverageSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  subjectIds: z.array(z.string()),
  startTime: z.number(),
  endTime: z.number(),
  axisSide: z.union([z.literal(1), z.literal(-1)]).nullable(),
  lines: z.array(z.looseObject({ speakerId: z.string().min(1), startTime: z.number(), endTime: z.number(), text: z.string().optional() })),
  setups: z.array(z.looseObject({ cameraId: z.string().min(1), role: z.string().min(1), subjectIds: z.array(z.string()), size: z.string().min(1) })),
})

/** 镜头参考的帧率固定为 30（CAMERA_STAGE_DEFAULT_FPS）；迁移按它算“前一帧”。 */
const MIGRATION_FRAME = 1 / 30

/**
 * 7 → 8：机位从状态关键帧上搬到独立的切换点轨。
 *
 * 旧文件每张卡带 cameraId（null 为活动摄像机），从这张卡起由它拍摄；改成在机位变化的卡的时刻放一个切换点。
 * 旧规则下相邻两张卡都指定了机位且不同时，整段过渡冻结在前一张卡、到后一张卡才一跳（硬切）。新规则切机位
 * 不再冻结画面，为保持旧文件画面不变，在后一张卡前一帧补一张复制前一张卡的卡：前一段静止，最后一帧才变到后一张。
 * 前一张卡原来的过渡细节（路径、跟拍、错峰）挪到补的那张卡上，前一张只留动作覆盖。硬切两侧的卡都改为停靠：
 * 冻结段两端值相同，停靠才保证中间不漂；后一张不与补的那一帧连成运动链。取舍：旧规则下这两张卡若是平滑通过，
 * 外侧那段在卡处取单侧切线，迁移后变成停靠，只有这两点附近的速度曲线略有不同。导出按整帧采样与旧画面一致，
 * 高于 30Hz 的实时播放在切换前最后一帧内会看到滑向后一张。
 * 旧规则下第一张卡之前也用它的机位拍，所以首卡指定了机位时它的切点放在 0 秒。
 */
function migrateCameraCutsV7(content: LooseRecord): LooseRecord {
  const next = structuredClone(content)
  const frames = (Array.isArray(next.stateKeyframes) ? next.stateKeyframes as LooseRecord[] : [])
    .slice().sort((left, right) => Number(left.time) - Number(right.time))
  const cameraOf = (frame: LooseRecord): string | null => typeof frame.cameraId === 'string' && frame.cameraId ? frame.cameraId : null
  const cuts: LooseRecord[] = []
  let shooting: string | null = null
  frames.forEach((frame) => {
    const camera = cameraOf(frame)
    if (camera !== shooting) cuts.push({ id: `cut-${String(frame.id)}`, time: frame === frames[0] ? 0 : Number(frame.time) || 0, cameraId: camera })
    shooting = camera
  })
  const result: LooseRecord[] = []
  frames.forEach((frame, index) => {
    const following = frames[index + 1]
    const from = cameraOf(frame)
    const to = following ? cameraOf(following) : null
    const holdTime = following ? Number(following.time) - MIGRATION_FRAME : 0
    if (!following || !from || !to || from === to || holdTime - Number(frame.time) < MIGRATION_FRAME / 2) {
      result.push(frame)
      return
    }
    const transition = (frame.transition ?? { perObject: {} }) as LooseRecord
    const perObject = (transition.perObject ?? {}) as Record<string, LooseRecord>
    const overridesOnly = Object.fromEntries(Object.entries(perObject).flatMap(([objectId, detail]) => (
      detail && typeof detail === 'object' && detail.motionOverride !== undefined ? [[objectId, { motionOverride: detail.motionOverride }]] : []
    )))
    result.push({ ...frame, continuity: 'stop', transition: { ...transition, perObject: overridesOnly } })
    result.push({
      ...structuredClone(frame),
      id: `${String(frame.id)}-hold`,
      name: `${typeof frame.name === 'string' ? frame.name : '关键帧'}（切换前）`,
      time: Math.round(holdTime * 1e6) / 1e6,
      continuity: 'stop',
    })
    following.continuity = 'stop'
  })
  next.stateKeyframes = result.map(({ cameraId: _camera, ...frame }) => frame)
  next.cameraCuts = cuts
  next.coverages = []
  return next
}

export const cameraStageContentSchema = z.object({
  objects: z.array(stageObjectSchema),
  activeCameraId: z.string().nullable(),
  /** 场景级设置；缺字段或不合法时工具按默认值补齐。 */
  sceneSettings: persistedStageSettingsSchema,
  stateKeyframes: z.array(stateKeyframeSchema),
  sets: z.array(stageSetSchema),
  cameraCuts: z.array(cameraCutSchema),
  coverages: z.array(coverageSchema),
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
  // 版本 6 = 摄像机对象新增可选的运镜设备 rig 与注视跟随滞后 aimLag（秒）。版本 5 的程序原样保留这两个字段，
  //   只是不认识它们，按不模拟设备播放，不会误解其余内容，所以最低可读版本不变。
  // 版本 7 = 角色走位与动作、摄像机跟拍：过渡细节的速度预设新增 cruise（起停平滑、中间匀速），摄像机过渡细节新增
  //   跟拍 follow（主体、偏移、注视偏移、参照系、滞后），角色动作新增挥手 Wave。含义也变了：走跑动作按走过的路程推进
  //   （motionOverride 里走跑片段的 speed 不再是播放倍速），卡内动作在静止的卡之间也会切换，一次性动作做完接后续动作。
  //   版本 6 的程序会把 cruise、跟拍与挥手当成非法值丢掉，保存时改掉用户的走位与跟拍，所以最低可读版本提高到 7。
  // 版本 8 = 机位从状态关键帧搬到独立的切换点轨 cameraCuts，新增多机位覆盖 coverages；状态关键帧不再带 cameraId。
  //   含义也变了：切机位只换渲染用的摄像机，场景照常连续运动，不再把相邻两张不同机位卡之间的画面冻结。
  //   版本 7 的程序读不到切换点（整段都用活动摄像机拍），所以最低可读版本提高到 8。
  version: 8,
  minReaderVersion: 8,
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
    // 5 → 6：旧文件的摄像机没有运镜设备与注视跟随滞后，按不模拟设备、不滞后播放，内容原样保留。
    5: (content) => structuredClone(content as LooseRecord),
    // 6 → 7：旧文件没有 cruise、跟拍与挥手，内容原样保留；走跑按路程推进与卡内动作切换是播放规则，不改数据。
    6: (content) => structuredClone(content as LooseRecord),
    7: (content) => migrateCameraCutsV7(content as LooseRecord),
  },
  createEmptyContent: () => ({ objects: [], activeCameraId: null, sceneSettings: {}, stateKeyframes: [], sets: [], cameraCuts: [], coverages: [] }),
  isEmptyContent: isEmptyCameraStageContent,
  summarize: (content) => ({
    objects: content.objects.length,
    stateKeyframes: content.stateKeyframes.length,
  }),
}
