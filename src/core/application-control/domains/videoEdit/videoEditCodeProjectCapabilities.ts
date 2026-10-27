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
const materialRef = applicationRefSchema.extend({ kind: z.literal('video_edit.code_material') }).strict()
export const upgradeVideoEditCodeMaterialsCapability = defineApplicationCapability({
  id: 'upgrade_video_edit_code_materials', version: 1, domain: 'video_edit', title: '升级工程代码素材',
  description: '按指定提交（默认 HEAD）重算工程入口闭包，只升级内容变化的素材，设为默认并改指使用旧版本的素材项、片段和附加效果。所有检查通过才一次修改，可经剪辑撤销。未变化的素材跳过；若内容已有历史版本则复用该版本。', aliases: ['刷新片子代码', '升级工程入口'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'video_edit:write', idempotent: true, destructive: false, timeoutMs: 120000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.code_material'], producesRefs: ['video_edit.code_version', 'video_edit.code_material', 'video_edit.clip', 'video_edit.item', 'video_edit.effect'],
  inputSchema: z.object({ documentRef, materialRefs: z.array(materialRef).min(1).optional(), commit: z.string().regex(/^[a-f0-9]{40}$/).optional() }).strict(),
  outputSchema: z.object({ commit: z.string(), upgrades: z.array(z.object({ materialRef, oldVersion: z.string(), newVersion: z.string(), changedFiles: z.array(z.string()), retargetedClips: z.number().int().nonnegative() }).strict()), resultRefs: z.array(applicationRefSchema), verified: z.boolean(), message: z.string() }).strict(),
  concurrencyKey: 'video_edit', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef, ...(input.materialRefs ?? [])], resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('update', ['video_edit.code_material', 'video_edit.clip', 'video_edit.item', 'video_edit.effect'], { revisionScopes: ['video_edit'], alsoImpacts: [{ effect: 'create', entityTypes: ['video_edit.code_version'] }] }),
  resolveObservedEffects: (_input, output) => ['video_edit.code_version', 'video_edit.code_material', 'video_edit.clip', 'video_edit.item', 'video_edit.effect'].flatMap(type => {
    const refs = output.resultRefs.filter(ref => ref.kind === type)
    return refs.length ? [{ effect: type === 'video_edit.code_version' ? 'create' as const : 'update' as const, entityTypes: [type], propertyIds: [], targetRefs: refs, count: refs.length, verified: output.verified, evidence: ['已回读升级后的版本与片段引用。'] }] : []
  }), summarize: output => output.message,
})
