import { setCanvasTestProjectState } from '@/tests/canvasProjectFixture'
import '@/tests/cameraStageProjectFixture'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createStoredCameraStageProject, deleteProject as deleteStageProject, loadProjectIntoScene } from '@/features/cameraStage/projects/cameraStageProjectService'
import { findCameraStageProjectInstance } from '@/features/cameraStage/application/cameraStageProjectRuntime'
import { findCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances'
import { applyCameraStageRenderTask, resetCameraStageRenderTasksForTests, startCameraStageNodeRender } from '@/features/canvas/application/cameraStageRenderApplicationService'
import { createCameraStageRenderTaskRef } from '@/features/cameraStage/application/cameraStageRenderCapabilityAdapter'
import { confirmCanvasPersistence } from '@/features/canvas/application/canvasPersistenceService'
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { cameraStageNodeDefinition } from '@/features/canvas/domain/nodeRegistryStandardDefinitions'
import type { CameraStageRenderEvent, CameraStageRenderPlatform, CameraStageRenderTaskSnapshot } from '@/platform/contracts/cameraStageRender'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'

import { CameraStageRenderTaskRegistry } from '../../electron/main/services/camera-stage-render-task-registry'
import { createApplicationHarness } from './applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'

vi.mock('@/features/canvas/generation/mediaResultPersist', () => ({
  // 真实像素属于 harness 允许替代的外部边界；结果节点、事务、回执和持久化仍走生产服务。
  persistGenerationResult: async (_mediaType: string, output: string) => ({
    patch: { imageUrl: output, previewImageUrl: output, aspectRatio: '16:9' },
    createdFilePaths: [],
  }),
}))

const OWNER_ID = 1
const runtimes: Array<ReturnType<typeof createApplicationHarness>> = []

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

function taskDescriptor(): NonNullable<CanvasNode['data']['renderTask']> {
  const source = useCanvasStore.getState().nodes.find((node) => node.id === 'camera-node')
  if (!source?.data.renderTask) throw new Error('正式能力没有把后台任务登记到源节点')
  return source.data.renderTask
}

beforeEach(() => {
  installHarnessNativeStorage()
  useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  setCanvasTestProjectState({
    projects: [], currentProjectId: null, currentProject: null,
    isHydrated: true, isOpeningProject: false, openError: null,
    persistenceError: null, persistenceErrors: {},
  })
})

afterEach(async () => {
  await resetCameraStageRenderTasksForTests()
  runtimes.splice(0).forEach((runtime) => runtime.dispose())
  vi.restoreAllMocks()
  uninstallHarnessNativeStorage()
})

it('公共应用入口 共用后台任务完成判据并只取消活动任务', async () => {
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

  const firstRuntime = createApplicationHarness()
  runtimes.push(firstRuntime)
  const submitted = await firstRuntime.requireResult('render_camera_stage_output', {
    projectRef: { kind: 'canvas.project', id: canvasProjectId }, nodeRef: { kind: 'canvas.node', id: `${canvasProjectId}:camera-node` },
    outputKind: 'image', resolutionPreset: '720p', selectedTimeSec: 0,
  })
  expect(submitted.status).toBe('submitted')
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
  const secondRuntime = createApplicationHarness()
  runtimes.push(secondRuntime)
  const completedRead = await secondRuntime.requireResult('get_camera_stage_render_task', { taskRef: createCameraStageRenderTaskRef({ version: 1, ...firstTask }) })
  expect(completedRead.status).toBe('completed')
  expect((completedRead.resultRefs as unknown[]).length).toBeGreaterThan(0)
  expect((await secondRuntime.requireResult('render_camera_stage_output', {
    projectRef: { kind: 'canvas.project', id: canvasProjectId }, nodeRef: { kind: 'canvas.node', id: `${canvasProjectId}:camera-node` },
    outputKind: 'image', resolutionPreset: '1080p', selectedTimeSec: 0,
  })).status).toBe('submitted')
  const secondTask = taskDescriptor()
  expect(secondTask.requestId).not.toBe(firstTask.requestId)
  const ref = createCameraStageRenderTaskRef({ version: 1, ...secondTask })
  const baseline = await secondRuntime.requireResult('get_camera_stage_render_task', { taskRef: ref })
  const cancelled = await secondRuntime.requireResult('cancel_camera_stage_render_task', { taskRef: ref }, baseline.revisions as Record<string, number>)
  expect(cancelled.status).toBe('cancellation_requested')
  expect((await secondRuntime.requireResult('get_camera_stage_render_task', { taskRef: ref })).status).toBe('cancelled')
  expect(registry.require(secondTask, OWNER_ID)?.status).toBe('cancelled')
})

it.each(['canvas', 'cameraStage'] as const)('A 页面后台渲染 B，打开 B 不接管任务，删除 %s 等待原结果保存', async deleteTarget => {
  const registry = new CameraStageRenderTaskRegistry()
  installTaskRegistryBridge(registry)
  const stage = await createStoredCameraStageProject('后台 B 场景')
  const projectId = await useProjectStore.getState().createProject('后台 B 画布')
  useCanvasStore.getState().setCanvasData([{
    id: 'camera-node', type: CANVAS_NODE_TYPES.cameraStage, position: { x: 0, y: 0 },
    data: { ...cameraStageNodeDefinition.createDefaultData(), projectId: stage.id },
  }], [], { past: [], future: [] })
  await confirmCanvasPersistence(projectId)
  const canvasInstance = findCanvasProjectInstance(projectId)!
  const stageInstance = findCameraStageProjectInstance(stage.id)!
  const visibleId = await useProjectStore.getState().createProject('用户编辑 A')
  const descriptor = await startCameraStageNodeRender('camera-node', 'image', {
    expectedOwner: { canvasProjectId: projectId, cameraStageProjectId: stage.id },
  })
  expect(descriptor).not.toBeNull()
  expect(useProjectStore.getState().currentProjectId).toBe(visibleId)
  expect(canvasInstance.leases).toBe(1)
  expect(stageInstance.leases).toBe(1)
  await loadProjectIntoScene(stage.id)
  await useProjectStore.getState().openProject(projectId)
  expect(findCanvasProjectInstance(projectId)).toBe(canvasInstance)
  expect(findCameraStageProjectInstance(stage.id)).toBe(stageInstance)
  await useProjectStore.getState().openProject(visibleId)
  let deleted = false
  const deleting = (deleteTarget === 'canvas' ? useProjectStore.getState().deleteProject(projectId) : deleteStageProject(stage.id))
    .then(() => { deleted = true })
  await Promise.resolve()
  expect(deleted).toBe(false)
  const completed = registry.applyEvent({
    type: 'completed', requestId: descriptor!.requestId, nodeId: 'camera-node',
    result: { kind: 'image', mediaUrl: 'henji-media://camera-stage/b.png', mediaPath: '/pixel-boundary/b.png',
      savedPath: '/pixel-boundary/b.png', width: 1280, height: 720, aspectRatio: '16:9', selectedTimeSec: 0 },
  })
  await applyCameraStageRenderTask(completed)
  await deleting
  expect(canvasInstance.store.getState().nodes.filter(node => node.data.generationOutputCommitId === `camera-stage-render:${descriptor!.requestId}`)).toHaveLength(1)
  expect(useProjectStore.getState().currentProjectId).toBe(visibleId)
  expect(registry.require(descriptor!, OWNER_ID)).toBeNull()
  expect(canvasInstance.leases).toBe(0)
  expect(stageInstance.leases).toBe(0)
})
