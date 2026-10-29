import { z } from 'zod'
import { applicationRefSchema } from '../../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from '../shared/defineApplicationCapability'

const documentRef = applicationRefSchema.extend({ kind: z.literal('video_edit.document') }).strict()
const range = z.object({ startFrame: z.number().int().min(0), endFrame: z.number().int().min(1) }).strict().refine(value => value.endFrame > value.startFrame, '结束帧必须大于开始帧。')
const input = z.object({
  documentRef,
  range: range.optional().describe('当前序列的帧范围 [startFrame,endFrame)；省略为整条序列。'),
  scope: z.enum(['needed', 'all']).default('all').describe('needed 只补 dropped（实测掉帧）和 predicted（预计吃力）的段；all（默认）渲染范围内所有非 ready 段，包含 realtime，与渲染入点到出点一致。'),
}).strict()
const output = z.object({ documentRef, pendingWindows: z.number().int(), readyFrames: z.number().int(), requestedFrames: z.number().int(), verified: z.boolean(), message: z.string() }).strict()
export const renderVideoEditPreviewCapability = defineApplicationCapability({
  id: 'render_video_edit_preview', title: '预渲染剪辑预览',
  description: '免费本地后台把当前序列指定范围的段落渲染成预览文件（编码与画质按设置 video_edit.render_format / video_edit.render_quality，码率随序列分辨率与帧率），让节目监视器在完整分辨率下流畅播放，相当于 Premiere 的“渲染入点到出点”。启动后在后台进行并立即返回，进度与完成情况从 video_edit.document.render_cache 读取（rendering 为进行中；all 的请求范围全部 ready 即完成，needed 只处理红黄段）。按剪辑点、转场与字幕边界分段，长段等分到最多五秒，小于半秒的段与相邻段合并，已渲染且内容未改的段落跳过；修改片段、效果参数、代码源码或素材后只有受影响的段落需要重新渲染。只写作品目录下的缓存（受缓存容量上限与自动清理约束），不改剪辑内容；暂停画面、选帧和导出仍实时合成。节目播放时自动暂停渲染，可取消。渲染状态从 video_edit.document.render_cache 读取。',
  version: 2, domain: 'video_edit', aliases: ['渲染预览', '渲染入点到出点', '预渲染', '渲染条', 'render preview', 'render in to out'], readOnly: false, dataClasses: ['C1'], permission: 'video_edit:write',
  destructive: false, supportsPreview: false, supportsUndo: false, idempotent: true, timeoutMs: 600000, requiredScopes: ['video_edit'], acceptsRefs: ['video_edit.document'], producesRefs: ['video_edit.document'],
  inputSchema: input, outputSchema: output,
  resolveConcurrencyKey: parsed => `video_edit_render_cache:${parsed.documentRef.id}`,
  resolveOperationTargets: parsed => [parsed.documentRef], resolveOperationWriteTargets: parsed => [parsed.documentRef],
  control: capabilityControl('execute', ['video_edit.document'], { propertyIds: ['video_edit.document.render_cache'], revisionScopes: ['video_edit'], cancelable: true }),
  verificationContract: { kind: 'effect_receipt', requireEffects: true, requireVerifiedEffects: true },
  resolveObservedEffects: (_parsed, result) => [{ effect: 'execute', entityTypes: ['video_edit.document'], propertyIds: ['video_edit.document.render_cache'], targetRefs: [result.documentRef], count: 1, verified: result.verified, evidence: result.verified ? ['已回读渲染条：后台预渲染已启动或请求范围已全部就绪。'] : [] }],
  summarize: result => result.message,
})
