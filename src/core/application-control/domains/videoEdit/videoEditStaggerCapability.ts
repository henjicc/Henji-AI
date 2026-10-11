import { z } from 'zod'
import { applicationRefSchema } from '../../identifiers'
import { defineApplicationCapability, capabilityControl } from '../shared/defineApplicationCapability'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
export const videoEditStaggerCapability = defineApplicationCapability({
  id: 'stagger_video_edit_motion', version: 1, title: '错峰复制动作', domain: 'video_edit',
  description: '把源片段内指定区间的动作复制给其他片段，保留各自基态：位置和角度加相对变化，缩放乘相对比例。sourceRange 为源片段内起止帧；按 targetRefs 顺序，第一个目标延后 stepFrames，之后逐个累加。动作从目标的相同片段内位置开始；时长不足、锁定或越界时整批拒绝。一次应用可一步撤销；不改变源片段或其他区间。',
  aliases: ['错峰', '级联', '复制动作', 'stagger'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false,
  timeoutMs: 20_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip'], producesRefs: ['video_edit.clip'],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), sequenceRef: ref('video_edit.sequence'), sourceRef: ref('video_edit.clip'), targetRefs: z.array(ref('video_edit.clip')).min(1), sourceRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]), stepFrames: z.number().int().nonnegative().default(4) }).strict(),
  outputSchema: z.object({ resultRefs: z.array(ref('video_edit.clip')), message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string() }).strict() }).strict(),
  control: capabilityControl('update', ['video_edit.clip'], { revisionScopes: ['video_edit'] }),
  resolveOperationTargets: input => [input.documentRef, input.sequenceRef, input.sourceRef, ...input.targetRefs], resolveOperationWriteTargets: input => [input.documentRef],
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveObservedEffects: (_input, output) => [{ effect: 'update', entityTypes: ['video_edit.clip'], propertyIds: [], targetRefs: output.resultRefs, count: output.resultRefs.length, verified: output.verification.verified, evidence: [output.verification.condition] }],
  summarize: output => output.message,
})
