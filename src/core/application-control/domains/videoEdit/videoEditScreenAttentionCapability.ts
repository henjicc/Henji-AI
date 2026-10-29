import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { screenAttentionSettingsSchema } from '../../../videoEdit/screenAttention'
import { videoEditReframeSizeSchema } from '../../../videoEdit/reframe'
const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document'); const sequenceRef = ref('video_edit.sequence'); const clipRef = ref('video_edit.clip')
const input = z.object({
  documentRef, clipRef: clipRef.optional(), sequenceRef: sequenceRef.optional(),
  targetSize: videoEditReframeSizeSchema.optional().describe('仅 sequenceRef 可用；指定时复制成新画幅，如9:16用1080×1920、1:1用1080×1080。省略则重算原序列。'),
  name: z.string().trim().min(1).max(200).optional(),
  settings: screenAttentionSettingsSchema.default({ strength: 'medium', minimumStaySeconds: 1.2, transitionSeconds: 0.45, sections: [] }),
}).strict().refine(value => Boolean(value.clipRef) !== Boolean(value.sequenceRef), 'clipRef 与 sequenceRef 必须二选一。').refine(value => !value.clipRef || !value.targetSize, 'clipRef 使用所属序列画幅，不能指定 targetSize。').refine(value => !value.name || Boolean(value.targetSize), 'name 仅用于 targetSize 创建的新序列。')
const output = z.object({ documentRef, resultRef: sequenceRef, clipRefs: z.array(clipRef), created: z.boolean(), quietFrames: z.number().int().nonnegative(), impreciseCapabilities: z.number().int().nonnegative(), verified: z.boolean(), message: z.string() }).strict()
export const screenAttentionVideoEditCapability = defineApplicationCapability<z.infer<typeof input>, z.infer<typeof output>>({
  id: 'generate_video_edit_screen_attention', title: '生成或重算录屏注意力推近',
  description: '根据屏幕原片的录制事件自动推近并跟随关注区域：能力调用优先，再是持续打字、点击、滚动、光标停留和窗口切换；没有信号时平滑退回全景（竖版保留覆盖画幅的全景取景）。strength light/medium/strong 表示轻/中/强；minimumStaySeconds 最短关注停留，transitionSeconds 过渡时长。settings.sections 可按片段内秒指定段落力度，升序、不重叠且不能超出片段。clipRef 处理单片段，sequenceRef 处理序列里的屏幕原片；targetSize 复制多画幅序列，省略则原位重算。所有生成点可通过片段 x/y/scale.keyframes 读写，修改后归人所有，重算保留；一步撤销。需要原片已绑定录制事件日志；打字区域没有精确捕获框时用近期文本光标或点击位置估计，能力没有捕获时的目标框时用近期光标/点击或窗口估计并返回 impreciseCapabilities，不能声称识别了输入框或历史DOM。不付费、不切页。',
  version: 1, domain: 'video_edit', aliases: ['录屏推近', '注意力跟随', '重算推近', 'screen attention', '自动缩放录屏'],
  readOnly: false, dataClasses: ['C1'], idempotent: false, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'],
  acceptsRefs: ['video_edit.document', 'video_edit.clip', 'video_edit.sequence'], producesRefs: ['video_edit.clip', 'video_edit.sequence'],
  inputSchema: input, outputSchema: output, concurrencyKey: 'video_edit', resolveConcurrencyKey: value => `video_edit:${value.documentRef.id}`,
  resolveOperationTargets: value => [value.documentRef, value.clipRef ?? value.sequenceRef!], resolveOperationWriteTargets: value => [value.documentRef, value.clipRef ?? value.sequenceRef!],
  control: capabilityControl('execute', ['video_edit.sequence', 'video_edit.clip'], { propertyIds: ['video_edit.clip.x.keyframes', 'video_edit.clip.y.keyframes', 'video_edit.clip.scale.keyframes'], cancelable: true, revisionScopes: ['video_edit'] }),
  summarize: value => value.message, verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, value) => [{ effect: 'execute', entityTypes: ['video_edit.sequence', 'video_edit.clip'], propertyIds: ['video_edit.clip.x.keyframes', 'video_edit.clip.y.keyframes', 'video_edit.clip.scale.keyframes'], targetRefs: [value.resultRef, ...value.clipRefs], count: value.clipRefs.length, verified: value.verified, evidence: value.verified ? ['已从保存后的剪辑核对注意力推近关键帧。'] : [] }],
})
