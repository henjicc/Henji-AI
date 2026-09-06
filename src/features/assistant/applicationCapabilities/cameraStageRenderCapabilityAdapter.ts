import type { ApplicationRef } from '@/core/application-control'
import {
  cancelCameraStageNodeRenderTask,
  readCameraStageNodeRenderTask,
  startCameraStageNodeRender,
} from '@/features/canvas/application/cameraStageRenderApplicationService'
import { readPersistedCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService'
import { CANVAS_NODE_TYPES, isCameraStageNode } from '@/features/canvas/domain/canvasNodes'
import type {
  CameraStageRenderRequest,
  CameraStageRenderTaskSnapshot,
} from '@/platform/contracts/cameraStageRender'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'

import type { CapabilityExecutionContext } from './handlerTypes'

interface RenderTargetInput {
  projectRef: ApplicationRef & { kind: 'canvas.project' }
  nodeRef: ApplicationRef & { kind: 'canvas.node' }
  outputKind: 'image' | 'video'
  resolutionPreset: '720p' | '1080p'
  selectedTimeSec?: number
}

type RenderTaskIdentity = CameraStageRenderRequest & { version: 1 }

type RenderTaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_persistence'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

interface RenderTaskObservation {
  taskRef: ApplicationRef & { kind: 'camera_stage.render_task' }
  status: RenderTaskStatus
  phase: 'preparing' | 'rendering' | 'encoding' | null
  progress: number
  outputKind: 'image' | 'video'
  message: string | null
  resultRefs: Array<ApplicationRef & { kind: 'canvas.node' }>
}

const TASK_REF_PREFIX = 'v1.'
const TASK_REF_MAX_LENGTH = 500
const GENERATED_PROJECT_ID_PLACEHOLDER = '00000000-0000-4000-8000-000000000000'

function requireString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('INVALID_INPUT:3D 输出任务引用无效')
  return value
}

export function createCameraStageRenderTaskRef(
  identity: RenderTaskIdentity,
): ApplicationRef & { kind: 'camera_stage.render_task' } {
  const payload = encodeURIComponent(JSON.stringify([
    identity.canvasProjectId,
    identity.nodeId,
    identity.requestId,
    identity.cameraStageProjectId,
    identity.resolutionPreset,
    identity.outputKind,
    identity.selectedTimeSec ?? null,
  ]))
  const id = `${TASK_REF_PREFIX}${payload}`
  if (id.length > TASK_REF_MAX_LENGTH) {
    throw new Error('INVALID_INPUT:3D 输出任务引用超过稳定引用长度限制')
  }
  return { kind: 'camera_stage.render_task', id }
}

export function parseCameraStageRenderTaskRef(
  ref: ApplicationRef & { kind: 'camera_stage.render_task' },
): RenderTaskIdentity {
  if (ref.kind !== 'camera_stage.render_task' || !ref.id.startsWith(TASK_REF_PREFIX)) {
    throw new Error('INVALID_INPUT:3D 输出任务引用无效')
  }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(ref.id.slice(TASK_REF_PREFIX.length)))
    if (!Array.isArray(parsed) || parsed.length !== 7) throw new Error('invalid shape')
    const resolutionPreset = parsed[4]
    const outputKind = parsed[5]
    const selectedTimeSec = parsed[6]
    if (resolutionPreset !== '720p' && resolutionPreset !== '1080p') throw new Error('invalid resolution')
    if (outputKind !== 'image' && outputKind !== 'video') throw new Error('invalid output kind')
    if (outputKind === 'video' && selectedTimeSec !== null) throw new Error('invalid video time')
    if (selectedTimeSec !== null
      && (typeof selectedTimeSec !== 'number' || !Number.isFinite(selectedTimeSec) || selectedTimeSec < 0)) {
      throw new Error('invalid selected time')
    }
    return {
      version: 1,
      canvasProjectId: requireString(parsed[0]),
      nodeId: requireString(parsed[1]),
      requestId: requireString(parsed[2]),
      cameraStageProjectId: requireString(parsed[3]),
      resolutionPreset,
      outputKind,
      ...(selectedTimeSec === null ? {} : { selectedTimeSec }),
    }
  } catch {
    throw new Error('INVALID_INPUT:3D 输出任务引用无效')
  }
}

function requestIdFor(context: CapabilityExecutionContext): string {
  // frontend host 的 requestId 是整次 runId；toolCallId 才是一次能力调用的稳定身份。
  return `camera-stage-capability:${context.taskId ?? crypto.randomUUID()}`
}

function requireCurrentTarget(input: RenderTargetInput): {
  nodeId: string
  cameraStageProjectId: string | null
  selectedTimeSec: number | undefined
} {
  const projectId = input.projectRef.id
  const prefix = `${projectId}:`
  if (!input.nodeRef.id.startsWith(prefix) || input.nodeRef.id.length === prefix.length) {
    throw new Error(`INVALID_INPUT:nodeRef 必须是项目 ${projectId} 下的完整稳定引用`)
  }
  const project = useProjectStore.getState()
  if (project.currentProjectId !== projectId || project.currentProject?.id !== projectId) {
    throw new Error('CONFLICT:目标画布项目当前未打开')
  }
  const nodeId = input.nodeRef.id.slice(prefix.length)
  const node = useCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  if (!node || !isCameraStageNode(node)) throw new Error('INVALID_INPUT:目标节点不是 3D 镜头参考节点')
  return {
    nodeId,
    cameraStageProjectId: node.data.projectId,
    selectedTimeSec: input.outputKind === 'image'
      ? input.selectedTimeSec ?? node.data.selectedTimeSec
      : undefined,
  }
}

function requireUnchangedTarget(
  input: RenderTargetInput,
  expected: ReturnType<typeof requireCurrentTarget>,
): void {
  const current = requireCurrentTarget(input)
  if (current.nodeId !== expected.nodeId
    || current.cameraStageProjectId !== expected.cameraStageProjectId
    || current.selectedTimeSec !== expected.selectedTimeSec) {
    throw new Error('CONFLICT:目标 3D 镜头节点已经变化，请重新读取节点后再输出')
  }
}

interface PersistedCompletion {
  identity: RenderTaskIdentity
  resultRefs: Array<ApplicationRef & { kind: 'canvas.node' }>
}

function parseCompletionReceipt(value: unknown): RenderTaskIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CONFLICT:3D 输出结果缺少请求回执')
  }
  const receipt = value as Partial<RenderTaskIdentity>
  if (receipt.version !== 1
    || typeof receipt.requestId !== 'string'
    || typeof receipt.canvasProjectId !== 'string'
    || typeof receipt.nodeId !== 'string'
    || typeof receipt.cameraStageProjectId !== 'string'
    || (receipt.resolutionPreset !== '720p' && receipt.resolutionPreset !== '1080p')
    || (receipt.outputKind !== 'image' && receipt.outputKind !== 'video')
    || (receipt.outputKind === 'video' && receipt.selectedTimeSec !== undefined)
    || (receipt.selectedTimeSec !== undefined
      && (!Number.isFinite(receipt.selectedTimeSec) || receipt.selectedTimeSec < 0))) {
    throw new Error('CONFLICT:3D 输出结果请求回执无效')
  }
  return receipt as RenderTaskIdentity
}

function sameRequest(left: RenderTaskIdentity, right: RenderTaskIdentity): boolean {
  return left.requestId === right.requestId
    && left.canvasProjectId === right.canvasProjectId
    && left.nodeId === right.nodeId
    && left.cameraStageProjectId === right.cameraStageProjectId
    && left.resolutionPreset === right.resolutionPreset
    && left.outputKind === right.outputKind
    && (left.selectedTimeSec ?? null) === (right.selectedTimeSec ?? null)
}

function requestShape(identity: RenderTaskIdentity): string {
  const time = identity.selectedTimeSec === undefined ? '' : `，时间 ${identity.selectedTimeSec} 秒`
  return `${identity.outputKind === 'image' ? '图片' : '视频'}、${identity.resolutionPreset}${time}`
}

async function readPersistedCompletion(
  canvasProjectId: string,
  requestId: string,
): Promise<PersistedCompletion | null> {
  let project: Awaited<ReturnType<typeof readPersistedCanvasProjectSnapshot>>
  try {
    project = await readPersistedCanvasProjectSnapshot(canvasProjectId)
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') return null
    throw error
  }
  const completionId = `camera-stage-render:${requestId}`
  const matching = project.nodes.filter((node) => node.data.generationOutputCommitId === completionId)
  if (matching.length > 1) throw new Error('CONFLICT:3D 输出任务存在多个持久结果')
  const node = matching[0]
  if (!node) return null
  const identity = parseCompletionReceipt(node.data.cameraStageRenderReceipt)
  const expectedNodeType = identity.outputKind === 'image'
    ? CANVAS_NODE_TYPES.exportImage
    : CANVAS_NODE_TYPES.exportVideo
  if (node.type !== expectedNodeType) {
    throw new Error('CONFLICT:3D 输出持久结果的节点类型与请求回执不一致')
  }
  return {
    identity,
    resultRefs: [{ kind: 'canvas.node', id: `${canvasProjectId}:${node.id}` }],
  }
}

async function readLiveTask(identity: RenderTaskIdentity): Promise<CameraStageRenderTaskSnapshot | null> {
  const task = await readCameraStageNodeRenderTask({
    requestId: identity.requestId,
    canvasProjectId: identity.canvasProjectId,
    nodeId: identity.nodeId,
  })
  if (task && !sameRequest({ version: 1, ...task }, identity)) {
    throw new Error('CONFLICT:权威 3D 输出任务与稳定引用不一致')
  }
  return task
}

async function observe(identity: RenderTaskIdentity): Promise<RenderTaskObservation> {
  const taskRef = createCameraStageRenderTaskRef(identity)
  const completion = await readPersistedCompletion(identity.canvasProjectId, identity.requestId)
  if (completion) {
    if (!sameRequest(completion.identity, identity)) {
      throw new Error('CONFLICT:任务引用与持久 3D 输出请求不一致')
    }
    return {
      taskRef,
      status: 'completed',
      phase: null,
      progress: 1,
      outputKind: identity.outputKind,
      message: null,
      resultRefs: completion.resultRefs,
    }
  }

  const task = await readLiveTask(identity)
  if (!task) {
    return {
      taskRef,
      status: 'interrupted',
      phase: null,
      progress: 0,
      outputKind: identity.outputKind,
      message: '权威后台任务与持久结果均不存在，请重新读取源节点后决定是否再次输出',
      resultRefs: [],
    }
  }
  if (task.status === 'completed') {
    return {
      taskRef,
      status: 'awaiting_persistence',
      phase: null,
      progress: Math.min(task.progress, 0.99),
      outputKind: identity.outputKind,
      message: '媒体已经生成，正在等待持久结果节点完成接收',
      resultRefs: [],
    }
  }
  return {
    taskRef,
    status: task.status,
    phase: task.phase,
    progress: task.progress,
    outputKind: identity.outputKind,
    message: task.message,
    resultRefs: [],
  }
}

export async function renderCameraStageOutput(
  input: RenderTargetInput,
  context: CapabilityExecutionContext,
): Promise<Record<string, unknown>> {
  const target = requireCurrentTarget(input)
  const requestId = requestIdFor(context)
  const requestedIdentity: RenderTaskIdentity = {
    version: 1,
    requestId,
    canvasProjectId: input.projectRef.id,
    nodeId: target.nodeId,
    cameraStageProjectId: target.cameraStageProjectId ?? GENERATED_PROJECT_ID_PLACEHOLDER,
    resolutionPreset: input.resolutionPreset,
    outputKind: input.outputKind,
    ...(target.selectedTimeSec === undefined ? {} : { selectedTimeSec: target.selectedTimeSec }),
  }
  // 在创建后台工程和提交主进程任务前拒绝无法形成合法稳定引用的输入。
  createCameraStageRenderTaskRef(requestedIdentity)
  const existing = await readPersistedCompletion(input.projectRef.id, requestId)
  requireUnchangedTarget(input, target)
  if (existing) {
    const expected = target.cameraStageProjectId
      ? requestedIdentity
      : { ...requestedIdentity, cameraStageProjectId: existing.identity.cameraStageProjectId }
    if (!sameRequest(existing.identity, expected)) {
      throw new Error(
        `CONFLICT:同一能力调用已经提交为${requestShape(existing.identity)}；`
        + `不能改为${requestShape(expected)}重放，请继续查询原任务或发起新的能力调用`,
      )
    }
    const taskRef = createCameraStageRenderTaskRef(existing.identity)
    return { taskRef, status: 'submitted', resultRefs: [taskRef] }
  }

  const task = await startCameraStageNodeRender(target.nodeId, input.outputKind, {
    requestId,
    resolutionPreset: input.resolutionPreset,
    selectedTimeSec: target.selectedTimeSec,
    expectedOwner: {
      canvasProjectId: input.projectRef.id,
      cameraStageProjectId: target.cameraStageProjectId,
    },
  })
  const submittedIdentity: RenderTaskIdentity | null = task ? { ...task } : null
  const expected = target.cameraStageProjectId
    ? requestedIdentity
    : submittedIdentity && { ...requestedIdentity, cameraStageProjectId: submittedIdentity.cameraStageProjectId }
  if (!submittedIdentity || !expected || !sameRequest(submittedIdentity, expected)) {
    const existingShape = submittedIdentity ? requestShape(submittedIdentity) : '另一项输出'
    throw new Error(
      `CONFLICT:目标节点当前已经在处理${existingShape}；`
      + `本次要求是${requestShape(requestedIdentity)}，请查询当前任务或等待结束后再发起新调用`,
    )
  }
  const taskRef = createCameraStageRenderTaskRef(submittedIdentity)
  return { taskRef, status: 'submitted', resultRefs: [taskRef] }
}

export async function getCameraStageRenderTask(
  taskRef: ApplicationRef & { kind: 'camera_stage.render_task' },
): Promise<Record<string, unknown>> {
  return { ...await observe(parseCameraStageRenderTaskRef(taskRef)) }
}

export async function cancelCameraStageRenderTask(
  taskRef: ApplicationRef & { kind: 'camera_stage.render_task' },
): Promise<Record<string, unknown>> {
  const identity = parseCameraStageRenderTaskRef(taskRef)
  const observation = await observe(identity)
  if (observation.status !== 'queued' && observation.status !== 'running') {
    return { taskRef, status: observation.status, resultRefs: observation.resultRefs }
  }
  const live = await readLiveTask(identity)
  if (!live || (live.status !== 'queued' && live.status !== 'running')) {
    const latest = await observe(identity)
    return { taskRef, status: latest.status, resultRefs: latest.resultRefs }
  }
  await cancelCameraStageNodeRenderTask({
    requestId: identity.requestId,
    canvasProjectId: identity.canvasProjectId,
    nodeId: identity.nodeId,
  })
  return { taskRef, status: 'cancellation_requested', resultRefs: [] }
}
