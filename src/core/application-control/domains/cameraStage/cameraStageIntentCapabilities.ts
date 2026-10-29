import { z } from 'zod'
import { CONFLICT_RECOVERY } from './cameraStageCapabilitySchemas'
import { applicationRefSchema } from '../../identifiers'
import { defineApplicationCapability, capabilityControl, capabilityOutputSchema } from '../shared/defineApplicationCapability'

const documentRef = applicationRefSchema.extend({ kind: z.literal('camera_stage.document') }).strict()
export const organizeCameraIntentCapability = defineApplicationCapability({
  id: 'organize_camera_stage_motion', version: 1, title: '整理机位超级关键帧', description: '免费生成原生平滑推拉、环绕、推近停顿候选。传入文档、摄像机和按时间排列的连续状态关键帧；仅审阅，不写作品或历史。原稿和候选可在视口播放对照；确认后调用 apply_camera_stage_motion_candidate。',
  domain: 'camera_stage', aliases: ['超级关键帧', '机位', '整理运镜'], readOnly: true, dataClasses: ['C1'], idempotent: false, destructive: false, timeoutMs: 60_000, supportsPreview: true, supportsUndo: false, requiredScopes: ['camera_stage'], acceptsRefs: ['camera_stage.document', 'camera_stage.camera', 'camera_stage.state_keyframe'], producesRefs: ['camera_stage.document'],
  inputSchema: z.object({ documentRef, cameraRef: applicationRefSchema.extend({ kind: z.literal('camera_stage.camera') }).strict(), stateKeyframeRefs: z.array(applicationRefSchema.extend({ kind: z.literal('camera_stage.state_keyframe') }).strict()).min(2) }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: documentRef, reviewId: z.string(), candidates: z.array(z.object({ id: z.string(), label: z.string() }).strict()), unavailable: z.array(z.object({ message: z.string() }).passthrough()) }),
  control: capabilityControl('observe', ['camera_stage.document'], { revisionScopes: ['camera_stage'] }), resolveOperationTargets: input => [input.documentRef, input.cameraRef, ...input.stateKeyframeRefs], concurrencyKey: 'camera_stage', resolveConcurrencyKey: input => `camera_stage:${input.documentRef.id}`, parallelSafe: false,
  summarize: () => '机位候选已整理，请确认后应用。',
})
export const applyCameraIntentCapability = defineApplicationCapability({
  id: 'apply_camera_stage_motion_candidate', version: 1, title: '应用机位超级关键帧', description: '应用本次整理的机位候选，一步撤销。reviewId 和 candidateId 取自整理结果；场景变化后须重新整理。saved=false 时再次传同一候选只重试保存，不重复应用。', domain: 'camera_stage', aliases: ['应用运镜', '超级关键帧'], readOnly: false, dataClasses: ['C1'], idempotent: false, destructive: false, timeoutMs: 20_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['camera_stage'], acceptsRefs: ['camera_stage.document'], producesRefs: ['camera_stage.state_keyframe'],
  failureRecovery: [CONFLICT_RECOVERY],
  inputSchema: z.object({ documentRef, reviewId: z.string().min(1), candidateId: z.enum(['smooth', 'orbit', 'dolly-hold']) }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: documentRef, saved: z.boolean(), undoToken: z.string(), stateKeyframeRefs: z.array(applicationRefSchema), verification: z.object({ verified: z.boolean(), condition: z.string() }).strict() }),
  control: capabilityControl('update', ['camera_stage.state_keyframe'], { revisionScopes: ['camera_stage'] }), resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: input => [input.documentRef], concurrencyKey: 'camera_stage', resolveConcurrencyKey: input => `camera_stage:${input.documentRef.id}`,
  resolveObservedEffects: (_input, output) => [{ effect: 'update', entityTypes: ['camera_stage.state_keyframe'], propertyIds: [], targetRefs: output.stateKeyframeRefs, count: output.stateKeyframeRefs.length, verified: output.verification.verified, evidence: [output.verification.condition] }],
  summarize: output => output.saved ? '机位已应用并保存。' : '机位已应用，请重试保存。',
})
