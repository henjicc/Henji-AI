import { z } from 'zod'

import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document')

/** 一次回执里逐项列出的上限；超出部分仍已导入，按 video_edit.item 列表读取。 */
export const VIDEO_EDIT_PROJECT_IMPORT_ITEM_LIMIT = 500
export const VIDEO_EDIT_PROJECT_IMPORT_SKIP_LIMIT = 200
export const VIDEO_EDIT_PROJECT_IMPORT_SKIP_REASONS = ['unsupported', 'duplicate', 'unreadable', 'repeated_folder', 'outside_project'] as const

const importedItem = z.object({
  itemRef: ref('video_edit.item'), mediaRef: ref('video_edit.media'), binRef: ref('video_edit.bin').nullable(),
  relativePath: z.string().describe('素材原文件在项目文件夹里的相对路径。'),
  status: z.enum(['imported', 'reused']).describe('imported 本次新建的素材项；reused 同一素材箱里已有同一文件，没有重复导入。'),
}).strict()
const skippedEntry = z.object({
  relativePath: z.string(),
  reason: z.enum(VIDEO_EDIT_PROJECT_IMPORT_SKIP_REASONS),
  message: z.string(),
}).strict()
const output = z.object({
  resultRef: documentRef,
  items: z.array(importedItem).max(VIDEO_EDIT_PROJECT_IMPORT_ITEM_LIMIT),
  skipped: z.array(skippedEntry).max(VIDEO_EDIT_PROJECT_IMPORT_SKIP_LIMIT),
  importedCount: z.number().int().nonnegative(), reusedCount: z.number().int().nonnegative(), skippedCount: z.number().int().nonnegative(),
  truncated: z.boolean().describe('items 或 skipped 超过逐项上限时为 true；其余素材项已经导入，可读 video_edit.item 列表。'),
  message: z.string(),
  verification: z.object({ verified: z.boolean(), condition: z.string(), target: documentRef }).strict(),
}).strict()

/** 不弹窗导入项目文件夹里的素材：路径校验在主进程按真实路径完成，导入复用拖入与文件夹导入的同一服务。 */
export const importVideoEditProjectFilesCapability = defineApplicationCapability({
  id: 'import_video_edit_project_files', version: 1, domain: 'video_edit', title: '导入项目文件夹里的素材',
  description: '把剪辑所在项目文件夹里的文件或文件夹直接导入素材面板，不弹选择窗口。只能导入当前项目文件夹里的文件，paths 按项目内相对路径给出（如 素材/截图/产品主页.png、素材/截图），1–64 条；绝对路径、盘符、“..”以及真实位置在项目外的符号链接或联接点一律拒绝，回执点名是哪条路径、为什么，这时什么也不导入。要导入项目外的文件用 import_video_edit_folder 的 paths，直接提供绝对路径；剪辑不在项目里时拒绝。文件夹按剪辑设置递归建同名素材箱，素材引用原文件、不复制，默认跳过已在同一素材箱里的文件。binRef 指定放进哪个已有素材箱，省略时放在素材面板顶层。返回每个素材项的 itemRef、mediaRef、所在素材箱与相对路径（imported 新导入，reused 已有同一文件），以及跳过的文件与原因：unsupported 格式不支持，duplicate 重复，unreadable 读不出或无法解码，repeated_folder 目录回环或重复给出，outside_project 文件夹里的链接指向项目外。与拖入、import_video_edit_folder 共用导入队列，进度可读 video_edit.document.media_import；每次请求一步撤销，取消保留已完成部分。',
  aliases: ['导入项目文件', '导入项目素材', '按路径导入素材', '项目文件夹导入', 'import project files'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: false, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.bin'], producesRefs: ['video_edit.item', 'video_edit.media'],
  prerequisites: ['剪辑必须在项目里，要导入的文件已经放在该项目文件夹内。'],
  successEvidence: ['剪辑文件回读与内存一致；回执逐项给出新建或复用的素材项、媒体与跳过原因。'],
  failureRecovery: ['路径被拒绝时按点名的原因改成项目内相对路径后重试；项目外的素材用 import_video_edit_folder 的 paths 提供绝对路径；目标素材箱不存在时重新读取 video_edit.bin；部分导入后失败或取消时不要重复导入，先读回剪辑或撤销本次导入。'],
  inputSchema: z.object({
    documentRef,
    paths: z.array(z.string().min(1).max(1024)).min(1).max(64).describe('项目文件夹里的相对路径（/ 或 \\ 分隔），文件或文件夹均可，例如 素材/截图/产品主页.png、素材/截图。'),
    binRef: ref('video_edit.bin').optional().describe('放进哪个已有素材箱（取自 video_edit.bin 列表，须属于这份剪辑）；省略时放在顶层。'),
  }).strict(),
  outputSchema: output,
  concurrencyKey: 'video_edit', resolveConcurrencyKey: parsed => `video_edit:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef, ...(parsed.binRef ? [parsed.binRef] : [])], resolveOperationWriteTargets: parsed => [parsed.documentRef],
  control: capabilityControl('execute', ['video_edit.document'], { cancelable: true, revisionScopes: ['video_edit'], alsoImpacts: [{ effect: 'create', entityTypes: ['video_edit.item', 'video_edit.media', 'video_edit.bin'] }] }),
  summarize: result => result.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => {
    const verified = result.verification.verified
    const evidence = verified ? [result.verification.condition] : []
    const created = result.items.filter(item => item.status === 'imported').map(item => item.itemRef)
    return [
      { effect: 'execute' as const, entityTypes: ['video_edit.document'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified, evidence },
      // Effect 回执的引用与计数有固定上限；完整数量在 importedCount。
      ...(result.importedCount ? [{ effect: 'create' as const, entityTypes: ['video_edit.item'], propertyIds: [], targetRefs: created.slice(0, 128), count: Math.min(result.importedCount, 256), verified, evidence }] : []),
    ]
  },
})
