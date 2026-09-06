// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { AgentToolGatewayResult } from '@/core/assistant/toolContracts'
import { createStoredCameraStageProject } from '@/features/cameraStage/projects/cameraStageProjectService'
import {
  applyCameraStageRenderTask,
} from '@/features/canvas/application/cameraStageRenderApplicationService'
import { createCameraStageRenderTaskRef } from '@/features/assistant/applicationCapabilities/cameraStageRenderCapabilityAdapter'
import { confirmCanvasPersistence } from '@/features/canvas/application/canvasPersistenceService'
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { cameraStageNodeDefinition } from '@/features/canvas/domain/nodeRegistryStandardDefinitions'
import type {
  CameraStageRenderEvent,
  CameraStageRenderPlatform,
  CameraStageRenderTaskSnapshot,
} from '@/platform/contracts/cameraStageRender'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'

import { CameraStageRenderTaskRegistry } from '../../electron/main/services/camera-stage-render-task-registry'
import { buildAssistantHarnessRuntime } from './assistantRuntimeHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'

vi.mock('@/features/canvas/generation/mediaResultPersist', () => ({
  // 真实像素属于 harness 允许替代的外部边界；结果节点、事务、回执和持久化仍走生产服务。
  persistGenerationResult: async (_mediaType: string, output: string) => ({
    patch: { imageUrl: output, previewImageUrl: output, aspectRatio: '16:9' },
    createdFilePaths: [],
  }),
}))

const OWNER_ID = 1
const runtimes: Array<ReturnType<typeof buildAssistantHarnessRuntime>> = []

function wire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function installTaskRegistryBridge(registry: CameraStageRenderTaskRegistry): void {
  const original = window.henjiNative!
  const listeners = new Set<(task: CameraStageRenderTaskSnapshot) => void>()
  const emit = (task: CameraStageRenderTaskSnapshot) => listeners.forEach((listener) => listener(wire(task)))
  const apply = (event: CameraStageRenderEvent) => {
    const task = registry.applyEvent(wire(event))
    emit(task)
    return task
  }
  const cameraStageRender: CameraStageRenderPlatform = {
    start: async (request) => wire(registry.register(wire(request), OWNER_ID)),
    get: async (scope) => wire(registry.require(wire(scope), OWNER_ID)),
    list: async (canvasProjectId) => wire(registry.list(canvasProjectId, OWNER_ID)),
    cancel: async (scope) => {
      const task = registry.require(wire(scope), OWNER_ID)
      if (task?.status === 'queued' || task?.status === 'running') {
        apply({ type: 'cancelled', requestId: task.requestId, nodeId: task.nodeId })
      }
    },
    acknowledge: async (scope) => registry.acknowledge(wire(scope), OWNER_ID),
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    workerReady: async () => undefined,
    onWorkerJob: () => () => undefined,
    onWorkerCancel: () => () => undefined,
    reportWorkerEvent: async (event) => { apply(event) },
  }
  ;(window as unknown as { henjiNative: typeof original }).henjiNative = {
    ...original,
    cameraStageRender,
  }
}

async function executeTool(
  runtime: ReturnType<typeof buildAssistantHarnessRuntime>,
  toolCallId: string,
  toolName: string,
  input: unknown,
): Promise<AgentToolGatewayResult> {
  return await runtime.gateway.execute({
    runId: 'camera-stage-render-harness',
    threadId: 'camera-stage-render-harness',
    toolCallId,
    toolName,
    approvalMode: 'full_access',
    explicitUserIntent: true,
    signal: new AbortController().signal,
    expectedRevisions: runtime.getHostContext().scopeRevisions,
    input,
  })
}

async function discover(runtime: ReturnType<typeof buildAssistantHarnessRuntime>, suffix: string): Promise<void> {
  const result = await executeTool(runtime, `discover-${suffix}`, 'discover_application_capabilities', {
    queries: ['输出、查询和取消 3D 镜头结果'],
    domains: ['camera_stage', 'canvas'],
    entityTypes: ['camera_stage.render_task', 'canvas.project', 'canvas.node'],
    writes: true,
  })
  expect(result.status).toBe('completed')
}

async function runScript(
  runtime: ReturnType<typeof buildAssistantHarnessRuntime>,
  toolCallId: string,
  source: string,
): Promise<void> {
  const result = await executeTool(runtime, toolCallId, 'run_henji_script', {
    language: 'henji-ts/v1',
    summary: toolCallId,
    source,
  })
  expect(result.status).toBe('completed')
  if (result.status === 'completed') {
    const output = result.observation.output as { ok?: boolean; error?: unknown }
    expect(output.ok, JSON.stringify(output.error)).toBe(true)
  }
}

function taskDescriptor(): NonNullable<CanvasNode['data']['renderTask']> {
  const source = useCanvasStore.getState().nodes.find((node) => node.id === 'camera-node')
  if (!source?.data.renderTask) throw new Error('正式能力没有把后台任务登记到源节点')
  return source.data.renderTask
}

function taskRefSource(task: NonNullable<CanvasNode['data']['renderTask']>): string {
  return JSON.stringify(createCameraStageRenderTaskRef({ version: 1, ...task }))
}

beforeEach(() => {
  installHarnessNativeStorage()
  useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  useProjectStore.setState({
    projects: [], currentProjectId: null, currentProject: null,
    isHydrated: true, isOpeningProject: false, openError: null,
    persistenceError: null, persistenceErrors: {},
  })
})

afterEach(() => {
  runtimes.splice(0).forEach((runtime) => runtime.dispose())
  vi.restoreAllMocks()
  uninstallHarnessNativeStorage()
})

it('正式注册表、Gateway 与 Henji Script 共用后台任务完成判据并只取消活动任务', async () => {
  const registry = new CameraStageRenderTaskRegistry()
  installTaskRegistryBridge(registry)
  const stage = await createStoredCameraStageProject('助手后台镜头')
  const canvasProjectId = await useProjectStore.getState().createProject('助手后台输出')
  const source: CanvasNode = {
    id: 'camera-node',
    type: CANVAS_NODE_TYPES.cameraStage,
    position: { x: 0, y: 0 },
    data: { ...cameraStageNodeDefinition.createDefaultData(), projectId: stage.id },
  }
  useCanvasStore.getState().setCanvasData([source], [], { past: [], future: [] })
  await confirmCanvasPersistence(canvasProjectId)

  const firstRuntime = buildAssistantHarnessRuntime({ goal: '输出 3D 镜头图片', steps: [] })
  runtimes.push(firstRuntime)
  await discover(firstRuntime, 'first')
  await runScript(firstRuntime, 'render-first', [
    `const submitted = await app.action('render_camera_stage_output', {`,
    `  projectRef: { kind: 'canvas.project', id: '${canvasProjectId}' },`,
    `  nodeRef: { kind: 'canvas.node', id: '${canvasProjectId}:camera-node' },`,
    `  outputKind: 'image', resolutionPreset: '720p', selectedTimeSec: 0,`,
    `});`,
    `app.assert.equal(submitted.status, 'submitted');`,
  ].join('\n'))
  const firstTask = taskDescriptor()
  expect(registry.require(firstTask, OWNER_ID)?.status).toBe('queued')

  const completed = registry.applyEvent({
    type: 'completed',
    requestId: firstTask.requestId,
    nodeId: firstTask.nodeId,
    result: {
      kind: 'image', mediaUrl: 'henji-media://camera-stage/result.png',
      mediaPath: '/pixel-boundary/result.png', savedPath: '/pixel-boundary/result.png',
      width: 1280, height: 720, aspectRatio: '16:9', selectedTimeSec: 0,
    },
  })
  await applyCameraStageRenderTask(completed)
  expect(registry.require(firstTask, OWNER_ID)).toBeNull()
  const resultNode = useCanvasStore.getState().nodes.find((node) => (
    node.data.generationOutputCommitId === `camera-stage-render:${firstTask.requestId}`
  ))
  expect(resultNode).toMatchObject({
    type: CANVAS_NODE_TYPES.exportImage,
    data: { cameraStageRenderReceipt: firstTask },
  })

  firstRuntime.dispose()
  runtimes.splice(runtimes.indexOf(firstRuntime), 1)
  const secondRuntime = buildAssistantHarnessRuntime({ goal: '读取完成结果并取消下一项输出', steps: [] })
  runtimes.push(secondRuntime)
  await discover(secondRuntime, 'second')
  await runScript(secondRuntime, 'get-completed', [
    `const task = await app.action('get_camera_stage_render_task', { taskRef: ${taskRefSource(firstTask)} });`,
    `app.assert.equal(task.status, 'completed');`,
    `app.assert.exists(task.resultRefs[0]);`,
  ].join('\n'))
  await runScript(secondRuntime, 'render-second', [
    `const submitted = await app.action('render_camera_stage_output', {`,
    `  projectRef: { kind: 'canvas.project', id: '${canvasProjectId}' },`,
    `  nodeRef: { kind: 'canvas.node', id: '${canvasProjectId}:camera-node' },`,
    `  outputKind: 'image', resolutionPreset: '1080p', selectedTimeSec: 0,`,
    `});`,
    `app.assert.equal(submitted.status, 'submitted');`,
  ].join('\n'))
  const secondTask = taskDescriptor()
  expect(secondTask.requestId).not.toBe(firstTask.requestId)
  // R2 取消按正式策略不能嵌入脚本，因此从同一个真实 Gateway 走独立审批动作。
  const cancelled = await executeTool(
    secondRuntime,
    'cancel-second',
    'cancel_camera_stage_render_task',
    { taskRef: createCameraStageRenderTaskRef({ version: 1, ...secondTask }) },
  )
  expect(cancelled.status).toBe('completed')
  if (cancelled.status === 'completed') {
    expect(cancelled.observation.output).toMatchObject({ status: 'cancellation_requested' })
  }
  await runScript(secondRuntime, 'get-cancelled', [
    `const task = await app.action('get_camera_stage_render_task', { taskRef: ${taskRefSource(secondTask)} });`,
    `app.assert.equal(task.status, 'cancelled');`,
  ].join('\n'))
  expect(registry.require(secondTask, OWNER_ID)?.status).toBe('cancelled')
})
