// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { registry } from '@/core/ModelRegistry'
import { GenerationService } from '@/core/services/GenerationService'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { createGenerationNodeExecutor, type GenerationNodeExecutionOptions } from './generationNodeExecutor'
import { registerCanvasNodeExecutor, resetCanvasExecutionServiceForTests, runCanvasNode } from './canvasExecutionService'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'

// 只替换媒体 I/O；参数准备、图执行、结果编排及工程保存均走正式服务。
vi.mock('./imageData', async (original) => ({
  ...await original<typeof import('./imageData')>(),
  persistImageLocally: vi.fn(async (url: string) => url),
  prepareNodeImage: vi.fn(async (url: string) => ({ imageUrl: url, previewImageUrl: url, aspectRatio: '1:1', createdFilePaths: [] })),
}))
let projectId: string
let nodeId: string
let options: GenerationNodeExecutionOptions
beforeEach(async () => {
  installHarnessNativeStorage()
  resetCanvasExecutionServiceForTests()
  registry.register({ meta: { id: 'executor-fixture', canonicalModelId: 'nano-banana', provider: 'fixture', type: 'image', name: { zh: '执行器测试', en: 'Executor' } },
    params: [], endpoints: '/fixture', request: { builder: params => params },
    inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } }, pricing: { currency: '$', fixed: 0.01 } })
  useSettingsStore.setState({ providerKeyStatus: { ...useSettingsStore.getState().providerKeyStatus, fixture: true } })
  vi.spyOn(GenerationService.getInstance(), 'getProgressEstimate').mockResolvedValue(null)
  projectId = await useProjectStore.getState().createProject('无页面执行器测试')
  const canvas = useCanvasStore.getState()
  const reference = canvas.addNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, { imageUrl: 'C:/reference.png' })
  nodeId = canvas.addNode(CANVAS_NODE_TYPES.imageEdit, { x: 400, y: 0 }, { modelId: 'executor-fixture', prompt: '生成三视图', params: {} })
  canvas.addEdge(reference, nodeId)
  options = { nodeId, modelType: 'image', resultNodeType: CANVAS_NODE_TYPES.exportImage,
    acceptedKinds: ['image'], acceptedMediaKinds: ['image'], capability: null, showModelInput: true,
    requirePrompt: true, promptRequiredKey: 'promptRequired', apiKeyRequiredKey: 'apiKeyRequired', resultTitleKey: 'resultTitle',
    setPromptInvalid: vi.fn(), t: i18n.t.bind(i18n) }
})
afterEach(() => {
  resetCanvasExecutionServiceForTests()
  registry.unregister('executor-fixture')
  vi.restoreAllMocks()
  uninstallHarnessNativeStorage()
})

it('不挂载 React 节点也能经同一执行器准备参考图、生成、连线并保存结果', async () => {
  const generate = vi.spyOn(GenerationService.getInstance(), 'generate').mockResolvedValue({ status: 'completed', url: 'C:/generated.png', filePath: 'C:/generated.png' })
  registerCanvasNodeExecutor(nodeId, createGenerationNodeExecutor(() => options))
  // 同一执行器读取最新配置，避免 UI 重渲染造成替换或后台配置过期。
  options = { ...options, resultNodeExtraData: { displayName: '最新输出标题' } }
  const result = await runCanvasNode(nodeId)
  expect(generate).toHaveBeenCalledTimes(1)
  expect(generate).toHaveBeenCalledWith('executor-fixture', expect.objectContaining({ prompt: '生成三视图', images: ['C:/reference.png'] }), expect.any(Function), expect.any(Object))
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(result.resultNodeIds).toHaveLength(1)
  expect(saved.nodes.find(node => node.id === result.resultNodeIds[0])?.data).toMatchObject({ imageUrl: 'C:/generated.png', isGenerating: false, displayName: '最新输出标题' })
  expect(saved.edges).toEqual(expect.arrayContaining([expect.objectContaining({ source: nodeId, target: result.resultNodeIds[0] })]))
})

it('缺少提示词仍在提交前拒绝，不创建结果节点或调用供应商', async () => {
  useCanvasStore.getState().updateNodeData(nodeId, { prompt: '' })
  const before = useCanvasStore.getState().nodes.length
  const generate = vi.spyOn(GenerationService.getInstance(), 'generate')
  registerCanvasNodeExecutor(nodeId, createGenerationNodeExecutor(() => options))
  await expect(runCanvasNode(nodeId)).rejects.toThrow('promptRequired')
  expect(generate).not.toHaveBeenCalled()
  expect(useCanvasStore.getState().nodes).toHaveLength(before)
  expect(options.setPromptInvalid).toHaveBeenCalledWith(true)
})
