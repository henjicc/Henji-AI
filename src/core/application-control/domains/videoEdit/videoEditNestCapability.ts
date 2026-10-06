import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const ref = <T extends string>(kind: T) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document'); const clipRef = ref('video_edit.clip')
export const nestVideoEditClipsCapability = defineApplicationCapability({
  id: 'nest_video_edit_clips', version: 1, domain: 'video_edit', title: '把片段嵌套成序列',
  description: '把同一序列中的片段移进新序列，在原位置换成一个带画面与声音的序列片段；整个操作可一步撤销。默认连同音画链接与编组，linked=false 只用列出的片段。保留片内效果、速度、关键帧、跟踪、标注与锚定字幕，双击新片段可继续编辑子序列。嵌套片段可用 video_edit.clip 的通用属性改位置、源范围、速度、音量、关键帧和效果；新序列用 video_edit.sequence 读取编辑，素材引用用 video_edit.item.sequence_id。锁轨、会改变叠放顺序的夹层、跨选区跟随或过渡、循环或超过八层时整组拒绝。',
  aliases: ['嵌套', '嵌套序列', 'nest sequence', '把镜头合成一个序列片段'], readOnly: false, risk: 'R1', dataClasses: ['C1'],
  permission: 'video_edit:write', idempotent: false, destructive: false, timeoutMs: 30000, supportsPreview: false, supportsUndo: true,
  requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document', 'video_edit.clip'], producesRefs: ['video_edit.sequence', 'video_edit.item', 'video_edit.clip'],
  inputSchema: z.object({ documentRef, clipRefs: z.array(clipRef).min(1).max(500), name: z.string().trim().min(1).max(200).describe('新嵌套序列的名称。'), linked: z.boolean().optional() }).strict(),
  outputSchema: z.object({ resultRef: documentRef, sequenceRef: ref('video_edit.sequence'), itemRef: ref('video_edit.item'), clipRef, movedClipRefs: z.array(clipRef).max(500), message: z.string(),
    verification: z.object({ verified: z.boolean(), target: documentRef, condition: z.string() }).strict(),
  }).strict(),
  resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef, ...input.clipRefs], resolveOperationWriteTargets: input => [input.documentRef],
  control: capabilityControl('execute', ['video_edit.document', 'video_edit.sequence', 'video_edit.item', 'video_edit.clip'], { revisionScopes: ['video_edit'] }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, result) => {
    const receipt = { effect: 'execute' as const, propertyIds: [], verified: result.verification.verified, evidence: result.verification.verified ? [result.verification.condition] : [] }
    return [{ ...receipt, entityTypes: ['video_edit.document'], targetRefs: [result.resultRef], count: 1 },
      { ...receipt, effect: 'create' as const, entityTypes: ['video_edit.sequence'], targetRefs: [result.sequenceRef], count: 1 },
      { ...receipt, effect: 'create' as const, entityTypes: ['video_edit.item'], targetRefs: [result.itemRef], count: 1 },
      { ...receipt, effect: 'create' as const, entityTypes: ['video_edit.clip'], targetRefs: [result.clipRef], count: 1 },
      ...Array.from({ length: Math.ceil(result.movedClipRefs.length / 128) }, (_, index) => {
        const refs = result.movedClipRefs.slice(index * 128, (index + 1) * 128)
        return { ...receipt, effect: 'update' as const, entityTypes: ['video_edit.clip'], targetRefs: refs, count: refs.length }
      }),
    ]
  }, summarize: result => result.message,
})
