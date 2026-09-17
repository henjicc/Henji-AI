import { z } from 'zod'

import { applicationRefSchema, type ApplicationCapabilityDefinition } from '../../applicationCapabilities'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'

export const CAMERA_STAGE_RENDER_CAPABILITY_ID = 'render_camera_stage_output'
export const GET_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID = 'get_camera_stage_render_task'
export const CANCEL_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID = 'cancel_camera_stage_render_task'
export const WAIT_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID = 'wait_camera_stage_render_task'
export const RECOVER_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID = 'recover_camera_stage_render_task'

export const cameraStageRenderProjectRefSchema = applicationRefSchema.extend({
  kind: z.literal('canvas.project'),
}).strict()

export const cameraStageRenderNodeRefSchema = applicationRefSchema.extend({
  kind: z.literal('canvas.node'),
}).strict()

export const cameraStageRenderTaskRefSchema = applicationRefSchema.extend({
  kind: z.literal('camera_stage.render_task'),
}).strict()

const renderTaskStatusSchema = z.enum([
  'queued', 'running', 'awaiting_persistence', 'completed', 'failed', 'cancelled', 'interrupted',
])

const renderTaskObservationFields = {
  taskRef: cameraStageRenderTaskRefSchema,
  status: renderTaskStatusSchema,
  revisions: z.record(z.string(), z.number().int().nonnegative()),
  phase: z.enum(['preparing', 'rendering', 'encoding']).nullable(),
  progress: z.number().min(0).max(1),
  outputKind: z.enum(['image', 'video']),
  message: z.string().nullable(),
  resultRefs: z.array(cameraStageRenderNodeRefSchema).max(1),
  recovery: z.object({ capabilityId: z.literal(RECOVER_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID),
    input: z.object({ taskRef: cameraStageRenderTaskRefSchema }).strict() }).strict().nullable(),
} as const

const renderOutput = defineApplicationCapability({
  id: CAMERA_STAGE_RENDER_CAPABILITY_ID,
  resolveOperationTargets: (input) => [input.projectRef, input.nodeRef],
  resolveOperationWriteTargets: (input) => [input.nodeRef],
  version: 1,
  title: '输出 3D 镜头结果',
  description: '从明确画布中的 3D 镜头节点启动后台图片或视频输出；离开画布后任务仍继续。',
  domain: 'camera_stage',
  aliases: ['3D 截图', '3D 视频', '渲染镜头', 'render camera stage output'],
  readOnly: false,
  risk: 'R1',
  dataClasses: ['C1'],
  permission: 'camera_stage:write',
  idempotent: true,
  destructive: false,
  timeoutMs: 20_000,
  supportsPreview: false,
  supportsUndo: false,
  completionKind: 'submitted',
  requiredScopes: ['canvas'],
  parallelSafe: false,
  availability: ['目标画布项目存在，目标节点是可输出的 3D 镜头参考节点；无需打开原工程。'],
  prerequisites: [
    'projectRef 与 nodeRef 必须来自同一次画布读取，nodeRef 必须是 projectRef 下的完整稳定引用。',
    '本能力只提交后台任务；提交后用 wait_camera_stage_render_task 等待，或 get_camera_stage_render_task 查询。',
  ],
  acceptsRefs: ['canvas.project', 'canvas.node'],
  producesRefs: ['camera_stage.render_task'],
  inputSchema: z.object({
    projectRef: cameraStageRenderProjectRefSchema,
    nodeRef: cameraStageRenderNodeRefSchema,
    outputKind: z.enum(['image', 'video']),
    resolutionPreset: z.enum(['720p', '1080p']).default('720p'),
    selectedTimeSec: z.number().finite().nonnegative().optional(),
  }).strict().superRefine((input, context) => {
    if (input.outputKind === 'video' && input.selectedTimeSec !== undefined) {
      context.addIssue({ code: 'custom', message: 'selectedTimeSec 只适用于图片输出', path: ['selectedTimeSec'] })
    }
  }),
  outputSchema: capabilityOutputSchema({
    taskRef: cameraStageRenderTaskRefSchema,
    status: z.literal('submitted'),
    resultRefs: z.tuple([cameraStageRenderTaskRefSchema]),
  }),
  concurrencyKey: 'camera_stage_render',
  resolveConcurrencyKey: (input) => `camera_stage_render:${input.projectRef.id}:${input.nodeRef.id}`,
  resolveTargetIds: (input) => ({ projectId: input.projectRef.id, nodeRefId: input.nodeRef.id }),
  control: capabilityControl('execute', ['camera_stage.render_task'], {
    revisionScopes: ['canvas'],
    resultState: 'submitted',
    verificationRequired: false,
    alsoImpacts: [{ effect: 'create', entityTypes: ['camera_stage.render_task'] }],
  }),
  successEvidence: ['返回稳定 camera_stage.render_task 引用和 submitted 状态；该状态不代表媒体已经输出完成。'],
  failureRecovery: ['提交结果不确定时，用返回或原调用得到的任务引用查询；不得自行重复创建节点或改用新请求。'],
  resolveObservedEffects: (_input, output) => [{
    effect: 'execute', entityTypes: ['camera_stage.render_task'], propertyIds: [],
    targetRefs: [output.taskRef], count: 1, verified: false,
    evidence: [`camera-stage-render:${output.taskRef.id}:submitted`],
  }, {
    effect: 'create', entityTypes: ['camera_stage.render_task'], propertyIds: [],
    targetRefs: [output.taskRef], count: 1, verified: false,
    evidence: [`camera-stage-render:${output.taskRef.id}:created`],
  }],
  summarize: () => '3D 镜头后台输出任务已提交，尚不能视为输出完成。',
})

const getRenderTask = defineApplicationCapability({
  id: GET_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID,
  version: 1,
  title: '读取 3D 镜头输出任务',
  description: '按稳定任务引用读取后台输出状态；只有持久结果节点存在时才报告 completed。',
  domain: 'camera_stage',
  aliases: ['3D 输出进度', '查询镜头渲染', 'get camera stage render task'],
  readOnly: true,
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'camera_stage:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 10_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  acceptsRefs: ['camera_stage.render_task'],
  producesRefs: ['camera_stage.render_task', 'canvas.node'],
  inputSchema: z.object({ taskRef: cameraStageRenderTaskRefSchema }).strict(),
  outputSchema: capabilityOutputSchema(renderTaskObservationFields),
  concurrencyKey: 'camera_stage_render',
  resolveConcurrencyKey: (input) => `camera_stage_render:${input.taskRef.id}`,
  resolveTargetIds: (input) => ({ taskRefId: input.taskRef.id }),
  control: capabilityControl('observe', ['camera_stage.render_task', 'canvas.node']),
  successEvidence: ['completed 必须同时返回可由正式画布读取能力复核的唯一 canvas.node 结果引用。'],
  failureRecovery: ['interrupted 表示权威任务和持久结果都不存在；重新读取源节点后由用户决定是否再次输出。'],
  summarize: (output) => `3D 镜头输出任务状态：${output.status}。`,
})

const waitRenderTask = defineApplicationCapability({
  ...getRenderTask,
  id: WAIT_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID, title: '等待 3D 镜头输出',
  description: '等待原渲染任务完成或需要恢复；取消等待不取消渲染。still_running 时继续等待同一任务；recovery_required 时使用返回的 recovery 恢复原结果保存。',
  aliases: ['等待3D输出', 'wait camera stage render'], timeoutMs: 10 * 60_000,
  outputSchema: capabilityOutputSchema({ ...renderTaskObservationFields,
    waitReason: z.enum(['terminal', 'recovery_required', 'still_running']) }),
})

const recoverRenderTaskOutputSchema = capabilityOutputSchema({ ...renderTaskObservationFields, recoveryAttempted: z.boolean() })
const recoverRenderTask = defineApplicationCapability<z.infer<typeof getRenderTask.inputSchema>, z.infer<typeof recoverRenderTaskOutputSchema>>({
  ...getRenderTask,
  id: RECOVER_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID, title: '恢复 3D 镜头结果保存',
  description: '只接收原任务已经产生的媒体和终态，重试保存原工程结果；不会重新渲染。任务仍在运行或已保存时仅返回原状态。',
  aliases: ['恢复3D输出保存', 'recover camera stage render'],
  readOnly: false, risk: 'R1', permission: 'canvas:write', timeoutMs: 30_000,
  completionKind: 'executed', parallelSafe: false,
  outputSchema: recoverRenderTaskOutputSchema,
  resolveOperationTargets: input => [input.taskRef],
  verificationContract: { kind: 'effect_receipt', requireEffects: false, requireVerifiedEffects: false },
  resolveObservedEffects: (input, output) => [{
    effect: output.recoveryAttempted ? 'execute' : 'observe', entityTypes: ['camera_stage.render_task', 'canvas.node'],
    propertyIds: [], targetRefs: [input.taskRef, ...output.resultRefs], count: 1,
    verified: output.status === 'completed', evidence: [],
  }],
  control: capabilityControl('execute', ['camera_stage.render_task', 'canvas.node'], { revisionScopes: ['canvas'] }),
  failureRecovery: ['保存仍未完成时保留 awaiting_persistence 和原任务引用；查询当前状态后再恢复保存，不能重新提交渲染。'],
})

const cancelRenderTask = defineApplicationCapability({
  id: CANCEL_CAMERA_STAGE_RENDER_TASK_CAPABILITY_ID,
  resolveOperationTargets: (input) => [input.taskRef],
  version: 1,
  title: '取消 3D 镜头输出任务',
  description: '取消明确任务引用对应的仍在排队或运行的 3D 镜头输出任务。',
  domain: 'camera_stage',
  aliases: ['停止3D输出', '取消镜头渲染', 'cancel camera stage render'],
  readOnly: false,
  risk: 'R2',
  dataClasses: ['C1'],
  permission: 'camera_stage:write',
  idempotent: true,
  destructive: true,
  timeoutMs: 10_000,
  supportsPreview: true,
  supportsUndo: false,
  requiredScopes: [],
  acceptsRefs: ['camera_stage.render_task'],
  producesRefs: ['camera_stage.render_task'],
  inputSchema: z.object({ taskRef: cameraStageRenderTaskRefSchema }).strict(),
  outputSchema: capabilityOutputSchema({
    taskRef: cameraStageRenderTaskRefSchema,
    status: z.enum([
      'cancellation_requested', 'awaiting_persistence', 'completed', 'failed', 'cancelled', 'interrupted',
    ]),
    resultRefs: z.array(cameraStageRenderNodeRefSchema).max(1),
  }),
  concurrencyKey: 'camera_stage_render',
  resolveConcurrencyKey: (input) => `camera_stage_render:${input.taskRef.id}`,
  resolveTargetIds: (input) => ({ taskRefId: input.taskRef.id }),
  control: capabilityControl('execute', ['camera_stage.render_task']),
  preview: (input) => ({
    title: '取消 3D 镜头输出',
    summary: '取消这次仍在排队或运行的 3D 镜头输出；已经持久化的结果不会被删除。',
    targetIds: { taskRefId: input.taskRef.id },
    reversible: false,
    dataClasses: ['C1'],
  }),
  successEvidence: ['只对 queued/running 任务发送取消；已完成任务保留持久媒体和结果节点。'],
  failureRecovery: ['任务已经结束时保持其终态，不确认或删除尚未落图的主进程结果。'],
  summarize: (output) => `3D 镜头输出任务取消状态：${output.status}。`,
})

export const CAMERA_STAGE_RENDER_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  renderOutput,
  getRenderTask,
  waitRenderTask,
  recoverRenderTask,
  cancelRenderTask,
]
