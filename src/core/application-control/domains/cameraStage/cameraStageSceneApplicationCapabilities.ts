import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'
import {
  CAMERA_STAGE_NAME_MAX_LENGTH,
  CONFLICT_RECOVERY,
  cameraStageDocumentIdSchema,
  cameraStageControl,
  cameraStageObjectUpdateSchema,
  cameraStagePlacementSchema,
  cameraStageTarget,
  cameraStageTransactionResultShape,
} from './cameraStageCapabilitySchemas'
import { cameraStageSetLayoutSchema } from './cameraStageSetSchemas'

const observeScene = defineApplicationCapability({
  id: 'observe_camera_stage_scene', version: 1, title: '观察 3D 场景状态',
  description: '读取镜头参考对象、摄像机、状态关键帧、边界盒、轨迹和碰撞摘要。生成的布景只给摘要（id、数量、范围、参数），不逐个列出成员。', domain: 'camera_stage',
  aliases: ['观察三维场景', '场景状态', '摄像机和对象', 'observe 3D scene'], readOnly: true, dataClasses: ['C1'],
  idempotent: true, destructive: false, timeoutMs: 10_000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['camera_stage'], acceptsRefs: ['camera_stage.document'],
  producesRefs: ['camera_stage.document', 'camera_stage.scene', 'camera_stage.object', 'camera_stage.camera', 'camera_stage.set', 'camera_stage.state_keyframe', 'camera_stage.trajectory'],
  inputSchema: z.object({ documentId: cameraStageDocumentIdSchema }).strict(),
  outputSchema: capabilityOutputSchema({ scene: z.record(z.string(), z.unknown()) }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.documentId}:observe`, resolveTargetIds: (input) => cameraStageTarget(input.documentId),
  control: cameraStageControl('observe', ['camera_stage.scene', 'camera_stage.object', 'camera_stage.camera', 'camera_stage.set', 'camera_stage.state_keyframe', 'camera_stage.trajectory']),
  summarize: (output) => `已观察镜头参考 ${String(output.scene.documentId ?? '')} 的场景状态。`,
})

const placeObject = defineApplicationCapability({
  id: 'place_camera_stage_object',
  resolveOperationTargets: input => [{ kind: 'camera_stage.document', id: input.documentId }],
  resolveOperationAppendTargets: input => input.reusePolicy === 'require_new' ? [{ kind: 'camera_stage.document', id: input.documentId }] : [],
  version: 1, title: '复用或布置 3D 场景对象',
  description: '先按稳定引用和角色复用已有对象；确需新建时按边界盒与空间关系选择位置。', domain: 'camera_stage',
  aliases: ['添加 3D 物体', '摆放三维对象', '复用默认摄像机', '无冲突布局', 'place 3D object'],
  readOnly: false, dataClasses: ['C1'], idempotent: false, destructive: false,
  timeoutMs: 15_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['camera_stage'],
  acceptsRefs: ['camera_stage.document', 'camera_stage.object', 'camera_stage.camera'], producesRefs: ['camera_stage.object', 'camera_stage.camera'],
  successEvidence: ['事务证据包含 reused 或 created 决策、最终位置、边界盒、冲突列表和稳定对象引用。'],
  failureRecovery: [CONFLICT_RECOVERY],
  inputSchema: z.object({
    documentId: cameraStageDocumentIdSchema,
    objectId: z.string().min(1).optional(), objectType: z.enum(['primitive', 'character', 'camera']),
    primitiveKind: z.enum(['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus']).optional(),
    name: z.string().trim().min(1).max(CAMERA_STAGE_NAME_MAX_LENGTH).optional(), role: z.enum(['subject', 'prop', 'character', 'camera', 'environment']).optional(),
    reusePolicy: z.enum(['prefer_existing', 'require_new']).default('prefer_existing'),
    placement: cameraStagePlacementSchema.default({ mode: 'auto', spacing: 0.35, allowOverlap: false }),
  }).strict().superRefine((input, context) => {
    if (input.objectType === 'primitive' && !input.primitiveKind) context.addIssue({ code: 'custom', path: ['primitiveKind'], message: '基础几何体必须声明类型' })
    if (input.objectType !== 'primitive' && input.primitiveKind) context.addIssue({ code: 'custom', path: ['primitiveKind'], message: '仅基础几何体可声明类型' })
  }),
  outputSchema: capabilityOutputSchema(cameraStageTransactionResultShape),
  resolveConcurrencyKey: (input) => `camera_stage:${input.documentId}`, resolveTargetIds: (input) => cameraStageTarget(input.documentId),
  /*
   * 这条能力是「场景里凭空多出一个物体」的**唯一**入口（几何体、角色、摄像机都走它），
   * 但它此前只声明 execute——于是一个声明了 mutate/create 的 Facet 根本发现不了它，模型
   * 手里只剩复制和删除，只能如实回答"加不了球"。effect 少声明一条，对模型就是能力不存在。
   *
   * reusePolicy 命中已有对象时这次调用其实没有新建，但 Facet 关心的是"场景里有没有这个
   * 对象"，复用同样达成，所以 create 照记不虚报。
   */
  control: cameraStageControl('execute', ['camera_stage.scene', 'camera_stage.object', 'camera_stage.camera'], [
    'camera_stage.object.transform.position', 'camera_stage.object.transform.rotation', 'camera_stage.object.transform.scale',
    'camera_stage.camera.transform.position', 'camera_stage.camera.transform.rotation',
  ], ['camera_stage'], [
    { effect: 'create', entityTypes: ['camera_stage.object', 'camera_stage.camera'] },
  ]),
  summarize: (output) => `3D 对象布置事务 ${output.transactionRef} 已完成。`,
})

export const GENERATE_CAMERA_STAGE_SET_CAPABILITY_ID = 'generate_camera_stage_set'

const generateSet = defineApplicationCapability({
  id: GENERATE_CAMERA_STAGE_SET_CAPABILITY_ID,
  resolveOperationTargets: input => [{ kind: 'camera_stage.document', id: input.documentId }],
  resolveOperationAppendTargets: input => [{ kind: 'camera_stage.document', id: input.documentId }],
  version: 1, title: '生成 3D 布景',
  description: '按意图参数一次生成一整片按真实城市尺度的抽象布景：城市（方格城市、国内新城超级街区、欧式老城三种风格，'
    + '分级道路、楼高按层、裙楼加塔楼）、街道、广场或人群阵列；默认带人行道、车道线、行道树、路灯和车辆作比例参照物。'
    + '一次调用一个撤销点、一次存盘；楼与人是普通对象，可以逐个修改。给 replaceSetId 时整体重新生成那片布景，省略的参数沿用它上一次的值。'
    + '结果只返回布景摘要（数量、范围、参照物数量、完整参数），不逐个列出成员。删除整片布景用 change_application_entities 对 camera_stage.set 执行 remove_items。',
  domain: 'camera_stage',
  aliases: ['生成城市', '城市群', '搭场景', '快速布景', '街道', '广场', '人群', '楼群', '街景', '行道树', '车流', 'generate 3D set', 'city block'],
  readOnly: false, dataClasses: ['C1'], idempotent: false, destructive: false,
  timeoutMs: 60_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['camera_stage'],
  acceptsRefs: ['camera_stage.document', 'camera_stage.set'], producesRefs: ['camera_stage.set'],
  successEvidence: ['事务证据包含布景引用、成员数量、范围边界盒与补齐后的完整参数。'],
  failureRecovery: [CONFLICT_RECOVERY, 'STAGE_SET_NOT_FOUND 时从 observe_camera_stage_scene 的 sets[].id 取布景 id，或省略 replaceSetId 新建。'],
  inputSchema: z.object({
    documentId: cameraStageDocumentIdSchema,
    layout: cameraStageSetLayoutSchema.describe('布景类型与参数，preset 必填，其余可省略'),
    name: z.string().trim().min(1).max(CAMERA_STAGE_NAME_MAX_LENGTH).optional().describe('布景名称，也是成员名称的前缀；默认按类型命名'),
    replaceSetId: z.string().min(1).optional().describe('要重新生成的布景 id：取自 observe_camera_stage_scene 返回的 sets[].id'),
  }).strict(),
  outputSchema: capabilityOutputSchema(cameraStageTransactionResultShape),
  resolveConcurrencyKey: (input) => `camera_stage:${input.documentId}`, resolveTargetIds: (input) => cameraStageTarget(input.documentId),
  control: cameraStageControl('create', ['camera_stage.set'], [], ['camera_stage'], [
    { effect: 'create', entityTypes: ['camera_stage.object'] },
  ]),
  summarize: (output) => `3D 布景生成事务 ${output.transactionRef} 已完成。`,
})

const duplicateObject = defineApplicationCapability({
  id: 'duplicate_camera_stage_object',
  resolveOperationTargets: input => [{ kind: 'camera_stage.document', id: input.documentId }],
  resolveOperationAppendTargets: input => [{ kind: 'camera_stage.document', id: input.documentId }],
  version: 2, title: '复制 3D 场景对象', description: '复制明确对象并保存为具有唯一名称的新对象。',
  domain: 'camera_stage', aliases: ['复制 3D 物体', 'duplicate camera object'], readOnly: false, dataClasses: ['C1'],
  idempotent: false, destructive: false, timeoutMs: 10_000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['camera_stage'], acceptsRefs: ['camera_stage.document', 'camera_stage.object', 'camera_stage.camera'], producesRefs: ['camera_stage.object', 'camera_stage.camera'],
  failureRecovery: [CONFLICT_RECOVERY],
  inputSchema: z.object({ documentId: cameraStageDocumentIdSchema, objectId: z.string().min(1) }).strict(),
  outputSchema: capabilityOutputSchema({ documentId: z.string(), objectId: z.string(), duplicatedFromObjectId: z.string(), undoRef: z.string().optional() }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.documentId}`, resolveTargetIds: (input) => cameraStageTarget(input.documentId, { objectId: input.objectId }),
  control: cameraStageControl('create', ['camera_stage.object', 'camera_stage.camera']),
  summarize: (output) => `已复制 3D 对象 ${output.duplicatedFromObjectId}。`,
})

const deleteObject = defineApplicationCapability({
  id: 'delete_camera_stage_object',
  resolveOperationTargets: input => [{ kind: 'camera_stage.document', id: input.documentId }, { kind: input.objectKind, id: `${input.documentId}:${input.objectId}` }],
  resolveOperationWriteTargets: input => [{ kind: input.objectKind, id: `${input.documentId}:${input.objectId}` }],
  version: 2, title: '删除 3D 场景对象', description: '永久删除明确对象并清理相关状态关键帧引用。',
  domain: 'camera_stage', aliases: ['删除 3D 物体', 'delete camera object'], readOnly: false, dataClasses: ['C1'],
  idempotent: true, destructive: true, timeoutMs: 10_000, supportsPreview: true, supportsUndo: false,
  requiredScopes: ['camera_stage'], acceptsRefs: ['camera_stage.document', 'camera_stage.object', 'camera_stage.camera'],
  failureRecovery: [CONFLICT_RECOVERY],
  inputSchema: z.object({ documentId: cameraStageDocumentIdSchema, objectId: z.string().min(1), objectKind: z.enum(['camera_stage.object', 'camera_stage.camera']).default('camera_stage.object').describe('目标实体类型；摄像机使用 camera_stage.camera。baselineIds 可省略，显式提供时核对读取时的状态。') }).strict(),
  outputSchema: capabilityOutputSchema({ documentId: z.string(), objectId: z.string(), status: z.literal('deleted') }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.documentId}:${input.objectId}`, resolveTargetIds: (input) => cameraStageTarget(input.documentId, { objectId: input.objectId }),
  preview: (input) => ({ title: '删除 3D 场景对象', summary: `永久删除对象 ${input.objectId}。`, targetIds: cameraStageTarget(input.documentId, { objectId: input.objectId }), reversible: false, dataClasses: ['C1'] }),
  control: cameraStageControl('delete', ['camera_stage.object', 'camera_stage.camera']),
  summarize: (output) => `3D 对象 ${output.objectId} 已删除。`,
})

const updateObject = defineApplicationCapability({
  id: 'update_camera_stage_object',
  external: { kind: 'delegate', entityType: 'camera_stage.object', operations: ['write'], reason: '普通数据操作由正式实体描述及 change_application_entities 通用事务承接，不另增同功能工具。' },
  version: 2, title: '更新 3D 场景对象',
  description: '只修改 schema 明确列出的对象或摄像机属性，并通过 revision 事务提交。', domain: 'camera_stage',
  aliases: ['修改 3D 物体', '调整摄像机参数', 'update camera object'], readOnly: false, dataClasses: ['C1'],
  idempotent: true, destructive: false, timeoutMs: 15_000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['camera_stage'], acceptsRefs: ['camera_stage.document', 'camera_stage.object', 'camera_stage.camera'], producesRefs: ['camera_stage.object', 'camera_stage.camera'],
  failureRecovery: [CONFLICT_RECOVERY],
  inputSchema: z.object({ documentId: cameraStageDocumentIdSchema, objectId: z.string().min(1), changes: cameraStageObjectUpdateSchema }).strict(),
  outputSchema: capabilityOutputSchema(cameraStageTransactionResultShape),
  resolveConcurrencyKey: (input) => `camera_stage:${input.documentId}:${input.objectId}`, resolveTargetIds: (input) => cameraStageTarget(input.documentId, { objectId: input.objectId }),
  control: cameraStageControl('update', ['camera_stage.object', 'camera_stage.camera'], [
    'camera_stage.object.name', 'camera_stage.object.visible', 'camera_stage.object.color', 'camera_stage.object.transform.position',
    'camera_stage.object.transform.rotation', 'camera_stage.object.transform.scale', 'camera_stage.object.character_variant',
    'camera_stage.camera.name', 'camera_stage.camera.visible', 'camera_stage.camera.transform.position', 'camera_stage.camera.transform.rotation',
    'camera_stage.camera.fov', 'camera_stage.camera.look_at_target', 'camera_stage.camera.look_at_object_ref',
    'camera_stage.camera.aspect_ratio_preset', 'camera_stage.camera.aspect_ratio',
  ]),
  summarize: (output) => `3D 对象更新事务 ${output.transactionRef} 已完成。`,
})

/*
 * add_camera_stage_shot / update_camera_stage_shot 已下线（2.1）：状态关键帧的创建、删除、
 * 排序、改名/时间/机位等全部属性都已被 camera_stage.state_keyframe 的集合写入与统一字段定义覆盖，
 * 两条专用能力是纯粹的重复实现，按项目规则删除而不是并存。
 */

export const CAMERA_STAGE_SCENE_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  observeScene, placeObject, generateSet, duplicateObject, deleteObject, updateObject,
]
