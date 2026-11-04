import { z } from 'zod'

/*
 * 布景生成的参数契约：界面、助手与持久化共用这一份。
 *
 * 输入里的每个字段都可以省略：重新生成同一片布景时，省略的字段沿用这片布景上一次的值，
 * 新建时取 STAGE_SET_DEFAULTS。所以 schema 不写 zod default，默认值只在这里登记一次，
 * 由领域层 resolveStageSetParams 统一补齐，再把补齐后的完整参数写进文档。
 * 长度单位与场景坐标相同（1 单位 = 1 米），角度为度，楼高按层数给，换算成米由城市风格的层高决定。
 * 街宽、街区尺寸、层高与建筑体量不开放成参数：它们由城市风格按真实城市取值，见 stageSetStyles.ts。
 */

export const CAMERA_STAGE_SET_PRESETS = ['city', 'street', 'plaza', 'crowd'] as const
export type CameraStageSetPreset = typeof CAMERA_STAGE_SET_PRESETS[number]

export const CAMERA_STAGE_SET_PRESET_LABELS: Record<CameraStageSetPreset, string> = {
  city: '城市',
  street: '街道',
  plaza: '广场',
  crowd: '人群',
}

export const CAMERA_STAGE_CITY_STYLES = ['grid', 'superblock', 'oldtown'] as const
export type CameraStageCityStyle = typeof CAMERA_STAGE_CITY_STYLES[number]

export const CAMERA_STAGE_CITY_STYLE_LABELS: Record<CameraStageCityStyle, string> = {
  grid: '方格城市',
  superblock: '新城街区',
  oldtown: '欧式老城',
}

export const CAMERA_STAGE_ROAD_CLASSES = ['local', 'collector', 'arterial'] as const
export type CameraStageRoadClass = typeof CAMERA_STAGE_ROAD_CLASSES[number]

export const CAMERA_STAGE_ROAD_CLASS_LABELS: Record<CameraStageRoadClass, string> = {
  local: '支路',
  collector: '次干道',
  arterial: '主干道',
}

const length = (description: string) => z.number().positive().describe(description)
const ratio = (description: string) => z.number().min(0).max(1).describe(description)

const placementShape = {
  center: z.object({ x: z.number(), z: z.number() }).strict().optional()
    .describe('布景中心在地面上的坐标（米），默认场景原点'),
  rotation: z.number().optional().describe('整片布景绕竖直轴的朝向（度），默认 0'),
  seed: z.number().int().min(0).max(2_147_483_647).optional()
    .describe('随机种子；同一组参数加同一个种子总是得到同一片布景。省略时新建取随机值、重新生成沿用原值'),
}

const floorRangeSchema = z.object({
  min: z.number().int().min(1).max(200).describe('最少层数'),
  max: z.number().int().min(1).max(200).describe('最多层数'),
}).strict().refine(range => range.min <= range.max, { message: '最少层数不能大于最多层数' })

const propsShape = {
  props: z.boolean().optional()
    .describe('比例参照物：人行道与路缘、车道线与斑马线、行道树、路灯、车辆，默认开；关掉只留楼体'),
}

export const cameraStageCityLayoutSchema = z.object({
  preset: z.literal('city'),
  ...placementShape,
  style: z.enum(CAMERA_STAGE_CITY_STYLES).optional()
    .describe('城市风格，决定路网分级、街区尺寸、层高与建筑体量：grid 方格城市（纽约式 80×260 米长条街区，默认）、'
      + 'superblock 国内新城（50 米主干道围出约 400 米超级街区，内部支路分成小区与商业地块，高层住宅加裙楼塔楼）、'
      + 'oldtown 欧式老城（巴塞罗那扩展区式 113 米方街区、20 米街道，6 层左右沿街围合）'),
  width: length('城市范围东西向宽度（米），默认 600；街区数取偶数且至少 2×2，场景中心总落在路口上').optional(),
  depth: length('城市范围南北向进深（米），默认 600').optional(),
  density: ratio('地块建楼比例 0–1，默认 0.85；空出来的地块是空地').optional(),
  floors: floorRangeSchema.optional()
    .describe('楼层范围（层），默认按风格：方格城市 4–40、新城 2–33、欧式老城 4–7；换风格且没给时取新风格的默认'),
  heightProfile: z.enum(['downtown', 'uniform']).optional()
    .describe('楼高分布：downtown 中心高四周低（默认），uniform 各处一样'),
  ...propsShape,
}).strict()

export const cameraStageStreetLayoutSchema = z.object({
  preset: z.literal('street'),
  ...placementShape,
  length: length('街道长度（米），默认 160').optional(),
  road: z.enum(CAMERA_STAGE_ROAD_CLASSES).optional()
    .describe('道路等级，决定车道数与红线宽：local 支路（双车道带路边停车，红线约 18 米，默认）、'
      + 'collector 次干道（四车道加非机动车道，约 30 米）、arterial 主干道（八车道加中央分隔带，约 50 米）'),
  density: ratio('沿街建楼比例 0–1，默认 0.9').optional(),
  floors: floorRangeSchema.optional().describe('楼层范围（层），默认 3–8'),
  ...propsShape,
}).strict()

export const cameraStagePlazaLayoutSchema = z.object({
  preset: z.literal('plaza'),
  ...placementShape,
  size: length('广场铺装边长（米），默认 80；四周一圈支路，再外面是楼').optional(),
  density: ratio('四周建楼比例 0–1，默认 1').optional(),
  floors: floorRangeSchema.optional().describe('楼层范围（层），默认 4–10'),
  monument: z.boolean().optional().describe('广场中心是否放一座纪念碑，默认放'),
  ...propsShape,
}).strict()

export const cameraStageCrowdLayoutSchema = z.object({
  preset: z.literal('crowd'),
  ...placementShape,
  count: z.number().int().positive().optional().describe('人数，默认 24'),
  formation: z.enum(['grid', 'scatter', 'ring']).optional()
    .describe('队形：grid 方阵（默认）、scatter 随意散开、ring 围成一圈'),
  spacing: length('相邻两人的间距（米，人身体中心之间），默认 0.9；排队约 0.5–0.7，人群站着 0.8–1.2').optional(),
  facing: z.enum(['forward', 'center', 'random']).optional()
    .describe('朝向：forward 统一朝布景朝向（默认）、center 面向中心、random 各自随机'),
}).strict()

export const cameraStageSetLayoutSchema = z.discriminatedUnion('preset', [
  cameraStageCityLayoutSchema,
  cameraStageStreetLayoutSchema,
  cameraStagePlazaLayoutSchema,
  cameraStageCrowdLayoutSchema,
])

export type CameraStageSetLayoutInput = z.infer<typeof cameraStageSetLayoutSchema>

/** 补齐后的完整参数：每个字段都有值，写进文档、出现在观察摘要里。 */
export type CameraStageSetParams = {
  [P in CameraStageSetPreset]: Required<Extract<CameraStageSetLayoutInput, { preset: P }>>
}[CameraStageSetPreset]

export type CameraStageFloorRange = { min: number; max: number }

type DefaultsOf<P extends CameraStageSetPreset> = Omit<Extract<CameraStageSetParams, { preset: P }>, 'seed'>

/** 各城市风格的默认楼层范围；城市默认值里的 floors 取 grid 这一档。 */
export const CITY_STYLE_DEFAULT_FLOORS: Record<CameraStageCityStyle, CameraStageFloorRange> = {
  grid: { min: 4, max: 40 },
  superblock: { min: 2, max: 33 },
  oldtown: { min: 4, max: 7 },
}

export const STAGE_SET_DEFAULTS: { [P in CameraStageSetPreset]: DefaultsOf<P> } = {
  city: {
    preset: 'city', center: { x: 0, z: 0 }, rotation: 0,
    style: 'grid', width: 600, depth: 600, density: 0.85, floors: CITY_STYLE_DEFAULT_FLOORS.grid, heightProfile: 'downtown', props: true,
  },
  street: {
    preset: 'street', center: { x: 0, z: 0 }, rotation: 0,
    length: 160, road: 'local', density: 0.9, floors: { min: 3, max: 8 }, props: true,
  },
  plaza: {
    preset: 'plaza', center: { x: 0, z: 0 }, rotation: 0,
    size: 80, density: 1, floors: { min: 4, max: 10 }, monument: true, props: true,
  },
  crowd: {
    preset: 'crowd', center: { x: 0, z: 0 }, rotation: 0,
    count: 24, formation: 'grid', spacing: 0.9, facing: 'forward',
  },
}
