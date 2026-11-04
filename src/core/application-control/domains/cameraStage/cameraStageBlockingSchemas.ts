import { z } from 'zod'

import { cameraStageVec3Schema } from './cameraStageCapabilitySchemas'
import { CAMERA_STAGE_SHOT_ANGLES, CAMERA_STAGE_SHOT_LENSES, CAMERA_STAGE_SHOT_POSITIONS, CAMERA_STAGE_SHOT_SIZES, CAMERA_STAGE_SHOT_VIEWS } from './cameraStageShotSchemas'

/**
 * 角色动作库：助手用语义名称，应用换成内置动作片段。一次性动作做完自己接后续（坐下之后坐着，
 * 挥手、拾取、受击之后回到待机），循环动作一直做到下一个节拍。
 */
export const CAMERA_STAGE_CHARACTER_ACTIONS = {
  idle: { clip: 'Idle_Loop', label: '待机' },
  talk: { clip: 'Idle_Talking_Loop', label: '站着说话' },
  wave: { clip: 'Wave', label: '挥手' },
  sit_down: { clip: 'Sitting_Enter', label: '坐下' },
  sit: { clip: 'Sitting_Idle_Loop', label: '坐着' },
  sit_talk: { clip: 'Sitting_Talking_Loop', label: '坐着说话' },
  stand_up: { clip: 'Sitting_Exit', label: '起身' },
  interact: { clip: 'Interact', label: '伸手操作' },
  pick_up: { clip: 'PickUp_Table', label: '从桌上拿东西' },
  crouch: { clip: 'Crouch_Idle_Loop', label: '蹲着' },
  kneel_fix: { clip: 'Fixing_Kneeling', label: '跪着修东西' },
  dance: { clip: 'Dance_Loop', label: '跳舞' },
  push: { clip: 'Push_Loop', label: '推' },
  jump: { clip: 'Jump_Start', label: '原地跳起落下' },
  roll: { clip: 'Roll', label: '翻滚' },
  punch: { clip: 'Punch_Jab', label: '刺拳' },
  cross_punch: { clip: 'Punch_Cross', label: '交叉拳' },
  hit: { clip: 'Hit_Chest', label: '胸口受击' },
  hit_head: { clip: 'Hit_Head', label: '头部受击' },
  fall: { clip: 'Death01', label: '倒地' },
  sword_attack: { clip: 'Sword_Attack', label: '挥剑' },
  sword_idle: { clip: 'Sword_Idle', label: '持剑' },
  pistol_idle: { clip: 'Pistol_Idle_Loop', label: '持枪' },
  shoot: { clip: 'Pistol_Shoot', label: '开枪' },
  reload: { clip: 'Pistol_Reload', label: '换弹' },
  cast: { clip: 'Spell_Simple_Shoot', label: '施法' },
  torch: { clip: 'Idle_Torch_Loop', label: '举火把' },
  drive: { clip: 'Driving_Loop', label: '开车' },
  swim: { clip: 'Swim_Idle_Loop', label: '踩水' },
} as const
export type CameraStageCharacterAction = keyof typeof CAMERA_STAGE_CHARACTER_ACTIONS
const ACTION_NAMES = Object.keys(CAMERA_STAGE_CHARACTER_ACTIONS) as [CameraStageCharacterAction, ...CameraStageCharacterAction[]]

/** 走跑步态 → 动作片段与省略速度时的默认速度（米/秒） */
export const CAMERA_STAGE_CHARACTER_GAITS = {
  walk: { clip: 'Walk_Loop', speed: 1.3, label: '走' },
  formal_walk: { clip: 'Walk_Formal_Loop', speed: 1.2, label: '端正地走' },
  crouch_walk: { clip: 'Crouch_Fwd_Loop', speed: 0.7, label: '蹲着走' },
  jog: { clip: 'Jog_Fwd_Loop', speed: 3, label: '跑' },
  sprint: { clip: 'Sprint_Loop', speed: 7, label: '冲刺' },
} as const
export type CameraStageCharacterGait = keyof typeof CAMERA_STAGE_CHARACTER_GAITS
const GAIT_NAMES = Object.keys(CAMERA_STAGE_CHARACTER_GAITS) as [CameraStageCharacterGait, ...CameraStageCharacterGait[]]

const planarPointSchema = z.object({ x: z.number().finite(), z: z.number().finite() }).strict()

/** 地点：地面上一点，或布景、场景里的一个对象（走到它旁边，不走进它里面）。 */
export const cameraStageCharacterPlaceSchema = z.union([
  z.object({ point: planarPointSchema.describe('地面坐标（米），y 取地面') }).strict(),
  z.object({
    objectId: z.string().min(1).describe('对象 id（门、桌子、另一个角色、布景里的楼；取自观察结果或 list_application_entities）'),
    side: z.enum(['near', 'front', 'back', 'left', 'right']).default('near')
      .describe('站在对象哪一侧（按对象自己的前后左右，正面是它的局部 +Z）；near 为离来路最近的一侧'),
    distance: z.number().min(0).max(50).optional().describe('离对象表面多远（米）；省略 0.5'),
  }).strict(),
])
export type CameraStageCharacterPlace = z.infer<typeof cameraStageCharacterPlaceSchema>

const atSchema = z.number().nonnegative().max(3600).optional()
  .describe('这一拍从第几秒开始；省略时紧接上一拍（第一拍省略时从 startTime 开始）')

const towardSchema = z.union([
  cameraStageCharacterPlaceSchema,
  z.object({ yaw: z.number().finite().describe('朝向角（度）：0 朝 +Z，90 朝 +X') }).strict(),
])

export const cameraStageCharacterBeatSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move'),
    to: cameraStageCharacterPlaceSchema.describe('走到哪里'),
    via: z.array(cameraStageCharacterPlaceSchema).max(64).default([]).describe('依次经过的途经点'),
    gait: z.enum(GAIT_NAMES).optional()
      .describe('步态：walk 走（默认 1.3 米/秒）、formal_walk 端正地走、crouch_walk 蹲着走、jog 跑（3 米/秒）、sprint 冲刺（7 米/秒）；省略时按速度选'),
    speed: z.number().positive().max(12).optional().describe('平均速度（米/秒）；和 duration、endTime 三选一，都省略时取步态的默认速度'),
    duration: z.number().positive().max(3600).optional().describe('走多久（秒）'),
    endTime: z.number().positive().max(3600).optional().describe('第几秒走到'),
    at: atSchema,
    avoidObstacles: z.boolean().default(true).describe('绕开挡路的对象；false 时照直走并报告穿过了谁'),
  }).strict(),
  z.object({
    kind: z.literal('turn'),
    toward: towardSchema.describe('转向哪里：一个地点或对象（含摄像机），或绝对朝向 yaw'),
    duration: z.number().positive().max(30).optional().describe('转身用时（秒）；省略按角度，转 180° 约 1 秒'),
    at: atSchema,
  }).strict(),
  z.object({
    kind: z.literal('action'),
    action: z.enum(ACTION_NAMES).describe('动作：' + Object.entries(CAMERA_STAGE_CHARACTER_ACTIONS).map(([name, { label }]) => `${name} ${label}`).join('、')),
    duration: z.number().positive().max(3600).optional()
      .describe('这一拍占多久（秒）。一次性动作省略时为动作本身的长度；循环动作（说话、坐着、跳舞）省略时一直做到下一拍，给了就做这么久后回到之前的动作'),
    at: atSchema,
  }).strict(),
  z.object({
    kind: z.literal('wait'),
    duration: z.number().positive().max(3600).describe('原地停多久（秒），保持当前动作'),
  }).strict(),
])
export type CameraStageCharacterBeat = z.infer<typeof cameraStageCharacterBeatSchema>

export const cameraStageBlockingIntentShape = {
  characterId: z.string().min(1).describe('角色 id（取自观察结果）'),
  startTime: z.number().nonnegative().max(3600).default(0).describe('第一拍从第几秒开始；省略为 0'),
  beats: z.array(cameraStageCharacterBeatSchema).min(1).max(64)
    .describe('按顺序的节拍：move 走到某处、turn 转向、action 做动作、wait 停一会。例：走到门口停下转身挥手 = move → turn（朝摄像机）→ action wave'),
}

export function refineCameraStageBlocking(input: { beats: Array<{ kind: string; speed?: number; duration?: number; endTime?: number }> }, context: z.RefinementCtx): void {
  input.beats.forEach((beat, index) => {
    if (beat.kind !== 'move') return
    const given = [beat.speed, beat.duration, beat.endTime].filter((value) => value !== undefined).length
    if (given > 1) context.addIssue({ code: 'custom', path: ['beats', index], message: 'speed、duration、endTime 只能给一个' })
  })
}

const beatResultSchema = z.object({
  kind: z.enum(['move', 'turn', 'action', 'wait']),
  startTime: z.number(),
  endTime: z.number(),
  summary: z.string().describe('这一拍实际做了什么'),
  position: cameraStageVec3Schema.describe('这一拍结束时角色的位置'),
  facing: z.number().describe('这一拍结束时的朝向（度，0 朝 +Z、90 朝 +X）'),
  route: z.object({
    length: z.number().describe('实际路线长度（米）'),
    averageSpeed: z.number().describe('平均速度（米/秒）'),
    gait: z.enum(GAIT_NAMES),
    playbackRate: z.number().describe('走跑动作相对原速放慢/加快的倍数；按路程推进，脚不打滑'),
    detourPoints: z.number().int().describe('为绕开障碍加的拐点数'),
    crossings: z.array(z.object({ objectId: z.string(), name: z.string() }).strict()).describe('路线仍穿过的对象'),
  }).strict().optional(),
  action: z.object({ name: z.enum(ACTION_NAMES), clip: z.string(), followUp: z.string().nullable() }).strict().optional(),
}).strict()

export const cameraStageBlockingResultShape = {
  characterId: z.string(),
  stateKeyframeIds: z.array(z.string()).describe('写入或新建的状态关键帧'),
  createdStateKeyframes: z.number().int(),
  beats: z.array(beatResultSchema),
  laterStateKeyframesAligned: z.number().int().describe('之后已有的状态关键帧里，角色位置与朝向改成走位终点的张数（否则角色会走回原处）'),
  blockingHint: z.string().optional().describe('穿过障碍、速度过快或打断了其他对象运动时的提示'),
}

/* ── 跟拍 ─────────────────────────────────────────────────────────── */

export const cameraStageFollowIntentShape = {
  cameraId: z.string().min(1).describe('跟拍的摄像机 id'),
  subjectId: z.string().min(1).describe('被跟的角色或对象 id'),
  startTime: z.number().nonnegative().max(3600).describe('从第几秒开始跟'),
  endTime: z.number().positive().max(3600).describe('跟到第几秒；主体停下后多留一秒让机位稳住'),
  size: z.enum(CAMERA_STAGE_SHOT_SIZES).default('medium').describe('保持的景别，取值同 compose_camera_stage_shot'),
  position: z.enum(CAMERA_STAGE_SHOT_POSITIONS).default('auto').describe('主体在画面中的位置；auto 按行进方向在前方留空'),
  view: z.enum(CAMERA_STAGE_SHOT_VIEWS).default('back')
    .describe('相对行进方向从哪一面拍：back 跟在身后、front 在前面倒退着拍、left/right 侧面平行跟、front_left/front_right 斜前方'),
  angle: z.enum(CAMERA_STAGE_SHOT_ANGLES).default('eye_level'),
  lens: z.enum(CAMERA_STAGE_SHOT_LENSES).default('standard'),
  frame: z.enum(['travel', 'world']).default('travel')
    .describe('travel 机位随行进方向转（跟在身后、侧跟随路线转弯）；world 机位方向不变（沿街平移、固定方向的侧跟）'),
  lag: z.number().min(0).max(5).default(0.5).describe('机位跟随主体的滞后（秒），0 为硬贴；朝向另由摄像机的注视跟随滞后控制'),
  avoidOcclusion: z.boolean().default(true).describe('预判整段跟拍里主体会不会被挡，被挡就在附近换个方位或抬高机位'),
}

const occlusionSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  occludedBy: z.array(z.object({ objectId: z.string(), name: z.string() }).strict()),
}).strict()

export const cameraStageFollowResultShape = {
  cameraId: z.string(),
  subjectId: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  offset: cameraStageVec3Schema.describe('机位相对主体的偏移（参照系里，+Z 为行进方向）'),
  adjusted: z.object({ azimuthDegrees: z.number(), raised: z.number(), visibleFraction: z.number(), summary: z.string() }).strict().nullable()
    .describe('为避开遮挡改了方位或高度；没改为 null'),
  samples: z.array(z.object({
    time: z.number(),
    shotSize: z.enum(CAMERA_STAGE_SHOT_SIZES).nullable(),
    heightRatio: z.number().nullable(),
    horizontal: z.enum(['left', 'center', 'right', 'outside']),
    keyVisible: z.boolean(),
  }).strict()).describe('整段跟拍里均匀取的几帧实际构图'),
  occlusions: z.array(occlusionSchema).describe('预判到的被挡时段与遮挡者'),
  followHint: z.string().optional(),
}
