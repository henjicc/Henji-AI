import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { mediaContentKindSchema, mediaContentRecordSchema } from '../../../media/contentIndex'
import { videoEditClipSchema } from '../../../videoEdit/document'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '../../../videoEdit/time'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const timelineRange = z.object({ fromFrame: z.number().finite().nonnegative(), toFrame: z.number().finite().nonnegative() }).strict().refine(value => value.toFrame >= value.fromFrame, '成片范围不能倒置。')
const timelineSpan = timelineRange.refine(value => value.toFrame > value.fromFrame, '成片区间终点须晚于起点。')
const sourceRange = z.object({ fromUs: z.number().int().nonnegative().safe(), toUs: z.number().int().nonnegative().safe(), direction: z.enum(['forward', 'reverse', 'static']),
  basis: z.enum(['sampled_envelope', 'continuous_audio', 'generated_clock', 'asset_point']) }).strict().refine(value => value.toUs >= value.fromUs, '源范围不能倒置。')
export const videoEditSourceMapRecordSchema = z.object({
  id: z.string().min(1), medium: z.enum(['video', 'audio']), kind: videoEditClipSchema.shape.kind,
  timeline: timelineSpan, path: z.array(z.object({ sequenceRef: ref('video_edit.sequence'), clipRef: ref('video_edit.clip'), itemRef: ref('video_edit.item'), track: z.number().int().nonnegative() }).strict()).min(1).max(8),
  sourceKind: z.enum(['media', 'generated', 'static']), mediaRef: ref('video_edit.media').optional(), source: sourceRange,
  firstSample: z.object({ frame: z.number().int().nonnegative(), sourceUs: z.number().int().nonnegative().safe() }).strict().optional(),
  content: z.object({ records: z.array(z.object({ record: mediaContentRecordSchema, timelineRanges: z.array(timelineRange).max(128) }).strict()).max(5), total: z.number().int().nonnegative(), nextCursor: z.string().nullable(), complete: z.boolean(), error: z.string().max(2000).optional() }).strict().nullable(),
}).strict()
export const queryVideoEditSourceMapCapability = defineApplicationCapability({
  id: 'query_video_edit_source_map', version: 1, domain: 'video_edit', title: '按成片区间查询来源与内容证据',
  description: '按 documentRef、sequenceRef 和半开整数帧 from/to 分页查成片到原素材的映射。返回每次放置独立的嵌套路径、原片段/素材引用、源微秒范围及播放方向，覆盖修剪、变速、倒放、混合帧率嵌套和转场余量；mediums 可选 video/audio。timeline 的声音边界可能是小数帧，画面为整数采样帧；sampled_envelope 是实际取帧请求的源时间包络，高倍速跳过的帧不能视为已显示。firstSample 是请求时钟，不是解码器核实的实际PTS。所有记录都只是轨道结构贡献候选：透明外框、遮罩、混合和代码效果不证明下层被遮挡，须用 observe_video_edit_frame 核对。includeContent=true 才对本页物理素材复用 query_video_edit_content，最多返回每项 contentLimit 条内容证据及投影后的成片范围，不识别、不付费、不移动播放头、不修改作品；检查逐条 sourceVerified/basis/precision。发现范围 discoveryScope 默认 project，all 跨项目，none 仅读剪辑；受对应读取权限限制。内容每页重新核实，查询不完整或文件不可读会明确标示；content.nextCursor 属于原素材内容查询，可按此项源范围继续查。分页绑定剪辑内容与筛选条件，编辑或关闭重开后重新查询；结果不能直接作精剪selector。',
  aliases: ['成片来源映射', '时间线来源索引', '从成片找原素材'], readOnly: true, dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence'], producesRefs: ['video_edit.clip', 'video_edit.item', 'video_edit.media'],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), sequenceRef: ref('video_edit.sequence'), from: z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES), to: z.number().int().positive().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES),
    mediums: z.array(z.enum(['video', 'audio'])).min(1).max(2).default(['video', 'audio']), includeContent: z.boolean().default(false), contentLimit: z.number().int().min(1).max(5).default(2),
    contentKinds: z.array(mediaContentKindSchema).min(1).max(7).default(['transcript', 'caption', 'description', 'chapter']).describe('includeContent=true 时查询的来源内容类型；只有显式 pause/scene/screen_change 才免费本地分析。点事件投影后 fromFrame=toFrame，不扩张成持续区间。'),
    discoveryScope: z.enum(['none', 'project', 'all']).default('project'), cursor: z.string().min(1).max(100).optional(), limit: z.number().int().min(1).max(50).default(20),
  }).strict().refine(value => value.to > value.from, 'to 必须大于 from。'),
  outputSchema: z.object({ documentRef: ref('video_edit.document'), sequenceRef: ref('video_edit.sequence'), clock: z.literal('sequence_frames'), coverageBasis: z.literal('timeline_structure'), visibilityVerified: z.literal(false),
    range: timelineSpan, records: z.array(videoEditSourceMapRecordSchema).max(50), total: z.number().int().nonnegative(), nextCursor: z.string().nullable(), warnings: z.array(z.string()).max(20), message: z.string(),
  }).strict(),
  resolveOperationTargets: input => [input.documentRef, input.sequenceRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.sequence'], { revisionScopes: ['video_edit'], cancelable: true }), summarize: output => output.message,
})
