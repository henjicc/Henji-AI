import { z } from 'zod'
import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import {
  capabilityControl,
  capabilityOutputSchema,
  defineApplicationCapability,
} from './defineApplicationCapability'

export const canvasDownloadDestinationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('quick') }).strict(),
  z.object({ mode: z.literal('preset'), presetIndex: z.number().int().nonnegative() }).strict(),
])
export type CanvasDownloadDestination = z.infer<typeof canvasDownloadDestinationSchema>

const downloadCanvasMedia = defineApplicationCapability({
  id: 'download_canvas_media',
  version: 1,
  title: '下载画布媒体',
  description: '把明确画布节点中的可下载媒体保存到已配置的快速下载或预设目录，不接受任意路径。',
  domain: 'canvas',
  aliases: ['批量下载画布节点', '下载节点媒体', 'download canvas media'],
  readOnly: false,
  control: capabilityControl('execute', ['canvas.node'], { verificationRequired: false }),
  risk: 'R2',
  dataClasses: ['C1'],
  permission: 'canvas:export',
  idempotent: false,
  destructive: false,
  timeoutMs: 120_000,
  supportsPreview: true,
  supportsUndo: false,
  requiredScopes: ['canvas'],
  acceptsRefs: ['canvas.project', 'canvas.node'],
  producesRefs: ['canvas.node'],
  successEvidence: ['返回实际保存成功与失败的节点 ID；目标目录只从用户已配置项解析，不向模型暴露本地路径。'],
  failureRecovery: ['未配置目标目录时提示用户先配置；部分文件失败时返回失败节点，不猜测或改写其它目录。'],
  inputSchema: z.object({
    projectId: z.string().min(1),
    nodeIds: z.array(z.string().min(1)).min(1).max(50),
    destination: canvasDownloadDestinationSchema,
  }).strict(),
  outputSchema: capabilityOutputSchema({
    projectId: z.string().min(1),
    requestedCount: z.number().int().nonnegative(),
    savedNodeIds: z.array(z.string()),
    failedNodeIds: z.array(z.string()),
    destinationMode: z.enum(['quick', 'preset']),
  }),
  concurrencyKey: 'canvas_export',
  resolveConcurrencyKey: (input) => `canvas_export:${input.projectId}`,
  resolveTargetIds: (input) => ({
    projectId: input.projectId,
    nodeIds: input.nodeIds.join(','),
    destinationMode: input.destination.mode,
  }),
  preview: (input) => ({
    title: '下载画布媒体',
    summary: `把 ${input.nodeIds.length} 个节点中的可用媒体保存到已配置目录。`,
    targetIds: { projectId: input.projectId, nodeIds: input.nodeIds.join(',') },
    reversible: false,
    dataClasses: ['C1'],
  }),
  summarize: (output) => `已下载 ${output.savedNodeIds.length} 个画布媒体，${output.failedNodeIds.length} 个失败。`,
})

export const CANVAS_EXPORT_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  downloadCanvasMedia,
]
