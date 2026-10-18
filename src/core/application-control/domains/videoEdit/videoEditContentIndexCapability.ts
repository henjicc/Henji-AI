import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { mediaContentKindSchema, mediaContentRecordSchema } from '../../../media/contentIndex'
import { normalizeTranscriptSearch } from '../../../media/transcriptSearch'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
export const queryVideoEditContentCapability = defineApplicationCapability({
  id: 'query_video_edit_content', version: 1, domain: 'video_edit', title: '查询素材的文字与声音画面索引',
  description: '按素材源微秒、文字和类型分页查询已有转录、校对字幕、创作描述与录屏章节。返回来源引用、精度及 saved/analysis/timeline/intent，字幕投影和创作意图不冒充原始声音或画面证据。指定 pause/scene 会免费本地分析并复用内容缓存，不识别、不计费、不修改作品、不移动播放头。默认只读已有文字；audioDocumentRef 可读取同源口播文档，recordingRef 可读取同源录制理解，分别需要对应领域只读权限。结果仅供查阅，精确文本剪辑仍用 query_video_edit_transcript。分页须保持条件不变，源文件或关联文档改变后重新查询。',
  aliases: ['素材内容索引', '查素材内容', '素材章节', '声音画面证据'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.item', 'audio_edit.document', 'screen_recording.session'], producesRefs: [],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), itemRef: ref('video_edit.item'),
    audioDocumentRef: ref('audio_edit.document').optional(), recordingRef: ref('screen_recording.session').optional(),
    text: z.string().trim().min(1).max(500).refine(value => Boolean(normalizeTranscriptSearch(value)), 'text 须包含文字或数字。').optional(),
    fromUs: z.number().int().nonnegative().safe().optional(), toUs: z.number().int().positive().safe().optional(),
    kinds: z.array(mediaContentKindSchema).min(1).max(6).default(['transcript', 'caption', 'description', 'chapter']),
    cursor: z.string().min(1).max(100).optional(), limit: z.number().int().min(1).max(50).default(20),
  }).strict().refine(value => value.fromUs === undefined || value.toUs === undefined || value.toUs > value.fromUs, 'toUs 必须大于 fromUs。'),
  outputSchema: z.object({ documentRef: ref('video_edit.document'), itemRef: ref('video_edit.item'), clock: z.literal('source_microseconds'), sourceVerified: z.boolean(),
    records: z.array(mediaContentRecordSchema).max(50), total: z.number().int().nonnegative(), nextCursor: z.string().nullable(), warnings: z.array(z.string()).max(20), message: z.string(),
  }).strict(),
  resolveOperationTargets: value => [value.documentRef, value.itemRef, ...(value.audioDocumentRef ? [value.audioDocumentRef] : []), ...(value.recordingRef ? [value.recordingRef] : [])],
  resolveOperationWriteTargets: () => [], control: capabilityControl('observe', ['video_edit.item'], { revisionScopes: ['video_edit'], cancelable: true }), summarize: value => value.message,
})
