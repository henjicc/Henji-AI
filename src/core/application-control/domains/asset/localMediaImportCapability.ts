import { z } from 'zod'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const assetRef = z.object({ kind: z.literal('asset'), id: z.string().min(1) }).strict()

export const importLocalMediaCapability = defineApplicationCapability({
  id: 'import_local_media', version: 1, title: '按本机路径导入素材', domain: 'assets',
  description: '可直接导入任意本机绝对路径，无需复制进项目或弹窗；链接原文件，需要复制进项目时用 collect_document_media 收集媒体，后续使用返回的引用。UNC 路径会让系统向该主机自动认证。支持图片、视频和音频文件，验证实际格式后登记到素材库，返回 assetRef，可接着加入画布、剪辑或打开图片编辑器。文件夹递归导入剪辑请用 import_video_edit_folder 的 paths。',
  aliases: ['导入本地素材', '按路径导入', 'import local media', '外部文件导入'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'assets:write', idempotent: false, destructive: false,
  timeoutMs: 120_000, supportsPreview: false, supportsUndo: false, requiredScopes: ['assets'], producesRefs: ['asset'],
  inputSchema: z.object({ path: z.string().min(1).max(32767).describe('用户授权的本机绝对文件路径，支持盘符、映射盘与 UNC 网络共享。') }).strict(),
  outputSchema: z.object({ assetRef, name: z.string(), mediaType: z.enum(['image', 'video', 'audio']), sizeBytes: z.number().nonnegative(), reused: z.boolean(),
    verification: z.object({ verified: z.literal(true), condition: z.string(), target: assetRef }).strict() }).strict(),
  control: capabilityControl('execute', ['asset'], { revisionScopes: ['assets'], alsoImpacts: [{ effect: 'create', entityTypes: ['asset'] }] }), concurrencyKey: 'assets_import',
  resolveOperationTargets: () => [],
  resolveOperationWriteTargets: (_input, operationId) => [{ kind: 'asset', id: `pending:${operationId}` }],
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => {
    const result = { entityTypes: ['asset'], propertyIds: [], targetRefs: [output.assetRef], count: 1, verified: output.verification.verified, evidence: [output.verification.condition] }
    return [{ ...result, effect: 'execute' as const }, ...(output.reused ? [] : [{ ...result, effect: 'create' as const }])]
  },
  successEvidence: ['主进程核验真实媒体格式，素材库回读确认原文件引用已登记。'],
  failureRecovery: ['按返回的文件名、错误码和原因修正路径、权限或格式后重试。导入后请保留原文件；如需取消收录，通过素材库删除此引用。'],
  summarize: output => `已导入“${output.name}”，可继续使用素材引用。`,
})
