import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { sceneApplyOptionsSchema, sceneCutsSchema, sceneSensitivitySchema } from '../../../videoEdit/sceneDetection'

const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const clipRef = applicationRefSchema.extend({ kind: z.literal('video_edit.clip') }).strict()
const target = z.object({ documentRef, clipRef }).strict()
const analysis = z.object({ analysisId: z.string().min(1).max(100), cutsSeconds: sceneCutsSchema, cutFrames: z.array(z.number().int().nonnegative()) }).strict()
const detectInput = target.extend({ sensitivity: sceneSensitivitySchema.default(50) })
const detectOutput = analysis.extend({ resultRef: documentRef, message: z.string() })
const common = { version: 1, domain: 'video_edit' as const, dataClasses: ['C1'] as ['C1'], destructive: false, supportsPreview: false, requiredScopes: ['video_edit'] as ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.document'], resolveConcurrencyKey: (input: z.infer<typeof target>) => `video_edit:${input.documentRef.id}`, resolveOperationTargets: (input: z.infer<typeof target>) => [input.documentRef, input.clipRef] }
export const detectVideoEditScenesCapability = defineApplicationCapability<z.infer<typeof detectInput>, z.infer<typeof detectOutput>>({
  ...common, id: 'detect_video_edit_scenes', title: '检测视频片段的镜头切换', description: '免费本地后台检测一个原视频片段所用的源范围（最长24小时），返回源时间 cutsSeconds（从原文件起点计秒）、当前序列整数帧 cutFrames 与 analysisId。灵敏度0只保留明显切换，100包含细微变化，默认50；裁剪、变速和倒放按当前片段换算。检测不改剪辑，可取消；原剪辑或源视频改变后结果失效。随后用 apply_video_edit_scenes 按结果批量应用，不要逐切点调用拆分。',
  aliases: ['场景编辑检测', '镜头切换', 'scene detection'], readOnly: true, risk: 'R0', permission: 'video_edit:read', idempotent: true, timeoutMs: 600000, supportsUndo: false,
  inputSchema: detectInput, outputSchema: detectOutput, resolveOperationWriteTargets: () => [],
  control: capabilityControl('observe', ['video_edit.clip'], { revisionScopes: ['video_edit'], cancelable: true }), summarize: result => result.message,
})
const changedRef = applicationRefSchema.extend({ kind: z.enum(['video_edit.clip', 'video_edit.marker', 'video_edit.item']) }).strict()
const applyInput = target.extend({ analysisId: z.string().min(1).max(100).describe('原检测返回的analysisId，不猜测；关闭剪辑、改动剪辑或视频后须重新检测。'), options: sceneApplyOptionsSchema })
const applyOutput = z.object({ resultRef: documentRef, changedRefs: z.array(changedRef).max(1500), cutFrames: analysis.shape.cutFrames, message: z.string(), verified: z.boolean() }).strict()
export const applyVideoEditScenesCapability = defineApplicationCapability<z.infer<typeof applyInput>, z.infer<typeof applyOutput>>({
  ...common, id: 'apply_video_edit_scenes', title: '把检测到的镜头切点应用到剪辑', description: '消费 detect_video_edit_scenes 返回的原片段 analysisId，在切点处批量拆分片段、添加片段标记、创建素材面板子剪辑，可多选；整个应用只占一步撤销。拆分复用剃刀并同时切关联声音，保留源时间、关键帧、标注和字幕；子剪辑引用原素材范围，不转码。原剪辑或视频改变、锁轨、超出500项上限时整组拒绝，请重新检测或降低灵敏度。标记单独创建/改动仍用通用video_edit.marker集合，单切点仍可用split_video_edit。',
  aliases: ['长视频切成镜头', '切点批量拆分', '场景检测加标记'], readOnly: false, risk: 'R1', permission: 'video_edit:write', idempotent: false, timeoutMs: 30000, supportsUndo: true,
  inputSchema: applyInput, outputSchema: applyOutput,
  resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('execute', ['video_edit.document', 'video_edit.clip', 'video_edit.marker', 'video_edit.item'], { revisionScopes: ['video_edit'], cancelable: true }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => {
    const receipt = { effect: 'execute' as const, propertyIds: [], verified: result.verified, evidence: result.verified ? ['已从剪辑文件回读核对整组拆分、标记及子剪辑。'] : [] }
    return [{ ...receipt, entityTypes: ['video_edit.document'], targetRefs: [result.resultRef], count: 1 }, ...Array.from({ length: Math.ceil(result.changedRefs.length / 128) }, (_, index) => {
      const refs = result.changedRefs.slice(index * 128, (index + 1) * 128)
      return { ...receipt, entityTypes: [...new Set(refs.map(ref => ref.kind))], targetRefs: refs, count: refs.length }
    })]
  }, summarize: result => result.message,
})
export const VIDEO_EDIT_SCENE_CAPABILITIES = [detectVideoEditScenesCapability, applyVideoEditScenesCapability]
