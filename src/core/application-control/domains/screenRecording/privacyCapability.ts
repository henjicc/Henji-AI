import { z } from 'zod'
import { ocrQualitySchema } from '../../../../platform/contracts/ocrPrivacy'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'
export const detectRecordingPrivacyCapability = defineApplicationCapability({
  id: 'detect_screen_recording_sensitive_text', version: 1, domain: 'screen_recording', title: '找出录屏敏感信息',
  description: '在本机读取已停止或恢复会话的屏幕原片，识别邮箱、手机号、身份证、银行卡、常见密钥及URL凭据，生成待确认打码候选和移动轨迹。首次使用按需下载本地文字模型，不上传画面、不付费。替换 understanding.result.privacy，其他步骤保留；候选不自动生效。用 screen_recording.understanding.result 通用属性将候选 status 改成 accepted/rejected，可逐条或全部确认。快速滚动、短暂闪现、低清或旋转文字仍须人工复核；只保存脱敏提示，不保存原文密钥。',
  aliases: ['录屏隐私', '候选打码', '找敏感信息'], readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'screen_recording:write',
  idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: true, requiredScopes: [], concurrencyKey: 'screen_recording',
  inputSchema: z.object({ quality: ocrQualitySchema, sessionRef: z.object({ kind: z.literal('screen_recording.session'), id: z.string().uuid() }).strict() }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: z.object({ kind: z.literal('screen_recording.understanding'), id: z.string() }).strict(), candidates: z.number().int().nonnegative(), undoRef: z.string().optional(), verified: z.boolean() }),
  acceptsRefs: ['screen_recording.session'], producesRefs: ['screen_recording.understanding'],
  resolveOperationTargets: input => [input.sessionRef, { kind: 'screen_recording.understanding', id: input.sessionRef.id }],
  resolveOperationWriteTargets: input => [{ kind: 'screen_recording.understanding', id: input.sessionRef.id }], resolveConcurrencyKey: input => `screen_recording:${input.sessionRef.id}`,
  control: capabilityControl('update', ['screen_recording.understanding'], { cancelable: true }),
  resolveObservedEffects: (_input, result) => [{ effect: 'update', entityTypes: ['screen_recording.understanding'], propertyIds: ['screen_recording.understanding.result'], targetRefs: [result.resultRef], count: 1, verified: result.verified, evidence: result.verified ? ['敏感候选已保存回读。'] : [] }],
  summarize: result => `已生成 ${result.candidates} 个待确认打码候选。`,
})
