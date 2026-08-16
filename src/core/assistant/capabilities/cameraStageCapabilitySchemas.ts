import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'

/** 三维工程、对象与镜头名称的契约上限，schema 与领域服务共用。 */
export const CAMERA_STAGE_NAME_MAX_LENGTH = 120

export const cameraStageVec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
}).strict()

export const cameraStageBaseRevisionSchema = z.number().int().nonnegative()

export const cameraStageObjectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(CAMERA_STAGE_NAME_MAX_LENGTH).optional(),
  visible: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  transform: z.object({
    position: cameraStageVec3Schema.optional(),
    rotation: cameraStageVec3Schema.optional(),
    scale: cameraStageVec3Schema.optional(),
  }).strict().optional(),
  fov: z.number().min(1).max(179).optional(),
  lookAt: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('manual'), target: cameraStageVec3Schema }).strict(),
    z.object({ mode: z.literal('object'), objectId: z.string().min(1), fallbackTarget: cameraStageVec3Schema }).strict(),
  ]).optional(),
  aspectRatio: z.object({
    preset: z.enum(['16:9', '4:3', '1:1', '9:16', 'custom']),
    ratio: z.number().positive().max(10),
  }).strict().optional(),
  variant: z.enum(['standard', 'strong', 'slim', 'child']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: '至少修改一个已注册属性' })

export const cameraStagePlacementSchema = z.object({
  mode: z.enum(['auto', 'beside', 'surround', 'foreground', 'background']).default('auto'),
  position: cameraStageVec3Schema.optional(),
  rotation: cameraStageVec3Schema.optional(),
  scale: cameraStageVec3Schema.optional(),
  dimensions: cameraStageVec3Schema.optional(),
  /**
   * 参照对象的 id，必须是观察结果里 `objects[].id` 的原值，不是对象名称、也不是带工程前缀
   * 的稳定引用。填错时会在任何写入之前被拒绝，错误信息里会列出当前可用的 id。
   */
  targetObjectId: z.string().min(1).optional()
    .describe('参照对象 id：取自 observe_camera_stage_scene 返回的 objects[].id 原值，不要填名称或带工程前缀的引用'),
  spacing: z.number().min(0).max(1_000).default(0.35),
  allowOverlap: z.boolean().default(false),
}).strict()

export const cameraStageMoveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('orbit'), degrees: z.number().min(1).max(1440), direction: z.enum(['cw', 'ccw']) }).strict(),
  z.object({ kind: z.enum(['dollyIn', 'dollyOut']), distanceRatio: z.number().min(0.05).max(20) }).strict(),
  z.object({ kind: z.literal('truck'), offset: z.number().min(-10_000).max(10_000) }).strict(),
  z.object({ kind: z.literal('crane'), height: z.number().min(-10_000).max(10_000) }).strict(),
])

/** 乐观并发冲突的统一恢复指引：所有收 baseRevision 的三维写入都必须给出这一条。 */
export const CONFLICT_RECOVERY = 'CONFLICT 表示场景在读取之后被改动过：直接使用上一次写入或读取返回的 baseRevision 重试一次，不要用同一个过期值反复重试；仍冲突再重新观察场景。'

export const cameraStageTransactionResultShape = {
  status: z.literal('completed'),
  transactionRef: z.string().min(1),
  /**
   * 写入后的并发基线，直接用于下一次写入，不必再读一遍工程。
   * 与不走事务的三维能力（新建、复制、删除、打开）返回同名同形状的字段。
   */
  baseRevision: cameraStageBaseRevisionSchema,
  resultingRevisions: z.record(z.string(), z.number().int().nonnegative()),
  resultRefs: z.array(z.object({
    kind: z.string(),
    id: z.string(),
    revision: z.number().int().nonnegative().optional(),
    label: z.string().optional(),
  }).strict()),
  effects: z.array(z.object({
    effect: z.enum(['create', 'update', 'delete', 'execute']),
    entityType: z.string().min(1),
    refs: z.array(z.object({
      kind: z.string(), id: z.string(), revision: z.number().int().nonnegative().optional(), label: z.string().optional(),
    }).strict()),
    propertyIds: z.array(z.string()),
    origin: z.union([
      z.object({ kind: z.literal('direct') }).strict(),
      z.object({ kind: z.literal('cascade'), declarationId: z.string().min(1) }).strict(),
    ]),
  }).strict()),
  evidence: z.array(z.record(z.string(), z.unknown())),
  verification: z.object({
    verified: z.boolean(),
    evidence: z.array(z.record(z.string(), z.unknown())),
    unmetConditions: z.array(z.string()),
    checkedAt: z.string(),
  }).passthrough(),
  undoRef: z.string().optional(),
}

export function cameraStageTarget(projectId: string, extra: Record<string, string> = {}): Record<string, string> {
  return { projectId, ...extra }
}

type CameraStageEffect = 'observe' | 'create' | 'update' | 'delete' | 'navigate' | 'execute'

export function cameraStageControl(
  effect: CameraStageEffect,
  entityTypes: string[],
  propertyIds: string[] = [],
  revisionScopes: string[] = ['toolbox'],
  /**
   * 同一次调用真正产生的其他 effect。
   *
   * 一个能力只声明一个 effect 是个隐患：能力发现按 effect 匹配 Facet 声明的
   * capabilityKinds / requiredEffects，声明漏了就等于对那类意图隐身。实测
   * place_camera_stage_object 只声明 execute，而它 producesRefs 里明明白白写着会产出
   * camera_stage.object——于是一个「要创建对象」的 Facet 完全看不见它。
   */
  alsoImpacts: { effect: CameraStageEffect; entityTypes: string[]; propertyIds?: string[] }[] = [],
): NonNullable<ApplicationCapabilityDefinition['control']> {
  return {
    execution: {
      mode: effect === 'delete' ? 'confirmation_required' : 'immediate',
      cancelable: false,
      resultState: effect === 'observe' ? 'observed' : 'completed',
    },
    impacts: [
      { effect, entityTypes, propertyIds, revisionScopes, verificationRequired: effect !== 'observe' && effect !== 'navigate' },
      ...alsoImpacts.map((impact) => ({
        effect: impact.effect,
        entityTypes: impact.entityTypes,
        propertyIds: impact.propertyIds ?? [],
        revisionScopes,
        verificationRequired: impact.effect !== 'observe' && impact.effect !== 'navigate',
      })),
    ],
  }
}
