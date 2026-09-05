import { z } from 'zod'

import {
  applicationRefSchema,
  type ApplicationCapabilityDefinition,
} from '../applicationCapabilities'
import {
  capabilityControl,
  capabilityOutputSchema,
  defineApplicationCapability,
} from './defineApplicationCapability'

export const OPEN_MULTI_LAYER_DOCUMENT_NODE_EDITOR_CAPABILITY_ID =
  'open_multi_layer_document_node_editor'
export const RETRY_LAYER_STACK_RESULT_CAPABILITY_ID = 'retry_layer_stack_result'

const canvasProjectRefSchema = applicationRefSchema.extend({
  kind: z.literal('canvas.project'),
}).strict()

const canvasNodeRefSchema = applicationRefSchema.extend({
  kind: z.literal('canvas.node'),
}).strict()

const canvasWorkspaceRefSchema = applicationRefSchema.extend({
  kind: z.literal('application.surface'),
  id: z.literal('workspace.canvas'),
}).strict()

const openMultiLayerDocumentNodeEditor = defineApplicationCapability({
  id: OPEN_MULTI_LAYER_DOCUMENT_NODE_EDITOR_CAPABILITY_ID,
  version: 1,
  title: '打开多图层文档节点编辑器',
  description: '打开明确画布项目中的可编辑多图层图片文档节点，并进入该节点自己的完整图片编辑器。',
  domain: 'canvas',
  aliases: [
    '编辑多图层图片节点',
    '打开节点图文编辑器',
    '从节点打开图片编辑',
    'open multilayer canvas node editor',
  ],
  readOnly: false,
  control: capabilityControl('navigate', [
    'canvas.project',
    'canvas.node',
    'application.surface',
  ]),
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'canvas:focus',
  idempotent: true,
  destructive: false,
  timeoutMs: 20_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['navigation', 'canvas'],
  parallelSafe: false,
  availability: [
    '目标项目可以打开。',
    '目标节点是 editable-v3 完成态的多图层图片文档节点。',
    '画布界面已经准备好定位节点和承载节点编辑器。',
  ],
  prerequisites: [
    'projectRef 与 nodeRef 必须来自画布项目和节点的稳定引用；nodeRef 必须属于 projectRef。',
    '本能力只打开画布节点自己的编辑器，不会打开工具箱里的独立图片编辑器。',
  ],
  acceptsRefs: ['canvas.project', 'canvas.node'],
  producesRefs: ['canvas.project', 'canvas.node', 'application.surface'],
  inputSchema: z.object({
    projectRef: canvasProjectRefSchema,
    nodeRef: canvasNodeRefSchema,
  }).strict(),
  outputSchema: capabilityOutputSchema({
    projectRef: canvasProjectRefSchema,
    nodeRef: canvasNodeRefSchema,
    surfaceId: z.literal('workspace.canvas'),
    editorKind: z.literal('multi_layer_document'),
    status: z.enum(['opened', 'already_open']),
    resultRefs: z.tuple([
      canvasProjectRefSchema,
      canvasNodeRefSchema,
      canvasWorkspaceRefSchema,
    ]),
  }),
  concurrencyKey: 'canvas_node_editor',
  resolveConcurrencyKey: (input) => (
    `canvas_node_editor:${input.projectRef.id}:${input.nodeRef.id}`
  ),
  resolveTargetIds: (input) => ({
    projectId: input.projectRef.id,
    nodeRefId: input.nodeRef.id,
  }),
  summarize: (output) => `已打开多图层图片文档节点 ${output.nodeRef.id} 的编辑器。`,
  successEvidence: [
    '目标项目已载入，Surface 已验证为 workspace.canvas，目标节点已聚焦，且节点自己的多图层文档编辑器处于打开状态。',
  ],
  failureRecovery: [
    '目标不是 editable-v3 多图层图片文档节点时，错误会返回当前项目中可打开的节点引用；重新读取并选择其中一个引用，不要改用 open_image_editor_with_source。',
  ],
})

const retryLayerStackResult = defineApplicationCapability({
  id: RETRY_LAYER_STACK_RESULT_CAPABILITY_ID,
  version: 1,
  title: '重新获取多图层图片结果',
  description: '重新下载当前画布工程中已生成但下载失败的多图层图片，安全恢复原任务并继续获取结果。不会重新生成图片。',
  domain: 'canvas',
  aliases: ['图层拆分下载失败', '多图层图片暂不可用', '重新获取结果', 'retry layer separation download'],
  readOnly: false,
  control: capabilityControl('execute', ['canvas.node'], {
    revisionScopes: ['canvas'], resultState: 'submitted', verificationRequired: false,
  }),
  risk: 'R1',
  dataClasses: ['C1'],
  permission: 'canvas:write',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  completionKind: 'submitted',
  requiredScopes: ['canvas'],
  availability: ['目标画布工程已打开，目标多图层结果存在可安全续取的下载失败任务。'],
  prerequisites: ['从已打开画布读取 projectRef 和 nodeRef；仅续取既有任务，不提交生成请求。'],
  acceptsRefs: ['canvas.project', 'canvas.node'],
  producesRefs: ['canvas.node'],
  inputSchema: z.object({ projectRef: canvasProjectRefSchema, nodeRef: canvasNodeRefSchema }).strict(),
  outputSchema: capabilityOutputSchema({
    nodeRef: canvasNodeRefSchema,
    status: z.enum(['retrieving', 'already_retrieving']),
    resultRefs: z.array(canvasNodeRefSchema).length(1),
  }),
  concurrencyKey: 'canvas',
  resolveConcurrencyKey: (input) => `canvas:${input.projectRef.id}`,
  resolveTargetIds: (input) => ({ projectId: input.projectRef.id, nodeRefId: input.nodeRef.id }),
  summarize: () => '已启动原多图层图片结果的重新获取；下载是否完成需后续读取节点确认。',
  successEvidence: ['目标节点已保留原任务并进入续取状态；仅证明恢复请求已提交，不证明下载完成。'],
  failureRecovery: ['按错误读取当前工程和节点状态；已完成、取消、生成失败或来源变化的节点不能恢复，不要自动重新生成。'],
})

export const CANVAS_EDITOR_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  openMultiLayerDocumentNodeEditor,
  retryLayerStackResult,
]
