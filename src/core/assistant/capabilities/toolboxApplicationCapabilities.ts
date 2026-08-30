import { z } from 'zod'

import {
  createImageEditPreviewInputContract,
  IMAGE_EDIT_PREVIEW_CAPABILITY_METADATA,
} from '../../../features/imageEdit/application/imageEditControlCatalog'
import {
  applicationRefSchema,
  type ApplicationCapabilityDefinition,
} from '../applicationCapabilities'
import {
  capabilityControl,
  capabilityOutputSchema,
  defineApplicationCapability,
} from './defineApplicationCapability'

const listToolboxTools = defineApplicationCapability({
  id: 'list_toolbox_tools',
  version: 1,
  title: '列出工具箱能力',
  description: '列出工具箱内可通过结构化参数使用的工具和能力边界。',
  domain: 'toolbox',
  aliases: ['工具箱有什么', 'toolbox tools'],
  readOnly: true,
  control: capabilityControl('observe', ['toolbox.tool']),
  risk: 'R0',
  dataClasses: ['C0'],
  permission: 'toolbox:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: z.object({}).strict(),
  outputSchema: capabilityOutputSchema({
    tools: z.array(z.record(z.string(), z.unknown())),
  }),
  concurrencyKey: 'toolbox_catalog',
  summarize: (output) => `工具箱提供 ${output.tools.length} 个工具。`,
})

const getToolboxState = defineApplicationCapability({
  id: 'get_toolbox_state',
  version: 1,
  title: '读取工具箱状态',
  description: '读取当前工具、3D 工程和选择摘要，不返回完整场景。',
  domain: 'toolbox',
  aliases: ['当前工具状态', 'toolbox state'],
  readOnly: true,
  control: capabilityControl('observe', ['toolbox.state']),
  risk: 'R0',
  dataClasses: ['C0'],
  permission: 'toolbox:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: z.object({}).strict(),
  outputSchema: capabilityOutputSchema({
    state: z.record(z.string(), z.unknown()),
  }),
  concurrencyKey: 'toolbox_state',
  summarize: () => '已读取工具箱状态。',
})

const selectToolboxTool = defineApplicationCapability({
  id: 'select_toolbox_tool',
  version: 2,
  title: '切换工具箱工具',
  description: '按稳定工具 ID 打开或关闭工具箱子工具。',
  domain: 'toolbox',
  aliases: ['打开 3D 运镜', '打开图片编辑', 'select toolbox tool'],
  readOnly: false,
  control: capabilityControl('navigate', ['application.surface']),
  risk: 'R0',
  dataClasses: ['C0'],
  permission: 'toolbox:write',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: ['navigation', 'toolbox'],
  producesRefs: ['application.surface'],
  successEvidence: ['打开工具时返回实际 Surface ID，关闭工具时返回 surfaceId=null，且宿主工具选择与请求一致。'],
  failureRecovery: ['工具 Surface 无法打开时停止并说明，不得声称已切换；关闭失败时重新读取工具箱状态。'],
  inputSchema: z.object({
    toolId: z.enum(['cameraStage', 'imageMark']).nullable(),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    toolId: z.enum(['cameraStage', 'imageMark']).nullable(),
    surfaceId: z.enum(['tool.camera_stage', 'tool.image_edit']).nullable(),
  }),
  concurrencyKey: 'toolbox_selection',
  resolveTargetIds: (input) => ({ toolId: input.toolId ?? '' }),
  summarize: (output) => `当前工具：${output.toolId ?? '工具箱首页'}。`,
})

const imageEditPreviewSourceRefSchema = applicationRefSchema.extend({
  kind: z.enum(['asset', 'generation.result', 'image_edit.preview']),
}).strict()

const createImageEditPreviewInput = createImageEditPreviewInputContract({
  sourceRef: imageEditPreviewSourceRefSchema,
})

const createImageEditPreview = defineApplicationCapability({
  id: 'create_image_edit_preview',
  version: 2,
  title: IMAGE_EDIT_PREVIEW_CAPABILITY_METADATA.title,
  description: IMAGE_EDIT_PREVIEW_CAPABILITY_METADATA.description,
  domain: 'image_edit',
  aliases: [...IMAGE_EDIT_PREVIEW_CAPABILITY_METADATA.aliases],
  readOnly: false,
  // 预览是新建出来的实体，不只是一次运算：漏声明 create，「做一张编辑预览」的 Facet 结不了账。
  control: capabilityControl('execute', ['image_edit.preview'], {
    alsoImpacts: [{ effect: 'create', entityTypes: ['image_edit.preview'] }],
  }),
  risk: 'R1',
  dataClasses: ['C1'],
  permission: 'image_edit:preview',
  idempotent: false,
  destructive: false,
  timeoutMs: 30_000,
  supportsPreview: true,
  supportsUndo: false,
  requiredScopes: ['toolbox'],
  acceptsRefs: ['asset', 'generation.result', 'image_edit.preview'],
  producesRefs: ['image_edit.preview'],
  inputSchema: createImageEditPreviewInput.inputSchema,
  aiInputSchema: createImageEditPreviewInput.aiInputSchema,
  outputSchema: capabilityOutputSchema({
    previewRef: z.string(),
    sourceRef: imageEditPreviewSourceRefSchema,
    resultRefs: z.tuple([
      z.object({ kind: z.literal('image_edit.preview'), id: z.string().min(1) }).strict(),
    ]),
    operationCount: z.number().int().nonnegative(),
    hasEffect: z.boolean(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  concurrencyKey: 'image_edit',
  resolveConcurrencyKey: (input) => `image_edit:${input.sourceRef.kind}:${input.sourceRef.id}`,
  resolveTargetIds: (input) => ({ sourceKind: input.sourceRef.kind, sourceId: input.sourceRef.id }),
  preview: (input) => ({
    title: '创建图片编辑预览',
    summary: `对 ${input.sourceRef.kind}:${input.sourceRef.id} 应用 ${input.operations.length} 项编辑，不覆盖原图。`,
    targetIds: { sourceKind: input.sourceRef.kind, sourceId: input.sourceRef.id },
    reversible: false,
    dataClasses: ['C1'],
  }),
  resolveObservedEffects: (_input, output) => {
    const targetRefs = [...output.resultRefs]
    return [
      {
        effect: 'execute' as const,
        entityTypes: ['image_edit.preview'], propertyIds: [],
        targetRefs, count: 1, verified: false, evidence: [],
      },
      {
        effect: 'create' as const,
        entityTypes: ['image_edit.preview'], propertyIds: [],
        targetRefs, count: 1, verified: false, evidence: [],
      },
    ]
  },
  summarize: (output) => `已创建图片编辑预览 ${output.previewRef}。`,
})

const commitImageEdit = defineApplicationCapability({
  id: 'commit_image_edit',
  version: 1,
  title: '保存图片编辑结果',
  description: '将图片编辑预览保存为新素材，不覆盖原图。',
  domain: 'image_edit',
  aliases: ['保存编辑图片', 'commit image edit'],
  readOnly: false,
  control: capabilityControl('create', ['asset'], { revisionScopes: ['assets'] }),
  risk: 'R2',
  dataClasses: ['C1'],
  permission: 'image_edit:commit',
  idempotent: false,
  destructive: false,
  timeoutMs: 60_000,
  supportsPreview: true,
  supportsUndo: false,
  requiredScopes: ['toolbox', 'assets'],
  acceptsRefs: ['image_edit.preview'],
  producesRefs: ['asset'],
  inputSchema: z.object({
    previewRef: z.string().min(1),
    displayName: z.string().trim().max(200).optional(),
  }).strict(),
  outputSchema: capabilityOutputSchema({
    previewRef: z.string(),
    assetId: z.string(),
    status: z.literal('committed'),
  }),
  concurrencyKey: 'image_edit',
  resolveConcurrencyKey: (input) => `image_edit:${input.previewRef}`,
  resolveTargetIds: (input) => ({ previewRef: input.previewRef }),
  preview: (input) => ({
    title: '保存图片编辑结果',
    summary: `将预览 ${input.previewRef} 保存为新素材，不覆盖原图。`,
    targetIds: { previewRef: input.previewRef },
    reversible: false,
    dataClasses: ['C1'],
  }),
  summarize: (output) => `图片编辑结果已保存为素材 ${output.assetId}。`,
})

const listStoryboardProjects = defineApplicationCapability({
  id: 'list_storyboard_projects',
  version: 1,
  title: '列出分镜项目',
  description: '列出分镜项目摘要，不返回完整节点和连接数据。',
  domain: 'storyboard',
  aliases: ['分镜项目', 'list storyboards'],
  readOnly: true,
  control: capabilityControl('observe', ['storyboard.project']),
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'storyboard:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 8_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  producesRefs: ['storyboard.project'],
  inputSchema: z.object({}).strict(),
  outputSchema: capabilityOutputSchema({
    projects: z.array(z.record(z.string(), z.unknown())),
  }),
  concurrencyKey: 'storyboard_catalog',
  summarize: (output) => `分镜项目目录返回 ${output.projects.length} 项。`,
})

const getStoryboardProject = defineApplicationCapability({
  id: 'get_storyboard_project',
  version: 1,
  title: '读取分镜项目',
  description: '按项目引用读取分镜摘要、节点和连接计数。',
  domain: 'storyboard',
  aliases: ['分镜项目详情', 'get storyboard'],
  readOnly: true,
  control: capabilityControl('observe', ['storyboard.project']),
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'storyboard:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 8_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  acceptsRefs: ['storyboard.project'],
  producesRefs: ['storyboard.project'],
  inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: capabilityOutputSchema({
    project: z.record(z.string(), z.unknown()),
  }),
  concurrencyKey: 'storyboard_project',
  resolveConcurrencyKey: (input) => `storyboard_project:${input.projectId}`,
  resolveTargetIds: (input) => ({ projectId: input.projectId }),
  summarize: (output) => `已读取分镜项目 ${String(output.project.id ?? '')}。`,
})

export const TOOLBOX_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  listToolboxTools,
  getToolboxState,
  selectToolboxTool,
  createImageEditPreview,
  commitImageEdit,
  listStoryboardProjects,
  getStoryboardProject,
]
