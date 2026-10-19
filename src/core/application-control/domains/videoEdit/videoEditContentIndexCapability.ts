import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { mediaContentKindSchema, mediaContentRecordSchema } from '../../../media/contentIndex'
import { normalizeTranscriptSearch } from '../../../media/transcriptSearch'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const discoveryScope = z.enum(['none', 'project', 'all'])
export const queryVideoEditContentCapability = defineApplicationCapability({
  id: 'query_video_edit_content', version: 1, domain: 'video_edit', title: '查询素材的文字与声音画面索引',
  description: '按素材源微秒、文字和类型分页查询已有转录、校对字幕、创作描述与录屏章节。默认在当前项目自动发现同源口播与录制文档（独立作品查独立作品目录）；discoveryScope=all 扩大到其他项目，none 仅查剪辑及显式引用。按口播/录制只读权限发现，权限不足或读取失败会以 discovery.complete=false 和 warnings 说明不完整。audioDocumentRef/recordingRef 可显式指定同源文档，缺权限则拒绝。顶层 sourceVerified 只说明目标素材身份；每条结果的 sourceVerified 单独说明该条来源是否核实，录制旧记录仅有路径关联时为 false。结合 basis(saved/analysis/timeline/intent) 与 precision 阅读，字幕投影和创作意图不冒充原始证据。指定 pause/scene/screen_change 才免费本地分析并复用缓存；scene 保留普通镜头检测，screen_change 以5fps扫描录屏局部像素变化，再按预算以30fps复核疑点，返回变化区域、类型和粗扫/密集阶段。screenChange 内各 Seconds 为原素材秒，samplingFps 是分析采样率，不是解码PTS。正常滚动、运镜和弹窗只列为候选，不判错误；未复核数量及稀疏采样限制进入 warnings，隐私另走OCR，不识别、不计费、不修改作品、不移动播放头。可通过 read_application_entity 读取原 itemRef 的 video_edit.item.content_queries 查看正在运行及最近的查询阶段、实测阶段进度和失败原因；null 表示尚无可靠进度，不是卡死。取消原读取请求会向原分析发起取消，失败后重新查询可复用缓存；关闭或编辑剪辑取消旧查询。精确文本剪辑用 query_video_edit_transcript。分页保持条件不变，源文件或关联目录/内容改变后重新查询。',
  aliases: ['素材内容索引', '查素材内容', '素材章节', '声音画面证据'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.item', 'audio_edit.document', 'screen_recording.session'], producesRefs: [],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), itemRef: ref('video_edit.item'),
    audioDocumentRef: ref('audio_edit.document').optional(), recordingRef: ref('screen_recording.session').optional(),
    discoveryScope: discoveryScope.default('project'),
    text: z.string().trim().min(1).max(500).refine(value => Boolean(normalizeTranscriptSearch(value)), 'text 须包含文字或数字。').optional(),
    fromUs: z.number().int().nonnegative().safe().optional(), toUs: z.number().int().positive().safe().optional(),
    kinds: z.array(mediaContentKindSchema).min(1).max(7).default(['transcript', 'caption', 'description', 'chapter']),
    cursor: z.string().min(1).max(100).optional(), limit: z.number().int().min(1).max(50).default(20),
  }).strict().refine(value => value.fromUs === undefined || value.toUs === undefined || value.toUs > value.fromUs, 'toUs 必须大于 fromUs。'),
  outputSchema: z.object({ documentRef: ref('video_edit.document'), itemRef: ref('video_edit.item'), clock: z.literal('source_microseconds'), sourceVerified: z.boolean(),
    discovery: z.object({ scope: discoveryScope, complete: z.boolean(), scannedDocuments: z.number().int().nonnegative(), matchedDocuments: z.number().int().nonnegative() }).strict(),
    records: z.array(mediaContentRecordSchema).max(50), total: z.number().int().nonnegative(), nextCursor: z.string().nullable(), warnings: z.array(z.string()).max(20), message: z.string(),
  }).strict(),
  resolveOperationTargets: value => [value.documentRef, value.itemRef, ...(value.audioDocumentRef ? [value.audioDocumentRef] : []), ...(value.recordingRef ? [value.recordingRef] : [])],
  resolveOperationWriteTargets: () => [], control: capabilityControl('observe', ['video_edit.item'], { revisionScopes: ['video_edit'], cancelable: true }), summarize: value => value.message,
})
