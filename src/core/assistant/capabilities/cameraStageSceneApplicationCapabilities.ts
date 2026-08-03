import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import { capabilityOutputSchema, defineApplicationCapability } from './defineApplicationCapability'
import {
  CONFLICT_RECOVERY,
  cameraStageBaseRevisionSchema,
  cameraStageControl,
  cameraStageObjectUpdateSchema,
  cameraStagePlacementSchema,
  cameraStageTarget,
  cameraStageTransactionResultShape,
} from './cameraStageCapabilitySchemas'

const observeScene = defineApplicationCapability({
  id: 'observe_camera_stage_scene', version: 1, title: '观察 3D 场景状态',
  description: '读取工程对象、摄像机、镜头、边界盒、轨迹、关键帧和碰撞摘要。', domain: 'camera_stage',
  aliases: ['观察三维场景', '场景状态', '摄像机和对象', 'observe 3D scene'], readOnly: true, risk: 'R0', dataClasses: ['C1'],
  permission: 'camera_stage:read', idempotent: true, destructive: false, timeoutMs: 10_000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['toolbox'], acceptsRefs: ['camera_stage.project'],
  producesRefs: ['camera_stage.project', 'camera_stage.scene', 'camera_stage.object', 'camera_stage.camera', 'camera_stage.shot', 'camera_stage.trajectory', 'camera_stage.keyframe'],
  inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: capabilityOutputSchema({ scene: z.record(z.string(), z.unknown()), baseRevision: cameraStageBaseRevisionSchema }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.projectId}:observe`, resolveTargetIds: (input) => cameraStageTarget(input.projectId),
  control: cameraStageControl('observe', ['camera_stage.scene', 'camera_stage.object', 'camera_stage.camera', 'camera_stage.shot', 'camera_stage.trajectory', 'camera_stage.keyframe']),
  summarize: (output) => `已观察 3D 工程 ${String(output.scene.projectId ?? '')} 的场景状态。`,
})

const placeObject = defineApplicationCapability({
  id: 'place_camera_stage_object', version: 1, title: '复用或布置 3D 场景对象',
  description: '先按稳定引用和角色复用已有对象；确需新建时按边界盒与空间关系选择位置。', domain: 'camera_stage',
  aliases: ['添加 3D 物体', '摆放三维对象', '复用默认摄像机', '无冲突布局', 'place 3D object'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'camera_stage:write', idempotent: false, destructive: false,
  timeoutMs: 15_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['toolbox'],
  acceptsRefs: ['camera_stage.project', 'camera_stage.object', 'camera_stage.camera'], producesRefs: ['camera_stage.object', 'camera_stage.camera'],
  successEvidence: ['事务证据包含 reused 或 created 决策、最终位置、边界盒、冲突列表和稳定对象引用。'],
  failureRecovery: [CONFLICT_RECOVERY],
  inputSchema: z.object({
    projectId: z.string().min(1), baseRevision: cameraStageBaseRevisionSchema,
    objectId: z.string().min(1).optional(), objectType: z.enum(['primitive', 'character', 'camera']),
    primitiveKind: z.enum(['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus']).optional(),
    name: z.string().trim().min(1).max(120).optional(), role: z.enum(['subject', 'prop', 'character', 'camera', 'environment']).optional(),
    reusePolicy: z.enum(['prefer_existing', 'require_new']).default('prefer_existing'),
    placement: cameraStagePlacementSchema.default({ mode: 'auto', spacing: 0.35, allowOverlap: false }),
  }).strict().superRefine((input, context) => {
    if (input.objectType === 'primitive' && !input.primitiveKind) context.addIssue({ code: 'custom', path: ['primitiveKind'], message: '基础几何体必须声明类型' })
    if (input.objectType !== 'primitive' && input.primitiveKind) context.addIssue({ code: 'custom', path: ['primitiveKind'], message: '仅基础几何体可声明类型' })
  }),
  outputSchema: capabilityOutputSchema(cameraStageTransactionResultShape),
  resolveConcurrencyKey: (input) => `camera_stage:${input.projectId}`, resolveTargetIds: (input) => cameraStageTarget(input.projectId),
  control: cameraStageControl('execute', ['camera_stage.scene', 'camera_stage.object', 'camera_stage.camera'], [
    'camera_stage.object.transform.position', 'camera_stage.object.transform.rotation', 'camera_stage.object.transform.scale',
    'camera_stage.camera.transform.position', 'camera_stage.camera.transform.rotation',
  ]),
  summarize: (output) => `3D 对象布置事务 ${output.transactionRef} 已完成。`,
})

const duplicateObject = defineApplicationCapability({
  id: 'duplicate_camera_stage_object', version: 2, title: '复制 3D 场景对象', description: '复制明确对象并保存为具有唯一名称的新对象。',
  domain: 'camera_stage', aliases: ['复制 3D 物体', 'duplicate camera object'], readOnly: false, risk: 'R1', dataClasses: ['C1'],
  permission: 'camera_stage:write', idempotent: false, destructive: false, timeoutMs: 10_000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['toolbox'], acceptsRefs: ['camera_stage.project', 'camera_stage.object', 'camera_stage.camera'], producesRefs: ['camera_stage.object', 'camera_stage.camera'],
  failureRecovery: [CONFLICT_RECOVERY],
  inputSchema: z.object({ projectId: z.string().min(1), objectId: z.string().min(1), baseRevision: cameraStageBaseRevisionSchema }).strict(),
  outputSchema: capabilityOutputSchema({ projectId: z.string(), objectId: z.string(), duplicatedFromObjectId: z.string(), undoRef: z.string().optional(), baseRevision: cameraStageBaseRevisionSchema }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.projectId}`, resolveTargetIds: (input) => cameraStageTarget(input.projectId, { objectId: input.objectId }),
  control: cameraStageControl('create', ['camera_stage.object', 'camera_stage.camera']),
  summarize: (output) => `已复制 3D 对象 ${output.duplicatedFromObjectId}。`,
})

const deleteObject = defineApplicationCapability({
  id: 'delete_camera_stage_object', version: 2, title: '删除 3D 场景对象', description: '永久删除明确对象并清理相关镜头与轨道引用。',
  domain: 'camera_stage', aliases: ['删除 3D 物体', 'delete camera object'], readOnly: false, risk: 'R3', dataClasses: ['C1'],
  permission: 'camera_stage:delete', idempotent: true, destructive: true, timeoutMs: 10_000, supportsPreview: true, supportsUndo: false,
  requiredScopes: ['toolbox'], acceptsRefs: ['camera_stage.project', 'camera_stage.object', 'camera_stage.camera'],
  failureRecovery: [CONFLICT_RECOVERY],
  inputSchema: z.object({ projectId: z.string().min(1), objectId: z.string().min(1), baseRevision: cameraStageBaseRevisionSchema }).strict(),
  outputSchema: capabilityOutputSchema({ projectId: z.string(), objectId: z.string(), status: z.literal('deleted'), baseRevision: cameraStageBaseRevisionSchema }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.projectId}:${input.objectId}`, resolveTargetIds: (input) => cameraStageTarget(input.projectId, { objectId: input.objectId }),
  preview: (input) => ({ title: '删除 3D 场景对象', summary: `永久删除对象 ${input.objectId}。`, targetIds: cameraStageTarget(input.projectId, { objectId: input.objectId }), reversible: false, dataClasses: ['C1'] }),
  control: cameraStageControl('delete', ['camera_stage.object', 'camera_stage.camera']),
  summarize: (output) => `3D 对象 ${output.objectId} 已删除。`,
})

const updateObject = defineApplicationCapability({
  id: 'update_camera_stage_object', version: 2, title: '更新 3D 场景对象',
  description: '只修改 schema 明确列出的对象或摄像机属性，并通过 revision 事务提交。', domain: 'camera_stage',
  aliases: ['修改 3D 物体', '调整摄像机参数', 'update camera object'], readOnly: false, risk: 'R1', dataClasses: ['C1'],
  permission: 'camera_stage:write', idempotent: true, destructive: false, timeoutMs: 15_000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['toolbox'], acceptsRefs: ['camera_stage.project', 'camera_stage.object', 'camera_stage.camera'], producesRefs: ['camera_stage.object', 'camera_stage.camera'],
  failureRecovery: [CONFLICT_RECOVERY],
  inputSchema: z.object({ projectId: z.string().min(1), objectId: z.string().min(1), baseRevision: cameraStageBaseRevisionSchema, changes: cameraStageObjectUpdateSchema }).strict(),
  outputSchema: capabilityOutputSchema(cameraStageTransactionResultShape),
  resolveConcurrencyKey: (input) => `camera_stage:${input.projectId}:${input.objectId}`, resolveTargetIds: (input) => cameraStageTarget(input.projectId, { objectId: input.objectId }),
  control: cameraStageControl('update', ['camera_stage.object', 'camera_stage.camera'], [
    'camera_stage.object.name', 'camera_stage.object.visible', 'camera_stage.object.color', 'camera_stage.object.transform.position',
    'camera_stage.object.transform.rotation', 'camera_stage.object.transform.scale', 'camera_stage.object.character_variant',
    'camera_stage.camera.name', 'camera_stage.camera.visible', 'camera_stage.camera.transform.position', 'camera_stage.camera.transform.rotation',
    'camera_stage.camera.fov', 'camera_stage.camera.look_at_target', 'camera_stage.camera.look_at_object_ref',
    'camera_stage.camera.aspect_ratio_preset', 'camera_stage.camera.aspect_ratio',
  ]),
  summarize: (output) => `3D 对象更新事务 ${output.transactionRef} 已完成。`,
})

const addShot = defineApplicationCapability({
  id: 'add_camera_stage_shot', version: 2, title: '添加 3D 镜头卡', description: '在工程中捕获一张具有唯一名称和明确机位的镜头卡。',
  domain: 'camera_stage', aliases: ['添加镜头卡', 'add camera shot'], readOnly: false, risk: 'R1', dataClasses: ['C1'],
  permission: 'camera_stage:write', idempotent: false, destructive: false, timeoutMs: 10_000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['toolbox'], acceptsRefs: ['camera_stage.project', 'camera_stage.camera'], producesRefs: ['camera_stage.shot'],
  failureRecovery: [CONFLICT_RECOVERY],
  inputSchema: z.object({ projectId: z.string().min(1), name: z.string().trim().min(1).max(120), cameraId: z.string().min(1).nullable().default(null), baseRevision: cameraStageBaseRevisionSchema }).strict(),
  outputSchema: capabilityOutputSchema({ projectId: z.string(), shotId: z.string(), name: z.string(), undoRef: z.string().optional(), baseRevision: cameraStageBaseRevisionSchema }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.projectId}:shots`, resolveTargetIds: (input) => cameraStageTarget(input.projectId, { name: input.name }),
  control: cameraStageControl('create', ['camera_stage.shot']), summarize: (output) => `已添加镜头卡 ${output.shotId}。`,
})

const updateShot = defineApplicationCapability({
  id: 'update_camera_stage_shot', version: 2, title: '更新 3D 镜头卡', description: '修改明确镜头的名称、时间、连续性和机位。',
  domain: 'camera_stage', aliases: ['修改镜头卡', 'update camera shot'], readOnly: false, risk: 'R1', dataClasses: ['C1'],
  permission: 'camera_stage:write', idempotent: true, destructive: false, timeoutMs: 10_000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['toolbox'], acceptsRefs: ['camera_stage.project', 'camera_stage.shot', 'camera_stage.camera'], producesRefs: ['camera_stage.shot'],
  failureRecovery: [CONFLICT_RECOVERY],
  inputSchema: z.object({
    projectId: z.string().min(1), shotId: z.string().min(1), baseRevision: cameraStageBaseRevisionSchema,
    changes: z.object({ name: z.string().trim().min(1).max(120).optional(), hold: z.number().min(0).max(3600).optional(), transitionDuration: z.number().min(0).max(3600).optional(), continuity: z.enum(['stop', 'smooth']).optional(), cameraId: z.string().min(1).nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0),
  }).strict(),
  outputSchema: capabilityOutputSchema(cameraStageTransactionResultShape),
  resolveConcurrencyKey: (input) => `camera_stage:${input.projectId}:shot:${input.shotId}`, resolveTargetIds: (input) => cameraStageTarget(input.projectId, { shotId: input.shotId }),
  control: cameraStageControl('update', ['camera_stage.shot'], ['camera_stage.shot.name', 'camera_stage.shot.hold', 'camera_stage.shot.transition_duration', 'camera_stage.shot.continuity', 'camera_stage.shot.camera_ref']),
  summarize: (output) => `3D 镜头更新事务 ${output.transactionRef} 已完成。`,
})

export const CAMERA_STAGE_SCENE_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  observeScene, placeObject, duplicateObject, deleteObject, updateObject, addShot, updateShot,
]
