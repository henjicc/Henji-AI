// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { GenerationService } from '@/core/services/GenerationService'
import { registry } from '@/core/ModelRegistry'
import { useProjectStore } from '@/stores/projectStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '../domain/canvasNodes'
import { createDefaultMultiAngleConfig } from '../capabilities/multiAnglePolicy'
import { runCanvasNode, resetCanvasExecutionServiceForTests } from './canvasExecutionService'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'

vi.mock('./imageData', async original => ({
  ...await original<typeof import('./imageData')>(),
  persistImageLocally: vi.fn(async (url: string) => url),
  prepareNodeImage: vi.fn(async (url: string) => ({ imageUrl: url, previewImageUrl: url, aspectRatio: '1:1', createdFilePaths: [] })),
}))
vi.mock('../nodes/storyboardGen/shared', async original => ({
  ...await original<typeof import('../nodes/storyboardGen/shared')>(),
  generateGridImageDataUrl: () => 'data:image/png;base64,fixture',
}))
vi.mock('@/commands/image', async original => ({
  ...await original<typeof import('@/commands/image')>(),
  embedStoryboardImageMetadata: vi.fn(async () => 'C:/storyboard.png'),
}))

let projectId: string
beforeAll(async () => { await loadRealModelsIntoRegistry() })
beforeEach(async () => {
  installHarnessNativeStorage()
  resetCanvasExecutionServiceForTests()
  await useProjectStore.getState().hydrate()
  projectId = await useProjectStore.getState().createProject('专用节点 B')
  useSettingsStore.setState({ providerKeyStatus: Object.fromEntries(registry.getModelsByType('image').map(model => [model.meta.provider, true])) })
  vi.spyOn(GenerationService.getInstance(), 'getProgressEstimate').mockResolvedValue(null)
  vi.spyOn(GenerationService.getInstance(), 'generate').mockResolvedValue({ status: 'pending', url: '', taskId: 'provider-original' })
})
afterEach(() => {
  resetCanvasExecutionServiceForTests()
  vi.restoreAllMocks()
  uninstallHarnessNativeStorage()
})

function addNode(type: CanvasNodeType): string {
  const config = createDefaultMultiAngleConfig()
  config.views = config.views.slice(0, 1)
  return useCanvasStore.getState().addNode(type, { x: 20, y: 20 }, {
    mediaInputs: { image: ['C:/source.png'] }, multiAngleConfig: config,
    gridRows: 1, gridCols: 1, frames: [{ id: 'frame', description: '晴朗海边', order: 0 }],
  })
}

it.each([CANVAS_NODE_TYPES.multiAngleGen, CANVAS_NODE_TYPES.relightGen, CANVAS_NODE_TYPES.storyboardGen])(
  '%s 不挂载 React 也能在 A 页面运行 B，切换与关闭页面后保存原工程', async type => {
    const nodeId = addNode(type)
    let finish!: () => void
    const poll = vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockImplementation(async () => {
      await new Promise<void>(resolve => { finish = resolve })
      return { status: 'completed', url: 'C:/result.png', filePath: 'C:/result.png' }
    })
    const visibleId = await useProjectStore.getState().createProject('用户 A')
    const running = runCanvasNode(nodeId, undefined, projectId)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(useProjectStore.getState().currentProjectId).toBe(visibleId)
    const before = await readPersistedCanvasProjectSnapshot(projectId)
    if (type === CANVAS_NODE_TYPES.multiAngleGen) {
      expect(before.nodes.find(node => node.id === nodeId)?.data.multiAngleBatch).toMatchObject({ items: [expect.objectContaining({ providerRequestId: 'provider-original' })] })
    } else {
      expect(before.nodes.find(node => node.type === CANVAS_NODE_TYPES.exportImage)?.data.serverTaskId).toBe('provider-original')
    }
    await useProjectStore.getState().openProject(projectId)
    await useProjectStore.getState().closeProject()
    finish()
    const result = await running
    expect(GenerationService.getInstance().generate).toHaveBeenCalledTimes(1)
    expect(poll).toHaveBeenCalledTimes(1)
    expect(result.resultNodeIds).toHaveLength(1)
    const saved = await readPersistedCanvasProjectSnapshot(projectId)
    expect(saved.nodes.find(node => node.id === result.resultNodeIds[0])?.data.isGenerating).toBe(false)
    expect(saved.nodes.find(node => node.id === nodeId)?.data.latestExecution).toBeDefined()
    expect((await readPersistedCanvasProjectSnapshot(visibleId)).nodes).toHaveLength(0)
  },
)

it('多角度已取得任务编号后失败，后台重试只续查原请求，不重新付费提交', async () => {
  const nodeId = addNode(CANVAS_NODE_TYPES.multiAngleGen)
  const poll = vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockRejectedValueOnce(new Error('poll-disconnected'))
  await expect(runCanvasNode(nodeId)).rejects.toThrow('poll-disconnected')
  const failed = await readPersistedCanvasProjectSnapshot(projectId)
  expect(failed.nodes.find(node => node.id === nodeId)?.data.multiAngleBatch).toMatchObject({ items: [expect.objectContaining({ providerRequestId: 'provider-original' })] })
  await useProjectStore.getState().closeProject()
  poll.mockResolvedValue({ status: 'completed', url: 'C:/result.png', filePath: 'C:/result.png' })
  await runCanvasNode(nodeId, undefined, projectId)
  expect(GenerationService.getInstance().generate).toHaveBeenCalledTimes(1)
  expect(poll).toHaveBeenCalledTimes(2)
})

it.each([CANVAS_NODE_TYPES.relightGen, CANVAS_NODE_TYPES.storyboardGen])('%s 轮询失败保留原供应商编号供恢复查询', async type => {
  const nodeId = addNode(type)
  vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockRejectedValue(new Error('connection-lost'))
  await useProjectStore.getState().closeProject()
  await expect(runCanvasNode(nodeId, undefined, projectId)).rejects.toThrow('connection-lost')
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.find(node => node.type === CANVAS_NODE_TYPES.exportImage)?.data).toMatchObject({
    isGenerating: false, generationError: 'connection-lost', serverTaskId: 'provider-original',
  })
  expect(GenerationService.getInstance().generate).toHaveBeenCalledTimes(1)
})
