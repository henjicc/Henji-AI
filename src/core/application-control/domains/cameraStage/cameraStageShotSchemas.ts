import { z } from 'zod'

import { cameraStageVec3Schema } from './cameraStageCapabilitySchemas'

/** 景别从远到近；人物按画面上下缘切在身上的位置定义，物体与点按同样的高度比例。 */
export const CAMERA_STAGE_SHOT_SIZES = [
  'extreme_long', 'long', 'full', 'medium', 'medium_close', 'close', 'closeup', 'extreme_closeup',
] as const
export type CameraStageShotSize = typeof CAMERA_STAGE_SHOT_SIZES[number]

export const CAMERA_STAGE_SHOT_SIZE_LABELS: Record<CameraStageShotSize, string> = {
  extreme_long: '大远景',
  long: '远景',
  full: '全景',
  medium: '中景',
  medium_close: '中近景',
  close: '近景',
  closeup: '特写',
  extreme_closeup: '大特写',
}

export const CAMERA_STAGE_SHOT_ANGLES = ['eye_level', 'high', 'low', 'birds_eye'] as const
export type CameraStageShotAngle = typeof CAMERA_STAGE_SHOT_ANGLES[number]

export const CAMERA_STAGE_SHOT_LENSES = ['wide', 'standard', 'telephoto'] as const
export type CameraStageShotLens = typeof CAMERA_STAGE_SHOT_LENSES[number]

export const CAMERA_STAGE_SHOT_RELATIONS = ['single', 'two_shot', 'over_shoulder', 'reverse_pair'] as const
export type CameraStageShotRelation = typeof CAMERA_STAGE_SHOT_RELATIONS[number]

export const CAMERA_STAGE_SHOT_POSITIONS = ['auto', 'left', 'center', 'right'] as const
export type CameraStageShotPosition = typeof CAMERA_STAGE_SHOT_POSITIONS[number]

export const CAMERA_STAGE_SHOT_VIEWS = ['front', 'front_left', 'front_right', 'left', 'right', 'back'] as const
export type CameraStageShotView = typeof CAMERA_STAGE_SHOT_VIEWS[number]

export const cameraStageShotSubjectSchema = z.union([
  z.object({
    objectId: z.string().min(1).describe('主体对象 id：取自 observe_camera_stage_scene 的 objects[].id；布景成员用 list_application_entities 查到的 id'),
  }).strict(),
  z.object({
    point: cameraStageVec3Schema.describe('布景里要拍的东西的中心点（米）'),
    height: z.number().positive().max(10_000).optional().describe('这个东西有多高（米），景别按它算；省略按 1.8 米'),
  }).strict(),
])

export type CameraStageShotSubjectInput = z.infer<typeof cameraStageShotSubjectSchema>

/** 能力与执行器共用的意图字段；文档 ID 字段各自加。 */
export const cameraStageShotIntentShape = {
  cameraId: z.string().min(1).describe('要摆的摄像机 id（取自观察结果）；新机位先用 place_camera_stage_object 新建摄像机'),
  reverseCameraId: z.string().min(1).optional().describe('relation=reverse_pair 时的第二台摄像机：拍反打'),
  subjects: z.array(cameraStageShotSubjectSchema).min(1).max(2)
    .describe('主体。single 一个；two_shot 两个；over_shoulder 为 [前景肩膀那个人, 被拍的人]；reverse_pair 为 [A, B]，第一台从 A 肩后拍 B，第二台从 B 肩后拍 A'),
  relation: z.enum(CAMERA_STAGE_SHOT_RELATIONS).optional()
    .describe('镜头关系：single 单人、two_shot 双人镜头、over_shoulder 过肩、reverse_pair 正反打一对；省略时一个主体为 single、两个为 two_shot'),
  size: z.enum(CAMERA_STAGE_SHOT_SIZES).optional()
    .describe('景别：extreme_long 大远景（人约占画高十分之一）、long 远景（约三分之一）、full 全景（头到脚）、medium 中景（膝盖以上）、'
      + 'medium_close 中近景（腰以上）、close 近景（胸口以上）、closeup 特写（肩以上）、extreme_closeup 大特写（脸的局部）；'
      + '省略时单人与双人为 medium、过肩与正反打为 close'),
  position: z.enum(CAMERA_STAGE_SHOT_POSITIONS).default('auto')
    .describe('单人镜头主体在画面中的位置（三分法）：left 左三分线、center 居中、right 右三分线；auto 按视线方向在前方留空，正对镜头时居中'),
  view: z.enum(CAMERA_STAGE_SHOT_VIEWS).optional()
    .describe('单人镜头从主体的哪一面拍（按主体自己的左右）：front 正面、front_left 左前方、front_right 右前方、left 左侧、right 右侧、back 背面；省略时取 3/4 正面，落在摄像机当前所在的一侧'),
  angle: z.enum(CAMERA_STAGE_SHOT_ANGLES).default('eye_level')
    .describe('机位角度：eye_level 平视（与眼睛同高）、high 俯拍、low 仰拍、birds_eye 鸟瞰（几乎垂直向下）；'
      + '过肩与正反打只用平视，机位在前景那人肩后与他眼睛同高，俯仰由两人高低决定'),
  lens: z.enum(CAMERA_STAGE_SHOT_LENSES).optional()
    .describe('焦距倾向：wide 广角 24mm（离得近、透视强）、standard 标准 50mm、telephoto 长焦 85mm（离得远、压缩空间）；省略时过肩与正反打用长焦，其余用标准'),
  crossAxis: z.boolean().default(false)
    .describe('两人镜头默认守在轴线（两人连线）同一侧，跟已经拍这两人的机位一致；true 表示有意越轴到另一侧'),
  avoidOcclusion: z.boolean().default(true)
    .describe('有遮挡时在意图允许的范围内自动换角度或换焦距距离并报告；false 只报告不避让（揭示镜头的起点要被挡住时用）'),
  at: z.union([
    z.object({ time: z.number().nonnegative().max(3600).describe('时间点（秒）：在这里记录机位，没有状态关键帧就新建一张') }).strict(),
    z.object({ stateKeyframeId: z.string().min(1).describe('状态关键帧 id：把机位记录进这一张') }).strict(),
  ]).optional().describe('在时间轴哪里定机位；省略时摄像机整条时间轴都摆在这里（摄像机已有运镜时必须指定）'),
}

const screenPointSchema = z.object({ x: z.number(), y: z.number() }).strict()
const blockerSchema = z.object({ objectId: z.string(), name: z.string() }).strict()

/** 一台摄像机画面里某个主体的实际构图；画面坐标 0..1，左上为原点。 */
export const cameraStageShotSubjectReadbackSchema = z.object({
  objectId: z.string().nullable(),
  name: z.string(),
  inFrame: z.boolean().describe('关键点（人的眼睛、物体中心）在画面内'),
  screenBox: z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() }).strict().nullable().describe('画面内的投影框'),
  center: screenPointSchema.nullable().describe('关键点在画面上的位置，可以在画外'),
  heightRatio: z.number().nullable().describe('主体完整高度占画面高度的比例，超过 1 说明被画框切掉了一部分'),
  shotSize: z.enum(CAMERA_STAGE_SHOT_SIZES).nullable(),
  horizontal: z.enum(['left', 'center', 'right', 'outside']),
  lookRoom: z.enum(['open', 'cramped', 'neutral']).optional().describe('人物视线前方：open 留了空，cramped 顶着画框，neutral 正对、背对或居中'),
  visibleFraction: z.number().describe('画面内采样点没被挡住的比例'),
  keyVisible: z.boolean().describe('脸或中心是否可见'),
  occludedBy: z.array(blockerSchema),
}).strict()

export const cameraStageShotReadbackSchema = z.object({
  angle: z.enum(CAMERA_STAGE_SHOT_ANGLES),
  focalLength: z.number(),
  subjects: z.array(cameraStageShotSubjectReadbackSchema),
}).strict()

/** 定机位的结果：每台摄像机一条，读回来自写入后该时刻的实际画面。 */
export const cameraStageComposedShotSchema = z.object({
  cameraId: z.string(),
  name: z.string(),
  kind: z.enum(['single', 'two_shot', 'over_shoulder']),
  position: cameraStageVec3Schema,
  lookAtTarget: cameraStageVec3Schema,
  focalLength: z.number(),
  size: z.enum(CAMERA_STAGE_SHOT_SIZES),
  angle: z.enum(CAMERA_STAGE_SHOT_ANGLES),
  lens: z.enum(CAMERA_STAGE_SHOT_LENSES),
  adjusted: z.object({
    reasons: z.array(z.enum(['occlusion', 'ground', 'inside_object', 'too_close'])),
    blockedBy: z.array(z.string()),
    azimuthDegrees: z.number(),
    elevationDegrees: z.number(),
    lens: z.enum(CAMERA_STAGE_SHOT_LENSES).nullable(),
    summary: z.string(),
  }).strict().nullable().describe('意图机位被挡、钻地或贴到前景人时改了什么；没改为 null'),
  axis: z.object({
    reference: z.string(),
    crossed: z.boolean(),
    screenLeft: z.string(),
    screenRight: z.string(),
  }).strict().nullable().describe('两人镜头的轴线：跟着谁定的一侧、谁在画左谁在画右'),
  composition: cameraStageShotReadbackSchema,
}).strict()

export const cameraStageShotResultShape = {
  time: z.number().describe('定机位所在的时间点（秒）'),
  stateKeyframeId: z.string().nullable().describe('写进的状态关键帧；整条时间轴摆机位时为 null'),
  createdStateKeyframe: z.boolean(),
  shots: z.array(cameraStageComposedShotSchema),
  compositionHint: z.string().optional().describe('有改动、遮挡或主体出画时的提示'),
}

type ShotIntent = {
  angle?: CameraStageShotAngle
  cameraId: string
  reverseCameraId?: string
  subjects: unknown[]
  relation?: CameraStageShotRelation
  position?: CameraStageShotPosition
  view?: CameraStageShotView
}

export function resolveCameraStageShotRelation(input: Pick<ShotIntent, 'relation' | 'subjects'>): CameraStageShotRelation {
  return input.relation ?? (input.subjects.length === 1 ? 'single' : 'two_shot')
}

/** 关系与主体数、第二台摄像机、单人专属参数之间的约束；拒绝时点名字段。 */
export function refineCameraStageShotIntent(input: ShotIntent, context: z.RefinementCtx): void {
  const relation = resolveCameraStageShotRelation(input)
  const needed = relation === 'single' ? 1 : 2
  if (input.subjects.length !== needed) {
    context.addIssue({ code: 'custom', path: ['subjects'], message: `relation=${relation} 需要 ${needed} 个主体，收到 ${input.subjects.length} 个` })
  }
  if (relation === 'reverse_pair' && !input.reverseCameraId) {
    context.addIssue({ code: 'custom', path: ['reverseCameraId'], message: '正反打需要第二台摄像机：reverseCameraId' })
  }
  if (relation !== 'reverse_pair' && input.reverseCameraId) {
    context.addIssue({ code: 'custom', path: ['reverseCameraId'], message: '只有 relation=reverse_pair 才用 reverseCameraId' })
  }
  if (input.reverseCameraId && input.reverseCameraId === input.cameraId) {
    context.addIssue({ code: 'custom', path: ['reverseCameraId'], message: '正反打的两台摄像机不能是同一台' })
  }
  if ((relation === 'over_shoulder' || relation === 'reverse_pair') && input.angle && input.angle !== 'eye_level') {
    context.addIssue({ code: 'custom', path: ['angle'], message: '过肩与正反打的机位在前景那人肩后、与他眼睛同高，俯仰由两人高低决定（站着的人肩后拍坐着的人自然是俯拍）；要指定俯拍、仰拍或鸟瞰改用 two_shot 或 single' })
  }
  if (relation !== 'single' && input.view) {
    context.addIssue({ code: 'custom', path: ['view'], message: 'view 只用于单人镜头；两人镜头的机位由轴线和关系决定' })
  }
  if (relation !== 'single' && input.position && input.position !== 'auto') {
    context.addIssue({ code: 'custom', path: ['position'], message: 'position 只用于单人镜头；两人镜头按关系排在三分线上' })
  }
}
