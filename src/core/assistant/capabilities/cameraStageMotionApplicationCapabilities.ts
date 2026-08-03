import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import { capabilityOutputSchema, defineApplicationCapability } from './defineApplicationCapability'
import {
  cameraStageBaseRevisionSchema,
  cameraStageControl,
  cameraStageMoveSchema,
  cameraStageTarget,
  CONFLICT_RECOVERY,
  cameraStageTransactionResultShape,
  cameraStageVec3Schema,
} from './cameraStageCapabilitySchemas'

const applyCameraMove = defineApplicationCapability({
  id: 'apply_camera_stage_camera_move', version: 1, title: '应用摄像机语义运镜',
  description: '按摄像机、注视目标、时间、方向、距离和缓动应用环绕、推拉、横移或升降轨迹。', domain: 'camera_stage',
  aliases: ['环绕主体', '推近拉远', '横移镜头', '升降镜头', 'orbit', 'dolly', 'truck', 'crane', 'camera move'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'camera_stage:write', idempotent: true, destructive: false,
  timeoutMs: 20_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['toolbox'],
  acceptsRefs: ['camera_stage.project', 'camera_stage.camera', 'camera_stage.object', 'camera_stage.shot'],
  producesRefs: ['camera_stage.camera', 'camera_stage.shot', 'camera_stage.trajectory', 'camera_stage.keyframe'],
  successEvidence: ['事务返回路径起终点、采样数、受影响镜头和关键帧数量，并提供可撤销引用。'],
  failureRecovery: [
    CONFLICT_RECOVERY,
    '缺少目标、摄像机或有效时间范围时停止，重新观察场景后使用稳定引用；不得猜测名称。',
  ],
  inputSchema: z.object({
    projectId: z.string().min(1), cameraId: z.string().min(1), baseRevision: cameraStageBaseRevisionSchema,
    move: cameraStageMoveSchema, targetObjectId: z.string().min(1).optional(), targetPoint: cameraStageVec3Schema.optional(),
    startShotId: z.string().min(1).optional(), endShotId: z.string().min(1).optional(), startTime: z.number().min(0).max(3600).optional(),
    duration: z.number().positive().max(3600), speed: z.enum(['uniform', 'easeInOut', 'fastStart', 'slowStart']).default('easeInOut'),
  }).strict().superRefine((input, context) => {
    if (input.targetObjectId && input.targetPoint) context.addIssue({ code: 'custom', path: ['targetPoint'], message: '注视对象和注视点只能选择一种' })
    if (input.move.kind !== 'crane' && !input.targetObjectId && !input.targetPoint) context.addIssue({ code: 'custom', path: ['targetObjectId'], message: '该运镜必须声明注视对象或注视点' })
  }),
  outputSchema: capabilityOutputSchema(cameraStageTransactionResultShape),
  resolveConcurrencyKey: (input) => `camera_stage:${input.projectId}:camera:${input.cameraId}`,
  resolveTargetIds: (input) => cameraStageTarget(input.projectId, { cameraId: input.cameraId }),
  control: cameraStageControl('execute', ['camera_stage.camera', 'camera_stage.shot', 'camera_stage.trajectory', 'camera_stage.keyframe'], [
    'camera_stage.camera.look_at_target', 'camera_stage.camera.look_at_object_ref',
    'camera_stage.camera.transform.position', 'camera_stage.shot.transition_duration',
  ]),
  summarize: (output) => `摄像机运镜事务 ${output.transactionRef} 已完成。`,
})

const verifyScene = defineApplicationCapability({
  // v2：移除 requireVisualPreview 与 visual 输出。预览引用不会进入模型视野，
  // 保留它只会诱导模型误以为“已经看过画面”。构图类判断改为再调一次
  // observe_application_surface 取真实截图。
  id: 'verify_camera_stage_scene', version: 2, title: '验证 3D 场景结果',
  description: '结构化验证对象复用、边界盒布局、活动摄像机、轨迹和关键帧；构图是否好看需另行观察界面截图判断。',
  domain: 'camera_stage', aliases: ['验证三维场景', '检查运镜结果', '检查构图', 'verify 3D scene'], readOnly: true, risk: 'R0', dataClasses: ['C1'],
  permission: 'camera_stage:read', idempotent: true, destructive: false, timeoutMs: 15_000, supportsPreview: true, supportsUndo: false,
  requiredScopes: ['toolbox'], acceptsRefs: ['camera_stage.project', 'camera_stage.object', 'camera_stage.camera', 'camera_stage.trajectory'],
  producesRefs: ['camera_stage.project', 'camera_stage.object', 'camera_stage.camera', 'camera_stage.trajectory'],
  inputSchema: z.object({
    projectId: z.string().min(1), expectedObjectIds: z.array(z.string().min(1)).max(128).default([]),
    expectedCameraId: z.string().min(1).optional(), expectedMoveKind: z.enum(['orbit', 'dollyIn', 'dollyOut', 'truck', 'crane']).optional(),
    requireNoCollisions: z.boolean().default(true),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    verified: z.boolean(), evidence: z.array(z.record(z.string(), z.unknown())), unmetConditions: z.array(z.string()), checkedAt: z.string(),
    baseRevision: cameraStageBaseRevisionSchema,
  }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.projectId}:verify`, resolveTargetIds: (input) => cameraStageTarget(input.projectId),
  control: cameraStageControl('observe', ['camera_stage.scene', 'camera_stage.object', 'camera_stage.camera', 'camera_stage.trajectory', 'camera_stage.keyframe']),
  summarize: (output) => output.verified ? '3D 场景结构化验证已通过。' : `3D 场景仍有 ${output.unmetConditions.length} 项未满足。`,
})

// 三维视口截图统一走 observe_application_surface：它会自动定位 camera_stage 的专用
// 观察区域，并把结果转成模型真正能读的媒体附件。此前的 observe_camera_stage_viewport
// 只返回媒体引用、像素永远进不了模型，已随第六阶段全域观察一并废除。
export const CAMERA_STAGE_MOTION_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  applyCameraMove, verifyScene,
]
