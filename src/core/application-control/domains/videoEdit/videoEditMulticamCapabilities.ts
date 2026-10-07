import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document'); const sequenceRef = ref('video_edit.sequence'); const clipRef = ref('video_edit.clip'); const itemRef = ref('video_edit.item')
const output = z.object({ resultRef: documentRef, sequenceRef, itemRef: itemRef.optional(), clipRefs: z.array(clipRef), message: z.string(), verification: z.object({ verified: z.boolean(), target: documentRef, condition: z.string() }).strict() }).strict()
const shared = { version: 1, domain: 'video_edit', readOnly: false, risk: 'R1' as const, dataClasses: ['C1' as const], permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 600000, supportsPreview: false, supportsUndo: true, requiredScopes: ['video_edit'], producesRefs: ['video_edit.sequence', 'video_edit.item', 'video_edit.clip'], outputSchema: output,
  control: capabilityControl('execute', ['video_edit.document', 'video_edit.sequence', 'video_edit.item', 'video_edit.clip'], { cancelable: true, revisionScopes: ['video_edit'] }),
  verificationContract: { kind: 'effect_receipt' as const, requireEffects: true, requireVerifiedEffects: true },
}
export const createVideoEditMulticamCapability = defineApplicationCapability({ ...shared,
  control: capabilityControl('execute', ['video_edit.document'], { cancelable: true, revisionScopes: ['video_edit'], alsoImpacts: [{ effect: 'create', entityTypes: ['video_edit.sequence', 'video_edit.item', 'video_edit.clip'] }] }),
  id: 'create_video_edit_multicam', title: '创建多机位源序列', aliases: ['多机位同步', '按声音同步摄像机', 'create multicamera source sequence'],
  description: '选至少2个视频素材创建同步的多机位嵌套源序列，每机位一轨，可一步撤销。sync=audio 免费本地按共同声音同步，in_points 按各素材入点对齐，timecode 按时间码秒值对齐。cameras 顺序就是机位顺序，可标注说话人；audioCameraIndex 为从0起的固定主音频机位，默认0，切换画面不换声音。inPointSeconds 为素材绝对秒（省略用子剪辑入点），timecodeSeconds 为文件起点的时间码秒值。返回sequenceRef/itemRef，可通过通用video_edit.clip集合放入父序列；切换段使用video_edit.clip.multicam_camera_id通用属性。静音或不能可靠同步时拒绝并提示改用入点/时间码，不会部分创建。',
  acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.item'],
  inputSchema: z.object({ documentRef, templateSequenceRef: sequenceRef, name: z.string().trim().min(1).max(200), sync: z.enum(['audio', 'in_points', 'timecode']).default('audio'), cameras: z.array(z.object({ itemRef, name: z.string().trim().min(1).max(200).optional(), speaker: z.string().trim().max(200).optional(), inPointSeconds: z.number().finite().nonnegative().optional(), timecodeSeconds: z.number().finite().nonnegative().optional() }).strict()).min(2), audioCameraIndex: z.number().int().nonnegative().optional() }).strict(),
  resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`, resolveOperationTargets: input => [input.documentRef, input.templateSequenceRef, ...input.cameras.map(camera => camera.itemRef)], resolveOperationWriteTargets: input => [input.documentRef],
  resolveObservedEffects: (_input, result) => {
    const receipt = { propertyIds: [], verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }
    return [{ ...receipt, effect: 'execute', entityTypes: ['video_edit.document'], targetRefs: [result.resultRef], count: 1 }, { ...receipt, effect: 'create', entityTypes: ['video_edit.sequence'], targetRefs: [result.sequenceRef], count: 1 }, ...(result.itemRef ? [{ ...receipt, effect: 'create' as const, entityTypes: ['video_edit.item'], targetRefs: [result.itemRef], count: 1 }] : []), { ...receipt, effect: 'create', entityTypes: ['video_edit.clip'], targetRefs: result.clipRefs, count: result.clipRefs.length }]
  }, summarize: result => result.message,
})
export const autoSwitchVideoEditMulticamCapability = defineApplicationCapability({ ...shared,
  id: 'auto_switch_video_edit_multicam', title: '建议多机位切换', aliases: ['自动切机位', '多机位跟随说话人', 'multicam auto switching'],
  description: '为时间线中的一个多机位片段生成机位切换段，一步撤销。默认检测每机位声音活动，切到有声且音量最大的机位；静音与近似音量保持上个机位，minimumSeconds 是最短镜头秒数（默认2），sensitivity 为活动检测灵敏度0–100（默认50）。也可提供speech说话人区间，startSeconds/endSeconds相对该时间线片段起点，speaker需匹配源序列multicam.cameras的用户标注；不做说话人身份识别。主音频保持不变，可用滚动编辑微调切点，用video_edit.clip.multicam_camera_id换某段机位。分析取消、关闭或内容改变时不落入旧目标。',
  acceptsRefs: ['video_edit.document', 'video_edit.clip'],
  inputSchema: z.object({ documentRef, clipRef, minimumSeconds: z.number().min(.2).max(30).optional(), sensitivity: z.number().min(0).max(100).optional(), speech: z.array(z.object({ startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().positive(), speaker: z.string().trim().min(1).max(200) }).strict().refine(turn => turn.endSeconds > turn.startSeconds, '说话人区间结束须晚于开始。')).optional() }).strict(),
  resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`, resolveOperationTargets: input => [input.documentRef, input.clipRef], resolveOperationWriteTargets: input => [input.documentRef],
  resolveObservedEffects: (_input, result) => [{ effect: 'execute', entityTypes: ['video_edit.document'], propertyIds: [], targetRefs: [result.resultRef], count: 1, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }, ...Array.from({ length: Math.ceil(result.clipRefs.length / 128) }, (_, index) => ({ effect: 'execute' as const, entityTypes: ['video_edit.clip'], propertyIds: [], targetRefs: result.clipRefs.slice(index * 128, (index + 1) * 128), count: result.clipRefs.slice(index * 128, (index + 1) * 128).length, verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }))], summarize: result => result.message,
})
export const VIDEO_EDIT_MULTICAM_CAPABILITIES = [createVideoEditMulticamCapability, autoSwitchVideoEditMulticamCapability]
