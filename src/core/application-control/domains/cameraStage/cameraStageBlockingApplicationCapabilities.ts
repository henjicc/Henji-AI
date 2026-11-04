import { z } from 'zod'

import { capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'
import {
  CONFLICT_RECOVERY,
  cameraStageControl,
  cameraStageDocumentIdSchema,
  cameraStageTarget,
  cameraStageTransactionResultShape,
} from './cameraStageCapabilitySchemas'
import {
  cameraStageBlockingIntentShape,
  cameraStageBlockingResultShape,
  cameraStageFollowIntentShape,
  cameraStageFollowResultShape,
  refineCameraStageBlocking,
} from './cameraStageBlockingSchemas'

export const BLOCK_CAMERA_STAGE_CHARACTER_CAPABILITY_ID = 'block_camera_stage_character'
export const FOLLOW_CAMERA_STAGE_CHARACTER_CAPABILITY_ID = 'follow_camera_stage_character'

export const blockCameraStageCharacterCapability = defineApplicationCapability({
  id: BLOCK_CAMERA_STAGE_CHARACTER_CAPABILITY_ID,
  resolveOperationTargets: input => [{ kind: 'camera_stage.document', id: input.documentId }],
  version: 1,
  title: '编排角色走位与动作',
  description: '按顺序的节拍给角色排走位和动作：走到某处（途经点或对象，按时长、到达时刻或步速）、转向、做动作库里的动作、停一会。'
    + '应用绕开挡路的对象规划路线，起步停下自然加减速，朝向沿前进方向平滑转；走跑动作按走过的路程推进，脚不打滑；动作之间交叉淡入淡出。'
    + '每一拍写成状态关键帧，一次调用一个撤销点。结果读回每一拍的实际时间、位置、朝向、路线长度、速度与仍穿过的对象。',
  domain: 'camera_stage',
  aliases: ['走位', '角色走位', '走过去', '跑过去', '转身', '挥手', '坐下', '角色动作', '调度演员', 'blocking', 'walk to', 'character action'],
  readOnly: false, dataClasses: ['C1'], idempotent: true, destructive: false,
  timeoutMs: 30_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['camera_stage'],
  acceptsRefs: ['camera_stage.document', 'camera_stage.object', 'camera_stage.state_keyframe'],
  producesRefs: ['camera_stage.object', 'camera_stage.state_keyframe'],
  successEvidence: ['结果 beats[] 是写入后按编译产物读回的每一拍：起止时刻、终点位置与朝向；走动附路线长度、平均速度、步态、动作放慢倍数与仍穿过的对象。'],
  failureRecovery: [
    CONFLICT_RECOVERY,
    '角色或地点对象 id 不对时按错误里列出的可用 id 重试；某一拍的 at 早于上一拍结束时改 at 或去掉它。',
    '路线仍穿过对象时换途经点绕开，或把目的地挪到空地。',
  ],
  inputSchema: z.object({ documentId: cameraStageDocumentIdSchema, ...cameraStageBlockingIntentShape }).strict().superRefine(refineCameraStageBlocking),
  outputSchema: capabilityOutputSchema({ ...cameraStageTransactionResultShape, ...cameraStageBlockingResultShape }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.documentId}`,
  resolveTargetIds: (input) => cameraStageTarget(input.documentId, { objectId: input.characterId }),
  control: cameraStageControl('execute', ['camera_stage.object'], [
    'camera_stage.object.transform.position', 'camera_stage.object.transform.rotation',
  ], ['camera_stage'], [
    { effect: 'create', entityTypes: ['camera_stage.state_keyframe'] },
    { effect: 'update', entityTypes: ['camera_stage.object', 'camera_stage.state_keyframe'] },
  ]),
  summarize: (output) => `角色走位事务 ${output.transactionRef} 已完成。`,
})

export const followCameraStageCharacterCapability = defineApplicationCapability({
  id: FOLLOW_CAMERA_STAGE_CHARACTER_CAPABILITY_ID,
  resolveOperationTargets: input => [{ kind: 'camera_stage.document', id: input.documentId }],
  version: 1,
  title: '摄像机跟拍角色',
  description: '让摄像机在一段时间里跟着走动的角色拍，保持景别和主体在画面中的位置（取值同 compose_camera_stage_shot）。'
    + '机位略慢半拍地跟着主体走，不逐帧硬贴；朝向叠加摄像机的注视跟随滞后。'
    + '默认预判整段跟拍里主体会不会被挡，被挡就在附近换方位或抬高并报告；结果读回整段里几帧的实际景别、画面位置与被挡时段。',
  domain: 'camera_stage',
  aliases: ['跟拍', '跟镜头', '跟随拍摄', '跟着角色', '侧跟', '前跟', 'follow shot', 'tracking shot'],
  readOnly: false, dataClasses: ['C1'], idempotent: true, destructive: false,
  timeoutMs: 30_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['camera_stage'],
  acceptsRefs: ['camera_stage.document', 'camera_stage.camera', 'camera_stage.object', 'camera_stage.state_keyframe'],
  producesRefs: ['camera_stage.camera', 'camera_stage.state_keyframe'],
  successEvidence: ['结果 samples[] 是写入后按编译产物读回的实际构图；occlusions[] 是预判到的被挡时段；adjusted 说明为避开遮挡改了什么。'],
  failureRecovery: [
    CONFLICT_RECOVERY,
    '摄像机或主体 id 不对时按错误里列出的可用 id 重试；endTime 必须晚于 startTime。',
    '被挡时段无法避开时换 view、抬高 angle 或缩短跟拍时段。',
  ],
  inputSchema: z.object({ documentId: cameraStageDocumentIdSchema, ...cameraStageFollowIntentShape }).strict()
    .refine((input) => input.endTime > input.startTime, { path: ['endTime'], message: 'endTime 必须晚于 startTime' }),
  outputSchema: capabilityOutputSchema({ ...cameraStageTransactionResultShape, ...cameraStageFollowResultShape }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.documentId}`,
  resolveTargetIds: (input) => cameraStageTarget(input.documentId, { cameraId: input.cameraId }),
  control: cameraStageControl('execute', ['camera_stage.camera'], [
    'camera_stage.camera.transform.position', 'camera_stage.camera.look_at_target', 'camera_stage.camera.fov',
  ], ['camera_stage'], [
    { effect: 'create', entityTypes: ['camera_stage.state_keyframe'] },
    { effect: 'update', entityTypes: ['camera_stage.camera', 'camera_stage.state_keyframe'] },
  ]),
  summarize: (output) => `跟拍事务 ${output.transactionRef} 已完成。`,
})
