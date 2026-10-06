import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'
import { canvasNodePlacementSchema } from '../canvas/canvasMutationApplicationCapabilities'

const ref = <K extends string>(kind: K) => applicationRefSchema.extend({ kind: z.literal(kind) }).strict()
const documentRef = ref('video_edit.document')
const nodeRef = ref('canvas.node')
const assetRef = ref('asset')
export const sendVideoEditToCanvasCapability = defineApplicationCapability({
  id: 'send_video_edit_to_canvas', version: 1, domain: 'video_edit', title: '把剪辑画面或片段发送到画布',
  description: '从明确剪辑文档和序列发送到明确画布文档。selection.kind=frame 按整数序列帧取完整合成图片；clip 按该序列的完整片段引用取当前裁切、速度、效果和链接声音，图片/图文变成图片输入节点、视频变成视频输入节点、声音变成音频输入节点。复用本地渲染与导出，不调用付费生成，不切换页面。目标先固定，准备期间源剪辑或目标画布改变则拒绝，完成文件保留。新增节点进入画布撤销栈，输出经保存回读核实。',
  aliases: ['发送当前帧到画布', '发送片段到画布', '剪辑到画布', 'send clip to canvas'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'canvas:write', idempotent: false, destructive: false,
  timeoutMs: 600000, supportsPreview: false, supportsUndo: false, requiredScopes: ['video_edit', 'canvas', 'assets'],
  acceptsRefs: ['video_edit.document', 'video_edit.sequence', 'video_edit.clip', 'canvas.document'], producesRefs: ['canvas.node', 'asset'],
  inputSchema: z.object({ documentRef, sequenceRef: ref('video_edit.sequence'), canvasRef: ref('canvas.document'), selection: z.discriminatedUnion('kind', [z.object({ kind: z.literal('frame'), frame: z.number().int().nonnegative() }).strict(), z.object({ kind: z.literal('clip'), clipRef: ref('video_edit.clip') }).strict()]), placement: canvasNodePlacementSchema.optional() }).strict(),
  outputSchema: z.object({ nodeRef, assetRef, undoRef: z.string(), message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string(), target: nodeRef }).strict() }).strict(),
  concurrencyKey: 'workspace_transfer', resolveConcurrencyKey: input => `canvas:${input.canvasRef.id}`,
  resolveOperationTargets: input => [input.documentRef, input.sequenceRef, input.canvasRef], resolveOperationWriteTargets: input => [input.canvasRef],
  control: capabilityControl('execute', ['canvas.node', 'asset'], { cancelable: true, revisionScopes: ['video_edit', 'canvas', 'assets'] }),
  summarize: output => output.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => [{ effect: 'execute', entityTypes: ['canvas.node'], propertyIds: [], targetRefs: [output.nodeRef], count: 1, verified: output.verification.verified, evidence: output.verification.verified ? [output.verification.condition] : [] }],
})

export const editVideoEditFrameCapability = defineApplicationCapability({
  id: 'edit_video_edit_program_frame', version: 1, domain: 'video_edit', title: '在图片编辑器编辑剪辑当前帧',
  description: '从指定剪辑当前序列的播放头取完整合成画面，保存到受管媒体并打开独立图片编辑器。界面“替换回剪辑”将保存后的图片文档作为一帧图片片段回到开始时的原位置上方，一次撤销。助手可用图片编辑通用实体修改并保存图片文档，再用 place_video_edit_creative_result（来源文档，携带返回的 frameEditSessionRef 与 returnPlacement）回到原序列；原剪辑修改或关闭后拒绝迟到回填。不要用默认图片时长。会切换到图片编辑器，仅在用户要求编辑画面时使用。',
  aliases: ['编辑当前帧', '剪辑帧到图片编辑', 'edit program frame'],
  readOnly: false, risk: 'R1', dataClasses: ['C1'], permission: 'navigation:write', idempotent: false, destructive: false,
  timeoutMs: 60000, supportsPreview: false, supportsUndo: false, requiredScopes: ['video_edit', 'assets', 'navigation'],
  acceptsRefs: ['video_edit.document'], producesRefs: ['asset', 'application.surface'],
  inputSchema: z.object({ documentRef }).strict(),
  outputSchema: z.object({ surfaceRef: ref('application.surface'), assetRef, documentRef, sequenceRef: ref('video_edit.sequence'), frameEditSessionRef: z.string(), returnPlacement: z.object({ mode: z.literal('add'), frame: z.number().int().nonnegative(), durationFrames: z.literal(1), trackRef: ref('video_edit.track').optional(), newTrack: z.enum(['video', 'audio']).optional() }).strict(), message: z.string(), verification: z.object({ verified: z.boolean(), condition: z.string() }).strict() }).strict(),
  concurrencyKey: 'workspace_transfer_image', resolveConcurrencyKey: input => `video_edit:${input.documentRef.id}`,
  resolveOperationTargets: input => [input.documentRef], resolveOperationWriteTargets: () => [{ kind: 'application.surface', id: 'tool.image_edit' }],
  control: capabilityControl('navigate', ['application.surface', 'asset']), summarize: output => output.message,
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_input, output) => [{ effect: 'navigate', entityTypes: ['application.surface'], propertyIds: [], targetRefs: [output.surfaceRef], count: 1, verified: output.verification.verified, evidence: output.verification.verified ? [output.verification.condition] : [] }],
})

export const VIDEO_EDIT_WORKSPACE_TRANSFER_CAPABILITIES = [sendVideoEditToCanvasCapability, editVideoEditFrameCapability]
