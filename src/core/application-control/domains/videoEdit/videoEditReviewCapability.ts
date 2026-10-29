import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '../../../videoEdit/time'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const frame = z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES)
const range = z.object({ fromFrame: frame, toFrame: frame }).strict().refine(value => value.toFrame >= value.fromFrame, '检查范围不能倒置。')
const kind = z.enum(['caption', 'clip_boundary', 'effect', 'transition', 'tracking_lost', 'tracking_low_confidence', 'tracking_uncovered', 'tracking_unavailable', 'motion', 'motion_hard_stop', 'motion_hold', 'event_crowded', 'code_change', 'code_unavailable', 'pixel_cut', 'pixel_change', 'pixel_still', 'pixel_unknown', 'settled_jitter', 'safe_area', 'motion_too_fast', 'text_overflow', 'text_clipped', 'text_truncated', 'scene_box_stale', 'scene_cursor_jump', 'scene_issue'])
const sourceRange = z.object({ fromUs: z.number().finite().nonnegative(), toUs: z.number().finite().nonnegative() }).strict()
const size = z.object({ width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict()
const rect = size.extend({ x: z.number().finite(), y: z.number().finite() }).strict()
const point = z.tuple([z.number().finite(), z.number().finite()])
const polygon = z.array(point).length(4)
const textOverflow = z.object({ drawIndex: z.number().int().nonnegative(),
  constraint: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative().optional(), height: z.number().finite().nonnegative().optional(), maxWidth: z.number().finite().nonnegative().optional(), maxHeight: z.number().finite().nonnegative().optional(), maxLines: z.number().int().positive().optional() }).strict(),
  contentSize: size, visibleContentSize: size, inkBounds: rect.nullable(), appearanceBounds: rect.nullable(), boundsKind: z.enum(['measured', 'estimated']),
  actualLines: z.number().int().nonnegative(), totalLines: z.number().int().nonnegative(),
  omittedRanges: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), paragraph: z.number().int().nonnegative(), run: z.number().int().nonnegative(), runStart: z.number().int().nonnegative(), runEnd: z.number().int().nonnegative(), reason: z.enum(['maxLines', 'maxHeight', 'trim']) }).strict()),
  fitFailed: z.boolean(), truncated: z.boolean(), visibleOverflow: z.boolean(), matrix: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
  inkQuad: z.array(point).max(4), effectiveClips: z.array(polygon), clippedBy: z.array(z.enum(['frame', 'clip'])).max(2),
  stability: z.object({ basis: z.enum(['stable_layout', 'persistent_clip']), fromFrame: frame, toFrame: frame, minimumFrames: z.number().int().positive() }).strict(),
}).strict()
export const queryVideoEditReviewCapability = defineApplicationCapability({
  id: 'query_video_edit_review', version: 3, domain: 'video_edit', title: '选择剪辑检查点与运动、跟踪复核区间',
  description: '按 documentRef、sequenceRef 和半开整数帧 from/to 选择最多12个检查帧，并分页返回字幕边界、片段切换、已启用效果关键帧、转场及跟踪丢失/低置信度/未覆盖区间。跟踪仅读已有结果，不启动模型或重新跟踪；threshold 默认0.5，只是复核阈值，不判画面错误。记录包含原实体引用及完整嵌套放置路径，支持变速、倒放和重复实例；source 为跟踪原始微秒，timeline 为查询序列帧。渲染可能插值或借用邻近有效位置，原始跟丢不等于最终画面空白；候选也不证明像素可见。checkpoints 是整个查询的有界优先抽样，不能证明未取帧区间无问题；records 可分页继续读，超计算预算要求缩小范围，不静默截断。将返回的 documentVersion 与 checkpoints.frames 一起交给 observe_video_edit_frame（documentVersion、target.kind=frames、target.sequenceRef=本次序列）定向检查；作品编辑或关闭重开后旧计划/分页失效。跟踪记录的 subjectRef 可沿通用属性 video_edit.tracker.prompts 补充锚点纠正；scene 可选启用片子数据检查，scene_box_stale 表示数据错位，scene_cursor_jump 是鼠标瞬移候选，scene_issue 原样保留解析器 user 问题；subjectRef 指向片子数据记录，proposal 可沿通用属性修改后读回重查。不修改作品、播放头或选区。',
  aliases: ['自动看片位置', '跟踪复核', '剪辑检查点', '画面检查', '安全框检查', '文字抖动检查', '文字超框检查', '文字裁切检查'], readOnly: true, dataClasses: ['C1'], idempotent: true, destructive: false,
  timeoutMs: 300000, supportsPreview: false, supportsUndo: false, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence'], producesRefs: ['video_edit.scene_record', 'video_edit.scene', 'video_edit.clip', 'video_edit.tracker', 'video_edit.caption', 'video_edit.effect', 'video_edit.transition', 'video_edit.media'],
  inputSchema: z.object({ documentRef: ref('video_edit.document'), sequenceRef: ref('video_edit.sequence'), from: frame, to: frame, threshold: z.number().finite().min(0).max(1).default(.5), maxFrames: z.number().int().min(1).max(12).default(8), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(100).optional(),
    motion: z.object({ minGapSeconds: z.number().finite().min(0).max(30).default(1.5), minimumHoldSeconds: z.number().finite().min(0).max(60).default(1),
      pace: z.enum(['gentle', 'standard', 'brisk']).default('standard').describe('动作速度上限档，按使用者记忆或风格里的节奏偏好选：说过不过快/舒缓用 gentle（60% 画面宽/秒），偏快节奏用 brisk（150%），未提用 standard（100%）。超出返回 motion_too_fast。'),
      videoPixels: z.boolean().default(false).describe('分析原视频及代码视频/下方画面输入的来源候选；code_input_pixels.input 给参数、输入种类和媒体引用，不证明代码绘制或成片可见，不额外计入事件密度。固定取帧不继承原片运动；下方画面只追溯其原视频，不代替效果与代码合成复核。同源范围合并，最多300秒不同源区间、60000放置帧，输入映射最多200000次访问；分页不重算，文件变化须重查。') }).strict().optional().describe('复核原生变换与代码元素，elementPath 定位元素，父组动作去重。同时做画面检查：settled_jitter 停稳的文字/细线连续帧仍在小数像素爬动或来回跳（jitterPixels 为输出像素/帧）；safe_area 文字出标题安全框90%、关键元素出动作安全框93%（停稳时，含原生文字与字幕）；motion_too_fast 动作峰值超 pace 上限。suggestion 给时间与改法，确认后沿原属性或源码修改。文字用正式字体度量；声音驱动用正式混音及分析，取首个音频参数或下方轨道，最多32组、300秒完整声音上下文，视觉修改可复用。字体、声音或原文件变化须重查。保持不证明像素静止；videoPixels 启用源视频与代码画面输入采样。着色器、代码滤镜及输入的成片可见性仍须观察，风格与意图优先。'),
    scene: z.object({ checks: z.array(z.enum(['scene_box_stale', 'scene_cursor_jump', 'scene_issue'])).min(1).max(3).default(['scene_box_stale', 'scene_cursor_jump', 'scene_issue']),
      cursorJumpRatio: z.number().finite().min(0).max(1).default(.08), minSeconds: z.number().finite().min(0).max(60).default(.2),
    }).strict().optional().describe('片子数据复核：数据错位（生效时段的窗口最上层素材或源时间范围不符）、短叠化接缝的鼠标跳动、解析器 user 问题。cursorJumpRatio 按画面宽归一化，minSeconds 为连续错位最短播放秒数，按当前片段速度、倒放、嵌套与速度曲线换算；查询边界保留足够阈值上下文，开头在上下文外则写“此前已开始”。叠化未结束时旧画面仍可见，不算已换掉。只检查数据，不证明作者绘制或框可见。motionEvidence.basis=scene_data，不可读的引用返回警告，其他结果保留；计算预算与候选条数预算分开，超计算量时缩小范围。同一记录不同源区间、拆分与接缝分别返回；proposal 是 {ref,propertyId,value} 建议，只为当前页按需校验且可取消。只有连续错位到实际生效结束的尾部才给 end_cut，中段错位应拆分并保留后续正常部分。按目标组成通用 set_properties，describe 后 change 并读回重查。'),
  }).strict().refine(value => value.to > value.from, 'to 必须大于 from。'),
  outputSchema: z.object({ documentRef: ref('video_edit.document'), sequenceRef: ref('video_edit.sequence'), documentVersion: z.string().min(1), range,
    checkpoints: z.object({ frames: z.array(frame).max(12), selection: z.literal('prioritized_sample') }).strict(),
    records: z.array(z.object({ kind, timeline: range, sequenceRef: ref('video_edit.sequence'), subjectRef: applicationRefSchema,
      path: z.array(z.object({ sequenceRef: ref('video_edit.sequence'), clipRef: ref('video_edit.clip') }).strict()).max(8),
      confidence: z.number().finite().min(0).max(1).optional(), source: sourceRange.optional(),
      motionEvidence: z.object({ basis: z.enum(['clip_transform', 'structural_events', 'code_structure', 'video_pixels', 'code_input_pixels', 'text_layout', 'scene_data']), elementPath: z.array(z.string().min(1)).optional(), peakSpeed: z.number().finite().nonnegative().optional(), gapSeconds: z.number().finite().nonnegative().optional(), suggestion: z.string().min(1).max(1000),
        proposal: z.array(z.object({ ref: applicationRefSchema, propertyId: z.string().min(1), value: z.json() }).strict()).min(1).max(32).optional(),
        speedLimit: z.number().finite().positive().optional(), jitterPixels: z.number().finite().nonnegative().optional(),
        safeArea: z.object({ zone: z.enum(['title', 'action']), edges: z.array(z.enum(['left', 'right', 'top', 'bottom'])).min(1).max(4), overflowPercent: z.number().finite().nonnegative() }).strict().optional(),
        textOverflow: textOverflow.optional().describe('实际 drawText 绘制事实。text_overflow 完整内容超约束，text_clipped 正文墨迹出画幅或有效矩形 clip，text_truncated 存在 maxLines/maxHeight 遗漏。排版稳定或逐帧持续裁切至少0.3秒才报半开序列帧区间；位姿变化不影响超框和截断，未完成的字素揭示不判；矩阵为文字到作者画幅，inkQuad/effectiveClips 为查询序列输出像素，阴影不计正文缺失；任意 Canvas clip 与滤镜遮挡未覆盖，详见 warnings。'),
        input: z.object({ parameter: z.string().min(1), kind: z.enum(['video', 'sequence']), mediaRef: ref('video_edit.media') }).strict().optional(),
      }).strict().optional(),
    }).strict()).max(50), total: z.number().int().nonnegative(), nextCursor: z.string().nullable(), warnings: z.array(z.string()).max(20), message: z.string(),
  }).strict(),
  resolveOperationTargets: input => [input.documentRef, input.sequenceRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.sequence'], { revisionScopes: ['video_edit'], cancelable: true }), summarize: output => output.message,
})
