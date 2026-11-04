import { z } from 'zod'

/*
 * 布景生成的参数契约：界面、助手与持久化共用这一份。
 *
 * 输入里的每个字段都可以省略：重新生成同一片布景时，省略的字段沿用这片布景上一次的值，
 * 新建时取 STAGE_SET_DEFAULTS。所以 schema 不写 zod default，默认值只在这里登记一次，
 * 由领域层 resolveStageSetParams 统一补齐，再把补齐后的完整参数写进文档。
 * 长度单位与场景坐标相同（米），角度为度。
 */

export const CAMERA_STAGE_SET_PRESETS = ['city', 'street', 'plaza', 'crowd'] as const
export type CameraStageSetPreset = typeof CAMERA_STAGE_SET_PRESETS[number]

export const CAMERA_STAGE_SET_PRESET_LABELS: Record<CameraStageSetPreset, string> = {
  city: '城市',
  street: '街道',
  plaza: '广场',
  crowd: '人群',
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

const heightRangeSchema = z.object({
  min: z.number().positive().describe('最低楼高（米）'),
  max: z.number().positive().describe('最高楼高（米）'),
}).strict().refine(range => range.min <= range.max, { message: '最低楼高不能大于最高楼高' })

export const cameraStageCityLayoutSchema = z.object({
  preset: z.literal('city'),
  ...placementShape,
  width: length('城市范围东西向宽度（米），默认 240').optional(),
  depth: length('城市范围南北向进深（米），默认 240').optional(),
  blockSize: length('街区边长（米），默认 40').optional(),
  streetWidth: length('街道宽度（米），默认 12；街区数取偶数且至少 2×2，场景中心总落在路口上').optional(),
  lotSize: length('街区里每块地的宽度（米），默认 10；越小楼越密越细').optional(),
  density: ratio('地块建楼比例 0–1，默认 0.85；空出来的地块是空地').optional(),
  height: heightRangeSchema.optional().describe('楼高范围，默认 6–60 米；多数楼偏矮，少数接近最高'),
  heightProfile: z.enum(['downtown', 'uniform']).optional()
    .describe('楼高分布：downtown 中心高四周低（默认），uniform 各处一样'),
}).strict()

export const cameraStageStreetLayoutSchema = z.object({
  preset: z.literal('street'),
  ...placementShape,
  length: length('街道长度（米），默认 120').optional(),
  streetWidth: length('街道宽度（米），默认 12').optional(),
  lotWidth: length('沿街每栋楼的面宽（米），默认 8').optional(),
  buildingDepth: length('楼的进深（米），默认 12').optional(),
  density: ratio('沿街建楼比例 0–1，默认 0.9').optional(),
  height: heightRangeSchema.optional().describe('楼高范围，默认 6–24 米'),
}).strict()

export const cameraStagePlazaLayoutSchema = z.object({
  preset: z.literal('plaza'),
  ...placementShape,
  size: length('广场空地边长（米），默认 60').optional(),
  lotWidth: length('四周每栋楼的面宽（米），默认 10').optional(),
  buildingDepth: length('四周楼的进深（米），默认 14').optional(),
  density: ratio('四周建楼比例 0–1，默认 1').optional(),
  height: heightRangeSchema.optional().describe('楼高范围，默认 8–30 米'),
  monument: z.boolean().optional().describe('广场中心是否放一座纪念碑，默认放'),
}).strict()

export const cameraStageCrowdLayoutSchema = z.object({
  preset: z.literal('crowd'),
  ...placementShape,
  count: z.number().int().positive().optional().describe('人数，默认 24'),
  formation: z.enum(['grid', 'scatter', 'ring']).optional()
    .describe('队形：grid 方阵（默认）、scatter 随意散开、ring 围成一圈'),
  spacing: length('相邻两人的间距（米），默认 1.5').optional(),
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

type DefaultsOf<P extends CameraStageSetPreset> = Omit<Extract<CameraStageSetParams, { preset: P }>, 'seed'>

export const STAGE_SET_DEFAULTS: { [P in CameraStageSetPreset]: DefaultsOf<P> } = {
  city: {
    preset: 'city', center: { x: 0, z: 0 }, rotation: 0,
    width: 240, depth: 240, blockSize: 40, streetWidth: 12, lotSize: 10, density: 0.85,
    height: { min: 6, max: 60 }, heightProfile: 'downtown',
  },
  street: {
    preset: 'street', center: { x: 0, z: 0 }, rotation: 0,
    length: 120, streetWidth: 12, lotWidth: 8, buildingDepth: 12, density: 0.9, height: { min: 6, max: 24 },
  },
  plaza: {
    preset: 'plaza', center: { x: 0, z: 0 }, rotation: 0,
    size: 60, lotWidth: 10, buildingDepth: 14, density: 1, height: { min: 8, max: 30 }, monument: true,
  },
  crowd: {
    preset: 'crowd', center: { x: 0, z: 0 }, rotation: 0,
    count: 24, formation: 'grid', spacing: 1.5, facing: 'forward',
  },
}
