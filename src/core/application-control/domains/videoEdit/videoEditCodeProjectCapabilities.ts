import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { defineApplicationCapability, capabilityControl } from '../shared/defineApplicationCapability'

const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
export const commitVideoEditCodeProjectCapability = defineApplicationCapability({
  id: 'commit_video_edit_code_project', version: 1, domain: 'video_edit', title: '提交代码工程外部修改',
  description: '把外部编辑器修改后的代码工程工作区保存为一次 Git 提交；读取 changes 不会提交。提交后素材仍固定原版本，需创建版本或升级素材。', aliases: ['提交工程源码', 'commit code project'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: true, destructive: false, timeoutMs: 60000, supportsPreview: false, supportsUndo: false,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document'], producesRefs: ['video_edit.code_project'],
  inputSchema: z.object({ documentRef, message: z.string().trim().min(1).max(2000) }).strict(),
  outputSchema: z.object({ resultRef: applicationRefSchema.extend({ kind: z.literal('video_edit.code_project') }).strict(), commit: z.string().regex(/^[a-f0-9]{40}$/), message: z.string(), verified: z.boolean() }).strict(),
  concurrencyKey: 'video_edit_code_project', resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('execute', ['video_edit.code_project'], { revisionScopes: ['video_edit'] }), summarize: output => output.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => [{ effect: 'execute', entityTypes: ['video_edit.code_project'], propertyIds: [], targetRefs: [output.resultRef], count: 1, verified: output.verified, evidence: output.verified ? ['已回读 HEAD 核对提交。'] : [] }],
})
