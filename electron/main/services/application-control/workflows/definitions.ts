import { z } from 'zod'

import type { HostScope } from '../../../../../src/core/assistant/hostContracts'
import {
  workflowIdSchema,
} from '../../../../../src/core/assistant/capabilities/workflowApplicationCapabilities'

const placementSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('viewport_center') }).strict(),
  z.object({ mode: z.literal('right_of_node'), anchorNodeId: z.string().min(1) }).strict(),
])

const modelGenerationParams = z.object({
  projectId: z.string().min(1),
  modelId: z.string().min(1),
  mediaType: z.enum(['image', 'video', 'audio']),
  prompt: z.string().trim().min(1).max(32 * 1024),
  params: z.record(z.string(), z.unknown()).optional(),
}).strict()

const modelToCanvasSchema = modelGenerationParams.extend({
  nodeType: z.enum(['imageEdit', 'videoGen', 'audioGen']).optional(),
  placement: placementSchema.default({ mode: 'viewport_center' }),
}).strict()

const assetEditToCanvasSchema = z.object({
  assetId: z.string().min(1),
  projectId: z.string().min(1),
  operations: z.array(z.record(z.string(), z.unknown())).min(1).max(32),
  displayName: z.string().trim().max(200).optional(),
  placement: placementSchema.default({ mode: 'viewport_center' }),
}).strict()

const cameraShotToCanvasSchema = modelGenerationParams.extend({
  cameraStageProjectId: z.string().min(1),
  shotName: z.string().trim().min(1).max(120),
  cameraId: z.string().min(1).nullable().default(null),
  placement: placementSchema.default({ mode: 'viewport_center' }),
}).strict()

export type WorkflowId = z.infer<typeof workflowIdSchema>

export interface WorkflowStep {
  id: string
  title: string
  toolName: string
  input: Record<string, unknown>
  scopes: HostScope[]
  compensation?: (output: Record<string, unknown>) => Record<string, unknown> | null
}

export interface WorkflowDefinition {
  id: WorkflowId
  title: string
  description: string
  risk: 'R2'
  schema: z.ZodType<Record<string, unknown>>
  createSteps: (params: Record<string, unknown>) => WorkflowStep[]
}

function generationNodeType(mediaType: 'image' | 'video' | 'audio', explicit?: string): string {
  if (explicit) return explicit
  if (mediaType === 'video') return 'videoGen'
  if (mediaType === 'audio') return 'audioGen'
  return 'imageEdit'
}

function canvasNodeData(params: Record<string, unknown>): Record<string, unknown> {
  return {
    prompt: params.prompt,
    modelId: params.modelId,
    params: params.params,
  }
}

function modelToCanvasSteps(raw: Record<string, unknown>): WorkflowStep[] {
  const params = modelToCanvasSchema.parse(raw)
  const nodeType = generationNodeType(params.mediaType, params.nodeType)
  return [
    {
      id: 'switch-generation',
      title: '进入生成工作区',
      toolName: 'switch_workspace',
      input: { workspaceId: 'generation' },
      scopes: ['navigation'],
    },
    {
      id: 'prepare-generation',
      title: '校验模型参数',
      toolName: 'prepare_generation_task',
      input: { modelId: params.modelId, prompt: params.prompt, mediaType: params.mediaType, params: params.params },
      scopes: ['generation'],
    },
    {
      id: 'submit-generation',
      title: '提交可见生成任务',
      toolName: 'create_visible_generation_task',
      input: { modelId: params.modelId, prompt: params.prompt, mediaType: params.mediaType, params: params.params },
      scopes: ['generation'],
    },
    {
      id: 'open-canvas',
      title: '打开目标画布项目',
      toolName: 'open_canvas_project',
      input: { projectId: params.projectId },
      scopes: ['navigation', 'canvas'],
    },
    {
      id: 'add-generation-node',
      title: '创建生成节点',
      toolName: 'add_canvas_node',
      input: {
        projectId: params.projectId,
        nodeType,
        placement: params.placement,
        data: canvasNodeData(params),
      },
      scopes: ['canvas'],
      compensation: (output) => typeof output.undoRef === 'string'
        ? { projectId: params.projectId, undoRef: output.undoRef }
        : null,
    },
  ]
}

function assetEditToCanvasSteps(raw: Record<string, unknown>): WorkflowStep[] {
  const params = assetEditToCanvasSchema.parse(raw)
  return [
    {
      id: 'get-asset',
      title: '读取素材元数据',
      toolName: 'get_asset',
      input: { assetId: params.assetId },
      scopes: ['assets'],
    },
    {
      id: 'create-edit-preview',
      title: '生成非破坏编辑预览',
      toolName: 'create_image_edit_preview',
      input: { assetId: params.assetId, operations: params.operations },
      scopes: ['toolbox', 'assets'],
    },
    {
      id: 'commit-edit',
      title: '保存为新素材',
      toolName: 'commit_image_edit',
      input: { previewRef: '__from_previous:create-edit-preview', displayName: params.displayName },
      scopes: ['toolbox', 'assets'],
    },
    {
      id: 'open-canvas',
      title: '打开目标画布项目',
      toolName: 'open_canvas_project',
      input: { projectId: params.projectId },
      scopes: ['navigation', 'canvas'],
    },
    {
      id: 'add-asset-node',
      title: '把新素材放入画布',
      toolName: 'add_asset_to_canvas',
      input: { projectId: params.projectId, assetId: '__from_previous:commit-edit', placement: params.placement },
      scopes: ['canvas'],
      compensation: (output) => typeof output.undoRef === 'string'
        ? { projectId: params.projectId, undoRef: output.undoRef }
        : null,
    },
  ]
}

function cameraShotToCanvasSteps(raw: Record<string, unknown>): WorkflowStep[] {
  const params = cameraShotToCanvasSchema.parse(raw)
  const generationSteps = modelToCanvasSteps(params).filter((step) => (
    step.id === 'switch-generation' || step.id === 'prepare-generation' || step.id === 'submit-generation'
  ))
  return [
    {
      id: 'open-camera-stage',
      title: '打开 3D 运镜工程',
      toolName: 'open_camera_stage_project',
      input: { projectId: params.cameraStageProjectId },
      scopes: ['navigation', 'toolbox'],
    },
    {
      id: 'add-shot',
      title: '记录镜头卡',
      toolName: 'add_camera_stage_shot',
      input: { projectId: params.cameraStageProjectId, name: params.shotName, cameraId: params.cameraId },
      scopes: ['toolbox'],
    },
    ...generationSteps,
    {
      id: 'open-canvas',
      title: '打开目标画布项目',
      toolName: 'open_canvas_project',
      input: { projectId: params.projectId },
      scopes: ['navigation', 'canvas'],
    },
    {
      id: 'add-camera-node',
      title: '创建 3D 运镜节点',
      toolName: 'add_canvas_node',
      input: { projectId: params.projectId, nodeType: 'cameraStage', placement: params.placement, data: { displayName: params.shotName } },
      scopes: ['canvas'],
      compensation: (output) => typeof output.undoRef === 'string'
        ? { projectId: params.projectId, undoRef: output.undoRef }
        : null,
    },
  ]
}

const definitions: WorkflowDefinition[] = [
  {
    id: 'model_to_generation_canvas',
    title: '模型生成并放入画布',
    description: '按固定顺序校验模型、提交可见生成任务、打开画布并创建对应生成节点。',
    risk: 'R2',
    schema: modelToCanvasSchema as z.ZodType<Record<string, unknown>>,
    createSteps: modelToCanvasSteps,
  },
  {
    id: 'asset_edit_to_canvas',
    title: '素材编辑并放入画布',
    description: '读取素材、创建非破坏编辑预览、保存为新素材，再在目标画布创建输入节点。',
    risk: 'R2',
    schema: assetEditToCanvasSchema as z.ZodType<Record<string, unknown>>,
    createSteps: assetEditToCanvasSteps,
  },
  {
    id: 'camera_shot_to_generation_canvas',
    title: '3D 镜头、生成与画布闭环',
    description: '记录 3D 镜头卡，按固定模型生成流程提交任务，最后创建 3D 运镜节点。',
    risk: 'R2',
    schema: cameraShotToCanvasSchema as z.ZodType<Record<string, unknown>>,
    createSteps: cameraShotToCanvasSteps,
  },
]

const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))

export function listWorkflowDefinitions(): Array<Pick<WorkflowDefinition, 'id' | 'title' | 'description' | 'risk'>> {
  return definitions.map(({ id, title, description, risk }) => ({ id, title, description, risk }))
}

export function getWorkflowDefinition(id: string): WorkflowDefinition | null {
  return definitionsById.get(id as WorkflowId) ?? null
}

export function parseWorkflowParams(id: string, params: Record<string, unknown>): { definition: WorkflowDefinition; params: Record<string, unknown> } {
  const definition = getWorkflowDefinition(id)
  if (!definition) throw new Error('[INVALID_INPUT] 未知工作流')
  return { definition, params: definition.schema.parse(params) }
}
