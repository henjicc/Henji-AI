import { z } from 'zod'
import { applicationRefSchema, type ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

/*
 * 原地生成（4.12）：在剪辑时间线的指定位置生成镜头或声音并直接落进去。取参考帧、放占位、生成、落位是一个编排，
 * 不能用属性写入表达，所以是专用能力；付费提交前由宿主先跑 prepare 估价并占用自动生成额度（与生成能力同一套）。
 */
const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document')
const seconds = z.number().finite().min(0).max(1800)
const length = z.number().finite().positive().max(600)
const target = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('generate_shot'),
    startSeconds: seconds.describe('镜头在序列上的起点（秒）。'),
    durationSeconds: length.optional().describe('镜头长度（秒）。省略时填满起点所在的空隙；后面没有片段时按生成结果的实际长度。'),
    trackRef: ref('video_edit.track').optional().describe('放到哪条视频轨；省略时用目标轨道或第一条空着的视频轨，都被占用时新建一条。'),
  }).strict(),
  z.object({ action: z.literal('replace_shot'), clipRef: ref('video_edit.clip').describe('要换掉的视频或图片片段；新镜头同位置同长度，原镜头保留为可切回的版本。') }).strict(),
  z.object({
    action: z.literal('extend_shot'),
    clipRef: ref('video_edit.clip').describe('要延长的视频或图片片段；以它的最后一帧为首帧生成后续镜头，接在它后面。'),
    durationSeconds: length.optional().describe('续接镜头的长度（秒）；省略时按生成结果的实际长度。'),
    mode: z.enum(['insert', 'overwrite']).optional().describe('insert（默认）后面的片段后移让位；overwrite 覆盖后面的内容。'),
  }).strict(),
  z.object({
    action: z.literal('generate_audio'),
    startSeconds: seconds.optional().describe('配音或配乐的起点（秒）；与 clipRef 二选一。'),
    durationSeconds: length.optional().describe('长度（秒）；省略时填满起点所在的空隙。'),
    trackRef: ref('video_edit.track').optional().describe('放到哪条音频轨；省略时自动选空着的音频轨或新建。'),
    clipRef: ref('video_edit.clip').optional().describe('要换掉的声音片段（同位置同长度，原声音保留为可切回的版本）。'),
  }).strict().superRefine((value, context) => {
    if ((value.startSeconds === undefined) === (value.clipRef === undefined)) context.addIssue({ code: 'custom', path: ['startSeconds'], message: 'generate_audio 需要 startSeconds（新放一段）或 clipRef（替换声音片段）之一。' })
  }),
])
export const videoEditInPlaceInputSchema = z.object({
  documentRef,
  sequenceRef: ref('video_edit.sequence').optional().describe('目标序列；省略时用剪辑当前打开的序列。'),
  target,
  prompt: z.string().trim().min(1).max(32 * 1024).describe('要生成的画面或声音内容。配音时就是要念的台词。'),
  modelId: z.string().trim().min(1).max(200).optional().describe('生成模型；省略时用默认模型里已配置且能接受这次输入的。镜头用视频模型（图片模型生成静帧），配音配乐用声音模型。'),
  params: z.record(z.string(), z.unknown()).optional().describe('模型参数（取自 get_model_schema）；时长与画面比例已按落点和序列自动换算，一般不用传。'),
  useReferenceFrames: z.boolean().optional().describe('是否带入参考帧（默认 true）：生成镜头带前一镜头尾帧与后一镜头首帧，替换带原镜头首帧，延长带原镜头尾帧；超过模型可接受的图片数量时只带前面的。'),
}).strict()
export type VideoEditInPlaceCapabilityInput = z.infer<typeof videoEditInPlaceInputSchema>

const taskRef = ref('generation.task')
const planOutput = z.object({
  action: z.enum(['generate_shot', 'replace_shot', 'extend_shot', 'generate_audio']), sequenceRef: ref('video_edit.sequence'), startSeconds: z.number(), durationSeconds: z.number(),
  trackRef: ref('video_edit.track').nullable(), placement: z.enum(['add', 'replace', 'insert', 'overwrite']), references: z.array(z.string()),
}).strict()
const prepareOutput = z.object({
  documentRef, plan: planOutput,
  preparation: z.object({ prepared: z.literal(true), modelId: z.string().min(1), providerId: z.string().min(1), mediaType: z.enum(['image', 'video', 'audio']), options: z.record(z.string(), z.unknown()) }).passthrough(),
  message: z.string(),
}).strict()
export const prepareVideoEditInPlaceGenerationCapability = defineApplicationCapability({
  id: 'prepare_video_edit_in_place_generation', title: '检查原地生成', description: '原地生成提交前的检查：按剪辑当前状态算出落点、长度、轨道与要带入的参考帧，校验模型与参数并给出预估费用。不取帧、不生成、不改剪辑。',
  version: 1, domain: 'video_edit', aliases: ['原地生成估价', '检查生成镜头'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.track', 'video_edit.clip', 'generation.model'], producesRefs: ['generation.preparation'],
  inputSchema: videoEditInPlaceInputSchema, outputSchema: prepareOutput,
  concurrencyKey: 'video_edit_in_place_prepare', resolveConcurrencyKey: parsed => `video_edit_in_place_prepare:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.document', 'generation.preparation']), summarize: result => result.message,
})

const generateOutput = z.object({ documentRef, taskRef, plan: planOutput, status: z.literal('submitted'), message: z.string() }).strict()
export const generateVideoEditInPlaceCapability = defineApplicationCapability({
  id: 'generate_video_edit_in_place', title: '在剪辑时间线原地生成',
  description: '缺镜头、要换画面、要配音时在时间线上直接生成并落进当前位置：generate_shot 在指定秒数生成镜头（如“3 秒处生成 4 秒的日落空镜”= startSeconds 3、durationSeconds 4），replace_shot 把片段换成新生成的版本（原镜头保留，可用 restore_video_edit_clip_take 切回），extend_shot 以片段尾帧续接后续镜头，generate_audio 生成配音或配乐。自动带入参考帧并按序列画幅与落点换算模型的时长和比例。提交后时间线上立刻出现占位，用户可以继续剪辑；生成完成后结果复制进项目素材并一步落进时间线（一次撤销），生成期间原落点被占用时改放到新轨道。返回生成任务 taskRef：用 wait_generation_task 等待，再用 get_video_edit_in_place_generation 读取落位结果；cancel_generation_task 取消会一并撤回占位。会产生付费生成。',
  version: 1, domain: 'video_edit', aliases: ['原地生成', '补镜头', '生成镜头', '替换镜头', '延长镜头', '配音', '配乐', 'generate shot in timeline'], readOnly: false, risk: 'R2', dataClasses: ['C1'], permission: 'generation:create', idempotent: true, destructive: false, timeoutMs: 180000, supportsPreview: false, supportsUndo: false,
  completionKind: 'submitted',
  requiredScopes: ['video_edit', 'generation'], acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.track', 'video_edit.clip', 'generation.model'], producesRefs: ['generation.task'],
  successEvidence: ['返回已提交的生成任务 taskRef；落进时间线须再用 get_video_edit_in_place_generation 确认 status=placed。'],
  failureRecovery: ['提交前失败不留任何占位与剪辑修改，按错误修正落点、模型或参数后重试；生成失败时占位保留错误，可再次调用本能力（换模型）。'],
  executionPrerequisites: ['prepare_video_edit_in_place_generation'], paidGenerationPreparation: 'prepare_video_edit_in_place_generation',
  inputSchema: videoEditInPlaceInputSchema, outputSchema: generateOutput,
  concurrencyKey: 'video_edit_in_place', resolveConcurrencyKey: parsed => `video_edit_in_place:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef], resolveOperationWriteTargets: parsed => [parsed.documentRef],
  control: capabilityControl('execute', ['generation.task'], { revisionScopes: ['generation', 'video_edit'], verificationRequired: false, resultState: 'submitted', alsoImpacts: [{ effect: 'create', entityTypes: ['generation.task'] }] }),
  resolveObservedEffects: (_input, output) => [
    { effect: 'execute', entityTypes: ['generation.task'], propertyIds: [], targetRefs: [output.taskRef], count: 1, verified: false, evidence: [`generation.task:${output.taskRef.id}:submitted`] },
    { effect: 'create', entityTypes: ['generation.task'], propertyIds: [], targetRefs: [output.taskRef], count: 1, verified: false, evidence: [`generation.task:${output.taskRef.id}:created`] },
  ],
  summarize: result => result.message,
})

const statusOutput = z.object({
  documentRef, taskRef, status: z.enum(['preparing', 'generating', 'placing', 'failed', 'placed', 'cancelled']), progress: z.number().min(0).max(100).optional(),
  clipRef: ref('video_edit.clip').optional(), error: z.string().optional(), message: z.string(),
}).strict()
export const getVideoEditInPlaceGenerationCapability = defineApplicationCapability({
  id: 'get_video_edit_in_place_generation', title: '读取原地生成状态', description: '按生成任务 taskRef 读取一次原地生成：生成中、正在落位、已落进时间线（返回新片段 clipRef）、失败（原因）或已取消。',
  version: 1, domain: 'video_edit', aliases: ['原地生成进度', '镜头生成好了吗'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false, timeoutMs: 30000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'generation.task'], producesRefs: ['video_edit.clip'],
  inputSchema: z.object({ documentRef, taskRef }).strict(), outputSchema: statusOutput,
  concurrencyKey: 'video_edit_in_place_read', resolveConcurrencyKey: parsed => `video_edit_in_place_read:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.clip', 'generation.task']), summarize: result => result.message,
})

const switchOutput = z.object({ resultRef: ref('video_edit.clip'), documentRef, message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: ref('video_edit.clip') }) }).strict()
export const switchVideoEditClipTakeCapability = defineApplicationCapability({
  id: 'restore_video_edit_clip_take', title: '切回片段的其他镜头版本', description: '片段被替换过（原地生成的替换镜头、配音替换）后，切换到它记着的其他版本：takeIndex 对应片段属性 takes 里的序号（0 为最近替换下来的那个）。位置、变换与效果不动，当前画面变成可切回的版本；一步撤销。',
  version: 1, domain: 'video_edit', aliases: ['切回原镜头', '换回原来的', '恢复原片段'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 30000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.clip'],
  inputSchema: z.object({ documentRef, clipRef: ref('video_edit.clip'), takeIndex: z.number().int().min(0).max(7).optional().describe('takes 里的序号，默认 0。') }).strict(), outputSchema: switchOutput,
  concurrencyKey: 'video_edit', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef, parsed.clipRef], resolveOperationWriteTargets: parsed => [parsed.documentRef],
  control: capabilityControl('execute', ['video_edit.clip'], { cancelable: false, revisionScopes: ['video_edit'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => [{ effect: 'execute', entityTypes: ['video_edit.clip'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }],
})

export const VIDEO_EDIT_IN_PLACE_GENERATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  prepareVideoEditInPlaceGenerationCapability, generateVideoEditInPlaceCapability, getVideoEditInPlaceGenerationCapability, switchVideoEditClipTakeCapability,
] as ApplicationCapabilityDefinition[]
