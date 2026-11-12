import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const clipRef = applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict()
const audioRef = applicationRefSchema.extend({ kind: z.literal('audio_edit.document') }).strict()
export const sendVideoEditAudioCapability = defineApplicationCapability({
  id: 'send_video_edit_clip_to_audio_edit', title: '把片段送到音频编辑', description: '将明确音频片段或视频的声音按源入出点建立音频编辑作品并保持动态链接。已有链接直接复用，并立即把音频作品最新保存的版本更新进剪辑（平时在口播停改几秒后、回到剪辑或开始播放时自动开始更新，新声音就绪前继续播放旧的；导出前先等更新完成，没能更新时导出结果带提示；失败会自动重试）；后台执行不切页面。更新时片段按词对回：变短只截短结尾不移动后续片段，变长不盖过后面的片段；来自这份口播的字幕随声音移动，删掉的句子字幕移除，恢复的整句补回，剪辑里手改的文字与样式保留，对不上的保留并标待复核。一次更新在剪辑里是一步撤销，进度与结果见 video_edit.document 的 audioLinkNotices。',
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
