import { z } from 'zod'

import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'

export const cameraStageVec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
}).strict()

export const cameraStageBaseRevisionSchema = z.number().int().nonnegative()

export const cameraStageObjectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
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
  targetObjectId: z.string().min(1).optional(),
  spacing: z.number().min(0).max(1_000).default(0.35),
  allowOverlap: z.boolean().default(false),
}).strict()

export const cameraStageMoveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('orbit'), degrees: z.number().min(1).max(1440), direction: z.enum(['cw', 'ccw']) }).strict(),
  z.object({ kind: z.enum(['dollyIn', 'dollyOut']), distanceRatio: z.number().min(0.05).max(20) }).strict(),
  z.object({ kind: z.literal('truck'), offset: z.number().min(-10_000).max(10_000) }).strict(),
  z.object({ kind: z.literal('crane'), height: z.number().min(-10_000).max(10_000) }).strict(),
])

export const cameraStageTransactionResultShape = {
  status: z.literal('completed'),
  transactionRef: z.string().min(1),
  /**
   * 写入后的并发基线，直接用于下一次写入，不必再读一遍工程。
   * 与不走事务的三维能力（新建、复制、删除、打开）返回同名同形状的字段。
   */
  baseRevision: cameraStageBaseRevisionSchema,
  resultingRevisions: z.record(z.string(), z.number().int().nonnegative()),
  producedRefs: z.array(z.object({
    kind: z.string(),
    id: z.string(),
    revision: z.number().int().nonnegative().optional(),
    label: z.string().optional(),
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

export function cameraStageControl(
  effect: 'observe' | 'create' | 'update' | 'delete' | 'navigate' | 'execute',
  entityTypes: string[],
  propertyIds: string[] = [],
  revisionScopes: string[] = ['toolbox'],
): NonNullable<ApplicationCapabilityDefinition['control']> {
  return {
    execution: {
      mode: effect === 'delete' ? 'confirmation_required' : 'immediate',
      cancelable: false,
      resultState: effect === 'observe' ? 'observed' : 'completed',
    },
    impacts: [{
      effect,
      entityTypes,
      propertyIds,
      revisionScopes,
      verificationRequired: effect !== 'observe' && effect !== 'navigate',
    }],
  }
}
