import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '../../../videoEdit/time'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const frame = z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES)
const range = z.object({ fromFrame: frame, toFrame: frame }).strict().refine(value => value.toFrame >= value.fromFrame, '检查范围不能倒置。')
const kind = z.enum(['caption', 'clip_boundary', 'effect', 'transition', 'tracking_lost', 'tracking_low_confidence', 'tracking_uncovered', 'tracking_unavailable', 'motion', 'motion_hard_stop', 'motion_hold', 'event_crowded', 'code_change', 'code_unavailable', 'pixel_cut', 'pixel_change', 'pixel_still', 'pixel_unknown'])
const sourceRange = z.object({ fromUs: z.number().finite().nonnegative(), toUs: z.number().finite().nonnegative() }).strict()
export const queryVideoEditReviewCapability = defineApplicationCapability({
  id: 'query_video_edit_review', version: 1, domain: 'video_edit', title: '选择剪辑检查点与运动、跟踪复核区间',
  description: '按 documentRef、sequenceRef 和半开整数帧 from/to 选择最多12个检查帧，并分页返回字幕边界、片段切换、已启用效果关键帧、转场及跟踪丢失/低置信度/未覆盖区间。跟踪仅读已有结果，不启动模型或重新跟踪；threshold 默认0.5，只是复核阈值，不判画面错误。记录包含原实体引用及完整嵌套放置路径，支持变速、倒放和重复实例；source 为跟踪原始微秒，timeline 为查询序列帧。渲染可能插值或借用邻近有效位置，原始跟丢不等于最终画面空白；候选也不证明像素可见。checkpoints 是整个查询的有界优先抽样，不能证明未取帧区间无问题；records 可分页继续读，超计算预算要求缩小范围，不静默截断。将返回的 documentVersion 与 checkpoints.frames 一起交给 observe_video_edit_frame（documentVersion、target.kind=frames、target.sequenceRef=本次序列）定向检查；作品编辑或关闭重开后旧计划/分页失效。跟踪记录的 subjectRef 可沿通用属性 video_edit.tracker.prompts 补充锚点纠正；不修改作品、播放头或选区。',
  aliases: ['自动看片位置', '跟踪复核', '剪辑检查点'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false,
  timeoutMs: 300000, supportsPreview: false, supportsUndo: false, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence'], producesRefs: ['video_edit.clip', 'video_edit.tracker', 'video_edit.caption', 'video_edit.effect', 'video_edit.transition', 'video_edit.media'],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), sequenceRef: ref('video_edit.sequence'), from: frame, to: frame, threshold: z.number().finite().min(0).max(1).default(.5), maxFrames: z.number().int().min(1).max(12).default(8), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(100).optional(),
    motion: z.object({ minGapSeconds: z.number().finite().min(0).max(30).default(1.5), minimumHoldSeconds: z.number().finite().min(0).max(60).default(1), videoPixels: z.boolean().default(false).describe('分析原视频及代码视频/下方画面输入的来源候选；code_input_pixels.input 给参数、输入种类和媒体引用，不证明代码绘制或成片可见，不额外计入事件密度。固定取帧不继承原片运动；下方画面只追溯其原视频，不代替效果与代码合成复核。同源范围合并，最多300秒不同源区间、60000放置帧，输入映射最多200000次访问；分页不重算，文件变化须重查。') }).strict().optional().describe('复核原生变换与代码元素，elementPath 定位元素，父组动作去重。文字用正式字体度量；声音驱动用正式混音及分析，取首个音频参数或下方轨道，最多32组、300秒完整声音上下文，视觉修改可复用。字体、声音或原文件变化须重查。保持不证明像素静止；videoPixels 启用源视频与代码画面输入采样。着色器、代码滤镜及输入的成片可见性仍须观察，风格与意图优先。'),
  }).strict().refine(value => value.to > value.from, 'to 必须大于 from。'),
  outputSchema: z.object({ documentRef: ref('video_edit.document'), sequenceRef: ref('video_edit.sequence'), documentVersion: z.string().min(1), range,
    checkpoints: z.object({ frames: z.array(frame).max(12), selection: z.literal('prioritized_sample') }).strict(),
    records: z.array(z.object({ kind, timeline: range, sequenceRef: ref('video_edit.sequence'), subjectRef: applicationRefSchema,
      path: z.array(z.object({ sequenceRef: ref('video_edit.sequence'), clipRef: ref('video_edit.clip') }).strict()).max(8),
      confidence: z.number().finite().min(0).max(1).optional(), source: sourceRange.optional(),
      motionEvidence: z.object({ basis: z.enum(['clip_transform', 'structural_events', 'code_structure', 'video_pixels', 'code_input_pixels']), elementPath: z.array(z.string().min(1)).optional(), peakSpeed: z.number().finite().nonnegative().optional(), gapSeconds: z.number().finite().nonnegative().optional(), suggestion: z.string().min(1).max(1000),
        input: z.object({ parameter: z.string().min(1), kind: z.enum(['video', 'sequence']), mediaRef: ref('video_edit.media') }).strict().optional(),
      }).strict().optional(),
    }).strict()).max(50), total: z.number().int().nonnegative(), nextCursor: z.string().nullable(), warnings: z.array(z.string()).max(20), message: z.string(),
  }).strict(),
  resolveOperationTargets: input => [input.documentRef, input.sequenceRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.sequence'], { revisionScopes: ['video_edit'], cancelable: true }), summarize: output => output.message,
})
