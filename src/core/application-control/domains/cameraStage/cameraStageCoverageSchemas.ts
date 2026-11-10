import { z } from 'zod'

import { cameraStageVec3Schema } from './cameraStageCapabilitySchemas'
import { CAMERA_STAGE_SHOT_SIZES, cameraStageShotReadbackSchema } from './cameraStageShotSchemas'

/** 覆盖里的镜头角色。单人、反应、插入一台拍一个主体；过肩拍对面那人（从这个人肩后）。 */
const CAMERA_STAGE_COVERAGE_ROLES = ['establishing', 'master', 'over_shoulder', 'single', 'reaction', 'insert'] as const
export type CameraStageCoverageRole = typeof CAMERA_STAGE_COVERAGE_ROLES[number]

export const CAMERA_STAGE_COVERAGE_ROLE_LABELS: Record<CameraStageCoverageRole, string> = {
  establishing: '建立',
  master: '主镜头',
  over_shoulder: '过肩',
  single: '单人',
  reaction: '反应',
  insert: '插入',
}

/** 剪辑节奏：镜头时长的下限、目标与上限（秒）。 */
export const CAMERA_STAGE_EDIT_PACES = {
  fast: { min: 0.8, target: 1.8, max: 3.5, label: '快' },
  medium: { min: 1.5, target: 3.5, max: 6, label: '中' },
  slow: { min: 3, target: 6, max: 12, label: '慢' },
} as const
export type CameraStageEditPace = keyof typeof CAMERA_STAGE_EDIT_PACES

export const cameraStageCoverageLineSchema = z.object({
  speakerId: z.string().min(1).describe('说这句话的角色 id（取自观察结果）'),
  startTime: z.number().nonnegative().max(3600).describe('开始说的时刻（秒）'),
  endTime: z.number().nonnegative().max(3600).describe('说完的时刻（秒）'),
  text: z.string().max(500).optional().describe('台词，只用于说明，可省略'),
}).strict()

const linesSchema = z.array(cameraStageCoverageLineSchema).max(200)

const cameraStageCoverageInsertSchema = z.union([
  z.object({ objectId: z.string().min(1).describe('插入镜头拍的对象 id（道具、门、手边的东西）') }).strict(),
  z.object({
    point: cameraStageVec3Schema.describe('插入镜头拍的地点（米）'),
    height: z.number().positive().max(100).optional().describe('那个东西有多高（米），景别按它算；省略按 0.3 米'),
  }).strict(),
])

export function refineCameraStageLines(lines: ReadonlyArray<z.infer<typeof cameraStageCoverageLineSchema>> | undefined, context: z.RefinementCtx): void {
  lines?.forEach((line, index) => {
    if (line.endTime <= line.startTime) context.addIssue({ code: 'custom', path: ['lines', index, 'endTime'], message: '台词的 endTime 必须晚于 startTime' })
  })
}

export const cameraStageCoverageIntentShape = {
  subjects: z.array(z.string().min(1)).min(1).max(2)
    .describe('这段戏的主体（角色或对象 id）：对话、追逐两个，独白、建立环境一个；对话的过肩与正反打按 [A, B] 的顺序配对'),
  startTime: z.number().nonnegative().max(3600).optional().describe('这段戏从几秒开始；省略为 0'),
  endTime: z.number().positive().max(3600).optional().describe('到几秒结束；省略到时间轴最后一张状态关键帧'),
  lines: linesSchema.optional().describe('说话节拍：谁在什么时候说话。剪辑按它切到说话人或反应镜头；省略时按角色的“说话”动作推断'),
  shots: z.array(z.enum(CAMERA_STAGE_COVERAGE_ROLES)).min(1).max(6).optional()
    .describe('要布置的镜头：establishing 建立（大远景、俯拍、广角，交代环境）、master 主镜头（两人全景双人镜头，一人时全景）、'
      + 'over_shoulder 过肩正反打一对、single 每人一台近景、reaction 每人一台特写（听的人的反应）、insert 插入（道具或细节特写，需给 insert）。'
      + '省略时两人为 establishing、master、over_shoulder、single，一人为 establishing、master、single'),
  insert: cameraStageCoverageInsertSchema.optional().describe('插入镜头拍什么；shots 含 insert 时必填'),
  referenceTime: z.number().nonnegative().max(3600).optional()
    .describe('主镜头、过肩、单人、反应、插入按主体在哪一刻的位置摆；省略取第一句台词开始，没有台词取 startTime。建立镜头按整段里两人离得最远的时刻摆，走位都框得住'),
  replaceCoverageId: z.string().min(1).optional().describe('重新布置已有的一组覆盖：同一镜头沿用原来的摄像机，新增的镜头新建摄像机；时段、台词、镜头与名称省略时沿用原值'),
  name: z.string().min(1).max(60).optional().describe('这组覆盖的名称，也是摄像机名前缀；省略为“覆盖”加序号'),
}

export function refineCameraStageCoverage(input: { subjects: string[]; shots?: CameraStageCoverageRole[]; insert?: unknown; startTime?: number; endTime?: number; lines?: Array<z.infer<typeof cameraStageCoverageLineSchema>> }, context: z.RefinementCtx): void {
  if (input.shots?.includes('insert') && !input.insert) context.addIssue({ code: 'custom', path: ['insert'], message: 'shots 含 insert 时要给 insert：拍哪个对象或地点' })
  if (input.subjects.length === 1 && input.shots?.some((role) => role === 'over_shoulder')) {
    context.addIssue({ code: 'custom', path: ['shots'], message: 'over_shoulder 需要两个主体；一个主体用 single 或 reaction' })
  }
  if (new Set(input.subjects).size !== input.subjects.length) context.addIssue({ code: 'custom', path: ['subjects'], message: '两个主体不能是同一个' })
  if (input.endTime !== undefined && input.startTime !== undefined && input.endTime <= input.startTime) context.addIssue({ code: 'custom', path: ['endTime'], message: 'endTime 必须晚于 startTime' })
  refineCameraStageLines(input.lines, context)
}

const spanSchema = z.object({ startTime: z.number(), endTime: z.number() }).strict()

const cameraStageCoverageSetupResultSchema = z.object({
  cameraId: z.string(),
  name: z.string(),
  role: z.enum(CAMERA_STAGE_COVERAGE_ROLES),
  subjectIds: z.array(z.string()),
  size: z.enum(CAMERA_STAGE_SHOT_SIZES),
  referenceTime: z.number().describe('按主体这一刻的位置摆的机位'),
  created: z.boolean().describe('新建的摄像机为 true，沿用原来的为 false'),
  axisSide: z.enum(['coverage_side', 'on_axis', 'crossed']).nullable().describe('相对两人连线：coverage_side 与这组覆盖同侧，on_axis 骑在轴线上，crossed 越到另一侧；一人时为 null'),
  visibleSpans: z.array(spanSchema).describe('这台机位在这段戏里拍得到主要主体（在画面内、脸或中心没被挡）的时段'),
  adjusted: z.string().nullable().describe('意图机位被挡、钻地或贴到人身上时改了什么'),
  composition: cameraStageShotReadbackSchema.describe('参照时刻的实际构图'),
}).strict()

export const cameraStageCoverageResultShape = {
  coverageId: z.string(),
  name: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  axis: z.object({ screenLeft: z.string(), screenRight: z.string() }).strict().nullable().describe('两人在这组覆盖里谁在画左、谁在画右'),
  lines: z.array(cameraStageCoverageLineSchema).describe('记进这组覆盖的说话节拍（给了 lines 就是它，否则按“说话”动作推断）'),
  setups: z.array(cameraStageCoverageSetupResultSchema),
  coverageHint: z.string().optional().describe('有机位被改、拍不到主体或推断不出台词时的提示'),
}

/* ── 剪辑与检查 ─────────────────────────────────────────────────── */

export const CAMERA_STAGE_EDIT_RULES = ['axis', 'jump_cut', 'cut_on_action', 'speaker', 'duration', 'establishing', 'size_progression', 'subject_visible'] as const
export type CameraStageEditRule = typeof CAMERA_STAGE_EDIT_RULES[number]

const cameraStageEditShotSchema = z.object({
  index: z.number().int().nonnegative(),
  startTime: z.number(),
  endTime: z.number(),
  duration: z.number(),
  cameraId: z.string().nullable(),
  cameraName: z.string(),
  role: z.enum(CAMERA_STAGE_COVERAGE_ROLES).nullable().describe('这台摄像机在覆盖里担任的镜头；不在覆盖里为 null'),
  size: z.enum(CAMERA_STAGE_SHOT_SIZES).nullable().describe('主要主体在这一镜中段的实际景别'),
  primarySubjectId: z.string().nullable().describe('这一镜主要拍谁'),
  visibleSubjectIds: z.array(z.string()),
  reason: z.string().optional().describe('剪辑时为什么在这里用这一镜'),
}).strict()

const cameraStageEditViolationSchema = z.object({
  rule: z.enum(CAMERA_STAGE_EDIT_RULES),
  severity: z.enum(['error', 'warning']),
  shotIndexes: z.array(z.number().int().nonnegative()).describe('涉及哪几镜（shots[].index）'),
  time: z.number().describe('问题出在第几秒（切点或镜头中段）'),
  message: z.string(),
  suggestion: z.string(),
}).strict()

export const cameraStageEditCheckShape = {
  shots: z.array(cameraStageEditShotSchema),
  violations: z.array(cameraStageEditViolationSchema),
  passedRules: z.array(z.enum(CAMERA_STAGE_EDIT_RULES)).describe('这段剪辑没有违反的规则'),
  summary: z.string(),
}

const rangeShape = {
  startTime: z.number().nonnegative().max(3600).optional().describe('从几秒开始；省略取覆盖的起点，没有覆盖从 0 开始'),
  endTime: z.number().positive().max(3600).optional().describe('到几秒；省略取覆盖的终点，没有覆盖到时间轴结束'),
  pace: z.enum(['fast', 'medium', 'slow']).default('medium')
    .describe('节奏：fast 快（每镜约 1–3.5 秒，追逐、打斗）、medium 中（约 1.5–6 秒，对话）、slow 慢（约 3–12 秒，独白、抒情）'),
}

export const cameraStageCutIntentShape = {
  coverageId: z.string().min(1).describe('要剪的那组覆盖 id（取自 cover_camera_stage_scene 的结果或观察结果 coverages[].id）'),
  ...rangeShape,
  lines: linesSchema.optional().describe('改用这组说话节拍并记进覆盖；省略用覆盖里记的'),
  establish: z.boolean().default(true).describe('开场先用建立镜头（覆盖里有 establishing 时）'),
}

export const cameraStageCheckIntentShape = {
  coverageId: z.string().min(1).optional().describe('按这组覆盖的主体、台词与镜头角色检查；省略时只按机位几何检查，说话人规则跳过'),
  ...rangeShape,
}

export const cameraStageCutResultShape = {
  coverageId: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  pace: z.enum(['fast', 'medium', 'slow']),
  cutCount: z.number().int().nonnegative().describe('写进机位轨的切换点数'),
  ...cameraStageEditCheckShape,
}

export type CameraStageEditShot = z.infer<typeof cameraStageEditShotSchema>
export type CameraStageEditViolation = z.infer<typeof cameraStageEditViolationSchema>
export type CameraStageCoverageLine = z.infer<typeof cameraStageCoverageLineSchema>
export type CameraStageCoverageSetupResult = z.infer<typeof cameraStageCoverageSetupResultSchema>
