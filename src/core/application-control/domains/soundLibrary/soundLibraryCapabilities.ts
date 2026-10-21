import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
export const soundLibraryFolderRef = ref('sound_library.folder')
export const soundLibrarySoundRef = ref('sound_library.sound')
const folderStatus = z.enum(['not_indexed', 'indexing', 'ready', 'failed'])

export const addSoundLibraryFolderCapability = defineApplicationCapability({
  id: 'add_sound_library_folder', version: 1, domain: 'sound_library', title: '登记音效文件夹',
  description: '打开系统文件夹选择框，由用户选择自己收集的音效文件夹并登记；不接受路径参数，用户取消则不登记。登记后在后台递归整理（时长、起音点、击中点、响度、明暗；听音模型已下载时一并听音），只有第一次慢，之后按文件大小与修改时间增量更新。同一文件夹重复登记返回原文件夹。坏文件跳过，原因沿 sound_library.folder.skipped_files 读取。移除登记用 change_application_entities 删除 sound_library.folder（不删除任何文件）。',
  aliases: ['添加音效文件夹', '音效库', '我的音效', 'sound effects folder'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'settings:write', idempotent: false, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: ['sound_library'], acceptsRefs: [], producesRefs: ['sound_library.folder'],
  prerequisites: ['需要用户在弹出的文件夹选择框里选择；无人值守时会一直等待到超时。'],
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({ status: z.enum(['added', 'already_registered', 'cancelled']), resultRef: soundLibraryFolderRef.optional(), folderStatus: folderStatus.optional(), message: z.string(),
    verification: z.object({ verified: z.boolean(), condition: z.string() }).strict() }).strict(),
  concurrencyKey: 'sound_library', resolveOperationTargets: () => [], resolveOperationWriteTargets: () => [{ kind: 'sound_library.library', id: 'singleton' }],
  control: capabilityControl('execute', ['sound_library.folder'], { revisionScopes: ['sound_library'] }), summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: false, requireVerifiedEffects: false },
  resolveObservedEffects: (_input, result) => result.resultRef && result.status === 'added' ? [{ effect: 'execute', entityTypes: ['sound_library.folder'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }] : [],
})

const match = z.object({
  soundRef: soundLibrarySoundRef, folderRef: soundLibraryFolderRef,
  name: z.string(), englishName: z.string().nullable(), chineseName: z.string().nullable(), relativePath: z.string(),
  durationSeconds: z.number(), attackSeconds: z.number(), hitSeconds: z.number(),
  peakDbfs: z.number().nullable(), loudnessLufs: z.number().nullable(), brightness: z.enum(['dark', 'neutral', 'bright']).nullable(),
  score: z.number(), matchedBy: z.array(z.enum(['name', 'listening'])),
}).strict()

export const searchSoundEffectsCapability = defineApplicationCapability({
  id: 'search_sound_effects', version: 1, domain: 'sound_library', title: '按意图检索音效',
  description: '在用户登记的音效文件夹里找音效：名字匹配（中英文关键词互为备选，英文名更可靠，常见同义词如 whoosh/swoosh/swish 自动算命中；文件名里机翻的中文常错，如 Riser 标成“立管”、Pop 标成“流行”）+ 时长、击中点、明暗过滤；听音模型 audio_understanding_clap 已下载时，再按 description 融合“听起来像不像”。description 必须是英文的声音描述，由你把用户的中文意图翻译过去，越具体越好（如 "a short sharp whoosh"、"a bright ding bell"、"a deep heavy cinematic impact"）。keywords 同时给中英文（如 ["whoosh","嗖"]）。每条结果给出 hitSeconds（声音最响的击中点，卡点时对齐它而不是文件开头）、attackSeconds（起音点）、时长与响度。noGoodMatch=true 表示名字和听音都没有合适的，必须如实告诉用户“没有合适的”，不要硬选；matchedBy 为空的结果只是最接近。listening 说明听音是否参与：model_not_downloaded 时可建议用户下载听音模型（约 400 MB，写 local_model.item audio_understanding_clap downloaded=true）。第一次检索会先整理文件夹（700 个文件无模型约 30 秒，带听音约 1.5 分钟），之后很快。不修改任何文件或作品。',
  aliases: ['找音效', '挑音效', '音效检索', 'find sound effect', 'sfx search'], readOnly: true, risk: 'R0', dataClasses: ['C1'], permission: 'video_edit:read', idempotent: true, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: ['sound_library'], acceptsRefs: ['sound_library.folder'], producesRefs: ['sound_library.sound'],
  inputSchema: z.object({
    keywords: z.array(z.string().trim().min(1).max(80)).max(16).default([]).describe('名字关键词，中英文都给，互为备选。'),
    description: z.string().trim().min(1).max(300).regex(/^[\x20-\x7e]+$/, 'description 只接受英文描述（ASCII），请先把意图翻译成英文。').optional().describe('英文的声音描述，供听音模型比较。'),
    folderRefs: z.array(soundLibraryFolderRef).max(64).optional().describe('只在这些文件夹里找；省略为全部登记的文件夹。'),
    minDurationSeconds: z.number().nonnegative().max(3600).optional(), maxDurationSeconds: z.number().positive().max(3600).optional(),
    maxHitSeconds: z.number().nonnegative().max(3600).optional().describe('击中点最晚在声音第几秒；需要提前量短的音效时用。'),
    brightness: z.enum(['dark', 'neutral', 'bright']).optional().describe('明暗：dark 低沉、neutral 适中、bright 清脆明亮。'),
    limit: z.number().int().min(1).max(30).default(10),
  }).strict().refine(value => value.keywords.length > 0 || value.description !== undefined, 'keywords 与 description 至少给一个。')
    .refine(value => value.minDurationSeconds === undefined || value.maxDurationSeconds === undefined || value.maxDurationSeconds >= value.minDurationSeconds, 'maxDurationSeconds 不能小于 minDurationSeconds。'),
  outputSchema: z.object({ matches: z.array(match), noGoodMatch: z.boolean(), listening: z.enum(['used', 'no_description', 'model_not_downloaded', 'partial']), considered: z.number().int().nonnegative(), indexedSounds: z.number().int().nonnegative(), skippedFiles: z.number().int().nonnegative(), message: z.string() }).strict(),
  concurrencyKey: 'sound_library_search', resolveOperationTargets: input => input.folderRefs ?? [], resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['sound_library.sound'], { revisionScopes: ['sound_library'], cancelable: true }), summarize: result => result.message,
})

export const SOUND_LIBRARY_APPLICATION_CAPABILITIES = [addSoundLibraryFolderCapability, searchSoundEffectsCapability]
