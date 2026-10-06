import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const modelRef = applicationRefSchema.extend({ kind: z.literal('local_model.item') }).strict()
export const cancelLocalModelDownloadCapability = defineApplicationCapability({
  id: 'cancel_local_model_download', version: 1, domain: 'local_models', title: '取消本地模型下载',
  description: '停止指定本地模型正在进行的下载，保留已经下载的部分，下次下载可续传。与设置页的取消按钮共用下载服务；不删除模型文件。没有正在进行的下载时返回当前状态，不重新下载。模型引用取自 local_model.item 列表，取消后可读 status 与 last_failure 核对。',
  aliases: ['停止模型下载', '取消下载模型'], readOnly: false, risk: 'R1', dataClasses: ['C0'],
  permission: 'settings:write', idempotent: true, destructive: false, timeoutMs: 60000,
  supportsPreview: false, supportsUndo: false, requiredScopes: ['local_models'],
  acceptsRefs: ['local_model.item'], producesRefs: ['local_model.item'],
  inputSchema: z.object({ modelRef }).strict(),
  outputSchema: z.object({ resultRef: modelRef, cancelled: z.boolean(), status: z.enum(['not_downloaded', 'downloading', 'ready', 'corrupt', 'unavailable']), message: z.string(),
    verification: z.object({ verified: z.boolean(), target: modelRef, condition: z.string() }).strict(),
  }).strict(),
  resolveConcurrencyKey: input => `local_model:${input.modelRef.id}`,
  resolveOperationTargets: input => [input.modelRef], resolveOperationWriteTargets: input => [input.modelRef],
  control: capabilityControl('execute', ['local_model.item'], { revisionScopes: ['local_models'] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => [{ effect: 'execute', entityTypes: ['local_model.item'], propertyIds: [], targetRefs: [output.resultRef], count: 1,
    verified: output.verification.verified, evidence: output.verification.verified ? [output.verification.condition] : [],
  }],
  summarize: output => output.message,
})
