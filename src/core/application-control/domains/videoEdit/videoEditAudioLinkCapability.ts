import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const clipRef = applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict()
const audioRef = applicationRefSchema.extend({ kind: z.literal('audio_edit.document') }).strict()
export const sendVideoEditAudioCapability = defineApplicationCapability({
  id: 'send_video_edit_clip_to_audio_edit', title: '把片段送到音频编辑', description: '将明确音频片段或视频的声音按源入出点建立音频编辑作品并保持动态链接。已有链接直接复用；后台执行不切页面。音频保存后自动刷新剪辑，变短只截短结尾不移动后续片段，变长不自动延长。',
  version: 1, domain: 'video_edit', aliases: ['音频精修', '编辑片段声音'], readOnly: false, dataClasses: ['C1'], idempotent: true, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit', 'audio_edit'], acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['audio_edit.document', 'video_edit.clip'],
  inputSchema: z.object({ documentRef, clipRef }).strict(),
  outputSchema: z.object({ resultRef: documentRef, audioDocumentRef: audioRef, clipRef, created: z.boolean(), message: z.string(), verified: z.boolean() }).strict(),
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef, input.clipRef], resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('execute', ['video_edit.document', 'video_edit.clip'], { revisionScopes: ['video_edit', 'audio_edit'], alsoImpacts: [{ effect: 'create', entityTypes: ['audio_edit.document'], propertyIds: [] }] }),
  summarize: result => result.message,
  resolveObservedEffects: (_input, result) => [{ effect: 'execute', entityTypes: ['video_edit.clip'], propertyIds: [], targetRefs: [result.clipRef], count: 1, verified: result.verified, evidence: ['已回读保存后的剪辑链接'] }, ...(result.created ? [{ effect: 'create' as const, entityTypes: ['audio_edit.document'], propertyIds: [], targetRefs: [result.audioDocumentRef], count: 1, verified: result.verified, evidence: ['已创建音频作品'] }] : [])],
})
