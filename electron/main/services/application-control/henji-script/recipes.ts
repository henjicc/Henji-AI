import { z } from 'zod'

import type {
  HenjiCallInstruction,
  HenjiInstruction,
  HenjiSourceLocation,
  HenjiValueExpression,
} from './types'

export interface HenjiRecipeExpansion {
  instructions: HenjiInstruction[]
  resultStepId: string
}

export interface HenjiRecipeDefinition<TInput = unknown> {
  id: string
  title: string
  domain: string
  inputSchema: z.ZodType<TInput>
  parameters: Record<string, unknown>
  actionIds: readonly string[]
  covers: readonly {
    effect: 'create' | 'update' | 'delete' | 'execute'
    entityTypes: readonly string[]
    maximumCount: number
  }[]
  verification: readonly string[]
  expand(input: TInput, prefix: string, location: HenjiSourceLocation): HenjiRecipeExpansion
}

const finiteCoordinateSchema = z.number().finite().min(-100_000).max(100_000)
const vectorComponentsSchema = z.object({
  x: finiteCoordinateSchema.optional(),
  y: finiteCoordinateSchema.optional(),
  z: finiteCoordinateSchema.optional(),
}).strict().refine(
  (value) => value.x !== undefined || value.y !== undefined || value.z !== undefined,
  { message: '至少提供一个坐标分量' },
)
const positiveVectorComponentsSchema = z.object({
  x: z.number().finite().positive().max(10_000).optional(),
  y: z.number().finite().positive().max(10_000).optional(),
  z: z.number().finite().positive().max(10_000).optional(),
}).strict().refine(
  (value) => value.x !== undefined || value.y !== undefined || value.z !== undefined,
  { message: '至少提供一个缩放分量' },
)
const cameraStateSchema = z.object({
  position: vectorComponentsSchema.optional(),
  rotation: vectorComponentsSchema.optional(),
  fov: z.number().finite().min(1).max(179).optional(),
}).strict().refine(
  (value) => Boolean(value.position || value.rotation || value.fov !== undefined),
  { message: '摄像机状态至少提供位置、旋转或 fov 中的一项' },
)
const stateSampleSchema = z.object({
  time: z.number().finite().nonnegative().max(3_600),
  position: vectorComponentsSchema.optional(),
  rotation: vectorComponentsSchema.optional(),
  scale: positiveVectorComponentsSchema.optional(),
  camera: cameraStateSchema.optional(),
}).strict().refine(
  (value) => Boolean(value.position || value.rotation || value.scale || value.camera),
  { message: '每个时间点至少提供对象或摄像机状态中的一项' },
)

export const cameraStageStateAnimationRecipeInputSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  object: z.object({
    primitiveKind: z.enum(['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus']),
    name: z.string().trim().min(1).max(120),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }).strict(),
  samples: z.array(stateSampleSchema).min(2).max(32),
  loop: z.boolean().default(true),
  play: z.boolean().default(true),
}).strict().superRefine((input, context) => {
  const times = input.samples.map((sample) => sample.time)
  if (new Set(times).size !== times.length) {
    context.addIssue({ code: 'custom', path: ['samples'], message: '状态动画的时间点不能重复' })
  }
  if (times.some((time, index) => index > 0 && time <= times[index - 1])) {
    context.addIssue({ code: 'custom', path: ['samples'], message: '状态动画的时间点必须严格递增' })
  }
})

export const canvasImagePipelineRecipeInputSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(32 * 1024),
  promptNodeName: z.string().trim().min(1).max(120).default('文本提示词'),
  generationNodeName: z.string().trim().min(1).max(120).default('图片生成'),
  promptPosition: z.object({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
  }).strict().default({ x: 320, y: 240 }),
}).strict()

export const applicationSettingsRecipeInputSchema = z.object({
  changes: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    value: z.unknown(),
  }).strict()).min(1).max(30),
}).strict().superRefine((input, context) => {
  const ids = input.changes.map((change) => change.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['changes'], message: '同一设置 ID 只能出现一次' })
  }
})

export const generationImageToCanvasRecipeInputSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  modelId: z.string().trim().min(1).max(200).optional(),
  preferredProviderIds: z.array(z.string().trim().min(1).max(100)).max(8).default([]),
  prompt: z.string().trim().min(1).max(32 * 1024),
  params: z.record(z.string(), z.unknown()).default({}),
}).strict()

type StateAnimationInput = z.infer<typeof cameraStageStateAnimationRecipeInputSchema>
type CanvasPipelineInput = z.infer<typeof canvasImagePipelineRecipeInputSchema>
type SettingsInput = z.infer<typeof applicationSettingsRecipeInputSchema>
type GenerationImageToCanvasInput = z.infer<typeof generationImageToCanvasRecipeInputSchema>

function expression(value: unknown): HenjiValueExpression {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return { kind: 'literal', value: value as string | number | boolean | null }
  }
  if (Array.isArray(value)) return { kind: 'array', items: value.map(expression) }
  return {
    kind: 'object',
    entries: Object.entries(value as Record<string, unknown>).map(([key, item]) => ({
      key,
      value: expression(item),
    })),
  }
}

function variable(name: string, ...path: Array<string | number>): HenjiValueExpression {
  return { kind: 'variable', name, path }
}

function action(
  stepId: string,
  toolName: string,
  input: HenjiValueExpression,
  location: HenjiSourceLocation,
): HenjiCallInstruction {
  return {
    kind: 'call', stepId, api: 'action', location,
    args: [expression(toolName), input],
  }
}

function object(entries: Record<string, HenjiValueExpression | unknown>): HenjiValueExpression {
  const isExpression = (value: unknown): value is HenjiValueExpression => Boolean(
    value && typeof value === 'object' && 'kind' in value
    && ['literal', 'array', 'object', 'variable', 'binary', 'conditional', 'template', 'helper']
      .includes(String((value as { kind: unknown }).kind)),
  )
  return {
    kind: 'object',
    entries: Object.entries(entries).map(([key, value]) => ({
      key,
      value: isExpression(value)
        ? value
        : expression(value),
    })),
  }
}

function stateProperties(sample: StateAnimationInput['samples'][number]): Record<string, number> {
  const properties: Record<string, number> = {}
  for (const group of ['position', 'rotation', 'scale'] as const) {
    const value = sample[group]
    if (!value) continue
    for (const axis of ['x', 'y', 'z'] as const) {
      if (value[axis] !== undefined) {
        properties[`camera_stage.object.animatable.transform.${group}.${axis}`] = value[axis]
      }
    }
  }
  return properties
}

function cameraStateProperties(sample: StateAnimationInput['samples'][number]): Record<string, number> {
  const properties: Record<string, number> = {}
  for (const group of ['position', 'rotation'] as const) {
    const value = sample.camera?.[group]
    if (!value) continue
    for (const axis of ['x', 'y', 'z'] as const) {
      if (value[axis] !== undefined) {
        properties[`camera_stage.camera.animatable.transform.${group}.${axis}`] = value[axis]
      }
    }
  }
  if (sample.camera?.fov !== undefined) {
    properties['camera_stage.camera.animatable.fov'] = sample.camera.fov
  }
  return properties
}

const vectorParameterSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    x: { type: 'number', minimum: -100_000, maximum: 100_000 },
    y: { type: 'number', minimum: -100_000, maximum: 100_000 },
    z: { type: 'number', minimum: -100_000, maximum: 100_000 },
  },
}

const scaleParameterSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    x: { type: 'number', exclusiveMinimum: 0, maximum: 10_000 },
    y: { type: 'number', exclusiveMinimum: 0, maximum: 10_000 },
    z: { type: 'number', exclusiveMinimum: 0, maximum: 10_000 },
  },
}

const cameraRecipe: HenjiRecipeDefinition<StateAnimationInput> = {
  id: 'camera_stage.state_animation',
  title: '创建并播放 3D 状态动画',
  domain: 'camera_stage',
  inputSchema: cameraStageStateAnimationRecipeInputSchema,
  parameters: {
    type: 'object', required: ['projectName', 'object', 'samples'], additionalProperties: false,
    properties: {
      projectName: { type: 'string' },
      object: { type: 'object', required: ['primitiveKind', 'name'], additionalProperties: false },
      samples: {
        type: 'array', minItems: 2, maxItems: 32,
        items: {
          type: 'object', required: ['time'], additionalProperties: false,
          properties: {
            time: { type: 'number', minimum: 0, maximum: 3600 },
            position: vectorParameterSchema,
            rotation: vectorParameterSchema,
            scale: scaleParameterSchema,
            camera: {
              type: 'object', additionalProperties: false,
              properties: {
                position: vectorParameterSchema,
                rotation: vectorParameterSchema,
                fov: { type: 'number', minimum: 1, maximum: 179 },
              },
            },
          },
        },
      },
      loop: { type: 'boolean', default: true }, play: { type: 'boolean', default: true },
    },
  },
  actionIds: [
    'create_camera_stage_project',
    'place_camera_stage_object', 'change_application_entities', 'verify_camera_stage_scene',
  ],
  covers: [
    { effect: 'create', entityTypes: ['camera_stage.project'], maximumCount: 1 },
    { effect: 'create', entityTypes: ['camera_stage.object'], maximumCount: 1 },
    { effect: 'create', entityTypes: ['camera_stage.state_keyframe'], maximumCount: 32 },
    { effect: 'update', entityTypes: ['camera_stage.object', 'camera_stage.camera', 'camera_stage.playback', 'camera_stage.state_keyframe'], maximumCount: 96 },
    { effect: 'execute', entityTypes: ['camera_stage.object', 'camera_stage.animation'], maximumCount: 1 },
  ],
  verification: [
    '读取正式 3D 场景状态，验证对象引用、每个状态时间点的属性值以及播放状态。',
  ],
  expand(input, prefix, location) {
    const create = `${prefix}__create_project`
    const place = `${prefix}__place_object`
    const animate = `${prefix}__animate`
    const verify = `${prefix}__verify`
    const projectId = variable(create, 'projectId')
    const objectRef = variable(place, 'resultRefs', 0)
    const cameraRef = variable(create, 'resultRefs', 1)
    const playbackRef = object({ kind: 'camera_stage.playback', id: projectId })
    const changes: HenjiValueExpression[] = []
    if (input.object.color) {
      changes.push(object({
        kind: 'set_properties', entityType: 'camera_stage.object', target: objectRef,
        properties: { 'camera_stage.object.color': input.object.color },
      }))
    }
    for (const sample of input.samples) {
      changes.push(object({
        kind: 'set_properties', entityType: 'camera_stage.playback', target: playbackRef,
        properties: { 'camera_stage.playback.current_time': sample.time },
      }))
      const objectProperties = stateProperties(sample)
      if (Object.keys(objectProperties).length > 0) changes.push(object({
        kind: 'set_properties', entityType: 'camera_stage.object', target: objectRef,
        properties: objectProperties,
      }))
      const cameraProperties = cameraStateProperties(sample)
      if (Object.keys(cameraProperties).length > 0) changes.push(object({
        kind: 'set_properties', entityType: 'camera_stage.camera', target: cameraRef,
        properties: cameraProperties,
      }))
    }
    changes.push(object({
      kind: 'set_properties', entityType: 'camera_stage.playback', target: playbackRef,
      properties: {
        'camera_stage.playback.current_time': 0,
        'camera_stage.playback.loop': input.loop,
        'camera_stage.playback.playing': input.play,
      },
    }))
    const expectedStateSamples = input.samples.flatMap((sample) => [
      ...Object.entries(stateProperties(sample)).map(([propertyId, value]) => object({
        objectRef, time: sample.time, propertyId, value,
      })),
      ...Object.entries(cameraStateProperties(sample)).map(([propertyId, value]) => object({
        objectRef: cameraRef, time: sample.time, propertyId, value,
      })),
    ])
    return {
      resultStepId: verify,
      instructions: [
        action(create, 'create_camera_stage_project', expression({ name: input.projectName }), location),
        action(place, 'place_camera_stage_object', object({
          projectId, objectType: 'primitive', primitiveKind: input.object.primitiveKind,
          name: input.object.name, role: 'subject', reusePolicy: 'require_new',
          placement: { mode: 'auto', spacing: 0.35, allowOverlap: false },
        }), location),
        action(animate, 'change_application_entities', object({
          summary: `记录 ${input.samples.length} 个状态时间点并设置播放`,
          changes: { kind: 'array', items: changes },
        }), location),
        action(verify, 'verify_camera_stage_scene', object({
          projectId,
          expectedObjectIds: [], expectedObjectRefs: { kind: 'array', items: [objectRef] },
          expectedStateSamples: { kind: 'array', items: expectedStateSamples },
          expectedPlayback: { playing: input.play, loop: input.loop },
          requireNoCollisions: true,
        }), location),
      ],
    }
  },
}

const canvasRecipe: HenjiRecipeDefinition<CanvasPipelineInput> = {
  id: 'canvas.image_pipeline', title: '创建文本提示与图片节点并连接', domain: 'canvas',
  inputSchema: canvasImagePipelineRecipeInputSchema,
  parameters: {
    type: 'object', required: ['projectName', 'prompt'], additionalProperties: false,
    properties: {
      projectName: { type: 'string' }, prompt: { type: 'string' },
      promptNodeName: { type: 'string' }, generationNodeName: { type: 'string' },
      promptPosition: {
        type: 'object', required: ['x', 'y'], additionalProperties: false,
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        default: { x: 320, y: 240 },
      },
    },
  },
  actionIds: [
    'create_canvas_project', 'open_canvas_project', 'get_canvas_node_schema',
    'add_canvas_node', 'connect_canvas_nodes', 'get_canvas_project',
  ],
  covers: [
    { effect: 'create', entityTypes: ['canvas.project'], maximumCount: 1 },
    { effect: 'create', entityTypes: ['canvas.node'], maximumCount: 2 },
    { effect: 'create', entityTypes: ['canvas.edge'], maximumCount: 1 },
    { effect: 'update', entityTypes: ['canvas.node'], maximumCount: 1 },
  ],
  verification: [
    '末步骤读取正式画布工程图，验证工程、两个节点、节点坐标和连线；调用配方后无需追加 entities.list/read。',
  ],
  expand(input, prefix, location) {
    const create = `${prefix}__create_project`
    const open = `${prefix}__open_project`
    const promptSchema = `${prefix}__prompt_schema`
    const imageSchema = `${prefix}__image_schema`
    const promptNode = `${prefix}__prompt_node`
    const imageNode = `${prefix}__image_node`
    const connect = `${prefix}__connect`
    const verify = `${prefix}__verify`
    const projectId = variable(create, 'projectId')
    const promptNodeId = variable(promptNode, 'nodeId')
    const imageNodeId = variable(imageNode, 'nodeId')
    return {
      resultStepId: verify,
      instructions: [
        action(create, 'create_canvas_project', expression({ name: input.projectName }), location),
        action(open, 'open_canvas_project', object({ projectId }), location),
        action(promptSchema, 'get_canvas_node_schema', expression({ nodeType: 'stringSourceNode' }), location),
        action(imageSchema, 'get_canvas_node_schema', expression({ nodeType: 'imageNode' }), location),
        action(promptNode, 'add_canvas_node', object({
          projectId, nodeType: 'stringSourceNode', placement: {
            mode: 'absolute', x: input.promptPosition.x, y: input.promptPosition.y,
          },
          data: { displayName: input.promptNodeName, value: input.prompt },
        }), location),
        action(imageNode, 'add_canvas_node', object({
          projectId, nodeType: 'imageNode',
          placement: object({ mode: 'right_of_node', anchorNodeId: promptNodeId }),
          data: { displayName: input.generationNodeName },
        }), location),
        action(connect, 'connect_canvas_nodes', object({
          projectId, sourceNodeId: promptNodeId, targetNodeId: imageNodeId,
          sourceHandle: 'source', targetHandle: 'param:__prompt',
        }), location),
        action(verify, 'get_canvas_project', object({ projectId }), location),
      ],
    }
  },
}

const settingsRecipe: HenjiRecipeDefinition<SettingsInput> = {
  id: 'settings.batch_update', title: '批量修改并验证应用设置', domain: 'settings',
  inputSchema: applicationSettingsRecipeInputSchema,
  parameters: {
    type: 'object', required: ['changes'], additionalProperties: false,
    properties: { changes: { type: 'array', minItems: 1, maxItems: 30 } },
  },
  actionIds: ['describe_application_entities', 'change_application_entities', 'read_application_entity'],
  covers: [{
    effect: 'update', entityTypes: ['settings.registry', 'settings.item'], maximumCount: 1,
  }],
  verification: [
    '从正式 settings.registry 逐项读回修改值，并在配方内部执行 equal 断言。',
  ],
  expand(input, prefix, location) {
    const describe = `${prefix}__describe`
    const change = `${prefix}__change`
    const verify = `${prefix}__verify`
    const settingIds = input.changes.map((item) => item.id)
    const assertions: HenjiInstruction[] = input.changes.map((item, index) => ({
      kind: 'assert', stepId: `${prefix}__assert_${index}`, assertion: 'equal', location,
      args: [variable(verify, 'properties', item.id), expression(item.value)],
    }))
    return {
      resultStepId: verify,
      instructions: [
        action(describe, 'describe_application_entities', expression({
          domains: ['settings'], entityTypes: ['settings.registry'],
          refs: [{ kind: 'settings.registry', id: 'singleton' }],
        }), location),
        action(change, 'change_application_entities', expression({
          summary: `批量修改 ${settingIds.join('、')}`,
          changes: [{
            kind: 'mutate_properties', target: { kind: 'settings.registry', id: 'singleton' },
            entityType: 'settings.registry',
            mutations: input.changes.map((item) => ({
              propertyId: item.id, operation: 'set', value: item.value,
            })),
          }],
        }), location),
        action(verify, 'read_application_entity', expression({
          ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: settingIds,
        }), location),
        ...assertions,
      ],
    }
  },
}

const generationImageToCanvasRecipe: HenjiRecipeDefinition<GenerationImageToCanvasInput> = {
  id: 'generation.image_to_canvas',
  title: '生成图片并在完成后放入画布',
  domain: 'generation',
  inputSchema: generationImageToCanvasRecipeInputSchema,
  parameters: {
    type: 'object', required: ['projectName', 'prompt'], additionalProperties: false,
    properties: {
      projectName: { type: 'string' }, modelId: { type: 'string' }, prompt: { type: 'string' },
      preferredProviderIds: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      params: { type: 'object', additionalProperties: true },
    },
  },
  actionIds: [
    'resolve_generation_model', 'prepare_generation_task',
    'create_visible_generation_task', 'get_generation_task',
    'create_canvas_project', 'add_generation_result_to_canvas', 'get_canvas_project',
  ],
  covers: [
    { effect: 'create', entityTypes: ['canvas.project', 'canvas.node', 'generation.task'], maximumCount: 1 },
    { effect: 'execute', entityTypes: ['generation.task'], maximumCount: 1 },
  ],
  verification: [
    '等待权威生成成功状态，放入画布后读取正式画布工程验证媒体节点引用。',
  ],
  expand(input, prefix, location) {
    const resolveModel = `${prefix}__resolve_model`
    const createProject = `${prefix}__create_project`
    const prepare = `${prefix}__prepare`
    const submit = `${prefix}__submit`
    const query = `${prefix}__query`
    const addResult = `${prefix}__add_result`
    const verify = `${prefix}__verify`
    const resolvedModelId = variable(resolveModel, 'modelId')
    const projectId = variable(createProject, 'projectId')
    const taskId = variable(submit, 'taskId')
    return {
      resultStepId: verify,
      instructions: [
        action(resolveModel, 'resolve_generation_model', expression({
          ...(input.modelId ? { requestedModelId: input.modelId } : {}),
          preferredProviderIds: input.preferredProviderIds,
          prompt: input.prompt,
          mediaType: 'image',
          params: input.params,
        }), location),
        action(prepare, 'prepare_generation_task', object({
          prompt: input.prompt, mediaType: 'image', params: input.params, modelId: resolvedModelId,
        }), location),
        action(submit, 'create_visible_generation_task', object({
          prompt: input.prompt, mediaType: 'image', params: input.params, modelId: resolvedModelId,
        }), location),
        action(query, 'get_generation_task', object({ taskId }), location),
        {
          kind: 'assert', stepId: `${prefix}__assert_success`, assertion: 'equal', location,
          args: [variable(query, 'task', 'status'), expression('success')],
        },
        {
          kind: 'assert', stepId: `${prefix}__assert_result`, assertion: 'equal', location,
          args: [variable(query, 'task', 'resultAvailable'), expression(true)],
        },
        action(createProject, 'create_canvas_project', expression({ name: input.projectName }), location),
        action(addResult, 'add_generation_result_to_canvas', object({
          projectId,
          resultRef: object({ kind: 'generation.result', id: taskId }),
          placement: { mode: 'viewport_center' },
        }), location),
        action(verify, 'get_canvas_project', object({ projectId }), location),
      ],
    }
  },
}

export class HenjiRecipeRegistry {
  private readonly definitions = new Map<string, HenjiRecipeDefinition>([
    [cameraRecipe.id, cameraRecipe], [canvasRecipe.id, canvasRecipe], [settingsRecipe.id, settingsRecipe],
    [generationImageToCanvasRecipe.id, generationImageToCanvasRecipe],
  ])

  get(id: string): HenjiRecipeDefinition | undefined {
    return this.definitions.get(id)
  }

  list(domains?: ReadonlySet<string>): HenjiRecipeDefinition[] {
    return [...this.definitions.values()].filter((item) => !domains || domains.size === 0 || domains.has(item.domain))
  }
}

export const HENJI_RECIPE_REGISTRY = new HenjiRecipeRegistry()
