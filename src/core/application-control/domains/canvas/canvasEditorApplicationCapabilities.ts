import { z } from 'zod'

import {
  applicationRefSchema,
  type ApplicationCapabilityDefinition,
} from '../../applicationCapabilities'
import {
  capabilityControl,
  capabilityOutputSchema,
  defineApplicationCapability,
} from '../shared/defineApplicationCapability'

export const OPEN_CANVAS_NODE_EDITOR_CAPABILITY_ID = 'open_canvas_node_editor'
export const RETRY_LAYER_STACK_RESULT_CAPABILITY_ID = 'retry_layer_stack_result'

const canvasDocumentRefSchema = applicationRefSchema.extend({
  kind: z.literal('canvas.document'),
}).strict()

const canvasNodeRefSchema = applicationRefSchema.extend({
  kind: z.literal('canvas.node'),
}).strict()

const canvasWorkspaceRefSchema = applicationRefSchema.extend({
  kind: z.literal('application.surface'),
  id: z.literal('workspace.canvas'),
}).strict()

const cameraStageDocumentRefSchema = applicationRefSchema.extend({
  kind: z.literal('camera_stage.document'),
}).strict()

const openCanvasNodeEditor = defineApplicationCapability({
  id: OPEN_CANVAS_NODE_EDITOR_CAPABILITY_ID,
  version: 1,
  title: '打开画布节点编辑器',
  description: '在画布里打开节点自己的全屏编辑器给用户看，与双击节点相同：可编辑多图层图片文档节点进入图片编辑器，'
    + '3D 镜头参考节点进入 3D 编辑器（返回该节点的 cameraStageDocumentRef，id 就是 3D 工具的 documentId）。'
    + '只在用户要看、要进入编辑，或 3D 节点还没有镜头参考（第一次打开时创建）时使用；已有镜头参考的 3D 节点改场景、做运镜不需要打开。',
  domain: 'canvas',
  aliases: [
    '编辑多图层图片节点',
    '打开节点图文编辑器',
    '从节点打开图片编辑',
    '打开 3D 镜头参考节点',
    '进入 3D 编辑器',
    '打开三维镜头页面',
    'open canvas node editor',
  ],
  readOnly: false,
  control: capabilityControl('navigate', [
    'canvas.document',
    'canvas.node',
    'application.surface',
  ]),
  dataClasses: ['C1'],
  idempotent: true,
  destructive: false,
  timeoutMs: 20_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['navigation', 'canvas'],
  parallelSafe: false,
  availability: [
    '目标画布可以打开。',
    '目标节点是 editable-v3 完成态的多图层图片文档节点，或不在渲染中的 3D 镜头参考节点。',
    '画布界面已经准备好定位节点和承载节点编辑器。',
  ],
  prerequisites: [
    'canvasRef 与 nodeRef 必须来自画布和节点的稳定引用；nodeRef 必须属于 canvasRef。',
    '本能力只打开画布节点自己的编辑器，不会打开“工具”页里的独立图片编辑器或独立镜头参考。',
  ],
  acceptsRefs: ['canvas.document', 'canvas.node'],
  producesRefs: ['canvas.document', 'canvas.node', 'application.surface', 'camera_stage.document'],
  inputSchema: z.object({
    canvasRef: canvasDocumentRefSchema,
    nodeRef: canvasNodeRefSchema,
  }).strict(),
  outputSchema: capabilityOutputSchema({
    canvasRef: canvasDocumentRefSchema,
    nodeRef: canvasNodeRefSchema,
    surfaceId: z.literal('workspace.canvas'),
    editorKind: z.enum(['multi_layer_document', 'camera_stage']),
    status: z.enum(['opened', 'already_open']),
    cameraStageDocumentRef: cameraStageDocumentRefSchema.optional(),
    verification: z.object({ verified: z.literal(true), condition: z.string() }),
    resultRefs: z.union([
      z.tuple([canvasDocumentRefSchema, canvasNodeRefSchema, canvasWorkspaceRefSchema]),
      z.tuple([canvasDocumentRefSchema, canvasNodeRefSchema, canvasWorkspaceRefSchema, cameraStageDocumentRefSchema]),
    ]),
  }),
  concurrencyKey: 'canvas_node_editor',
  resolveConcurrencyKey: (input) => (
    `canvas_node_editor:${input.canvasRef.id}:${input.nodeRef.id}`
  ),
  resolveTargetIds: (input) => ({
    canvasDocumentId: input.canvasRef.id,
    nodeRefId: input.nodeRef.id,
  }),
  summarize: (output) => `已打开画布节点 ${output.nodeRef.id} 的${output.editorKind === 'camera_stage' ? ' 3D ' : '多图层图片'}编辑器。`,
  successEvidence: [
    '目标画布已载入，Surface 已验证为 workspace.canvas，目标节点已聚焦，节点自己的编辑器处于打开状态；3D 节点的镜头参考已载入场景。',
  ],
  failureRecovery: [
    '目标节点没有自己的编辑器时，错误会返回当前画布中可打开的节点引用；重新读取并选择其中一个引用，不要改用 open_image_editor_with_source 或 open_document。',
    '另一个节点编辑器正开着时先请用户关闭它，或改为不打开界面、直接用 3D 工具在后台修改。',
  ],
})

const retryLayerStackResult = defineApplicationCapability({
  id: RETRY_LAYER_STACK_RESULT_CAPABILITY_ID,
  resolveOperationTargets: input => [input.canvasRef, input.nodeRef],
  resolveOperationWriteTargets: input => [input.nodeRef],
  version: 1,
  title: '重新获取多图层图片结果',
  description: '重新下载指定画布中已生成但下载失败的多图层图片，安全恢复原任务并在后台继续获取结果。无需打开画布，不会重新生成图片。',
  domain: 'canvas',
  aliases: ['图层拆分下载失败', '多图层图片暂不可用', '重新获取结果', 'retry layer separation download'],
  readOnly: false,
  control: capabilityControl('execute', ['canvas.node'], {
    revisionScopes: ['canvas'], resultState: 'submitted', verificationRequired: false,
  }),
  dataClasses: ['C1'],
  idempotent: true,
  destructive: false,
  timeoutMs: 30_000,
  supportsPreview: false,
  supportsUndo: false,
  completionKind: 'submitted',
  requiredScopes: ['canvas'],
  availability: ['目标画布可读取，目标多图层结果存在可安全续取的下载失败任务。'],
  prerequisites: ['读取目标画布的 canvasRef 和 nodeRef；仅续取既有任务，不提交生成请求。'],
  acceptsRefs: ['canvas.document', 'canvas.node'],
  producesRefs: ['canvas.node'],
  inputSchema: z.object({ canvasRef: canvasDocumentRefSchema, nodeRef: canvasNodeRefSchema }).strict(),
  outputSchema: capabilityOutputSchema({
    nodeRef: canvasNodeRefSchema,
    status: z.enum(['retrieving', 'already_retrieving']),
    resultRefs: z.array(canvasNodeRefSchema).length(1),
  }),
  concurrencyKey: 'canvas',
  resolveConcurrencyKey: (input) => `canvas:${input.canvasRef.id}`,
  resolveTargetIds: (input) => ({ canvasDocumentId: input.canvasRef.id, nodeRefId: input.nodeRef.id }),
  summarize: () => '已启动原多图层图片结果的重新获取；下载是否完成需后续读取节点确认。',
  successEvidence: ['目标节点已保留原任务并进入续取状态；仅证明恢复请求已提交，不证明下载完成。'],
  failureRecovery: ['按错误读取当前画布和节点状态；已完成、取消、生成失败或来源变化的节点不能恢复，不要自动重新生成。'],
})

export const CANVAS_EDITOR_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  openCanvasNodeEditor,
  retryLayerStackResult,
]
