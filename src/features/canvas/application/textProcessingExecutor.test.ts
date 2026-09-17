// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { llmCancelTask, llmChatStream } from '@/commands/llmRuntime'
import type { LlmConfigState } from '@henjicc/ai-sdk'
import { DEFAULT_LLM_CAPABILITIES } from '@/core/llm/defaults'
import { llmConfigService } from '@/services/llm/LlmConfigService'
import { useProjectStore } from '@/stores/projectStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { runCanvasNode, resetCanvasExecutionServiceForTests } from './canvasExecutionService'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'
import { attachCanvasGenerationFeedback } from './canvasDomainExecutors'
import { findCanvasProjectInstance } from './canvasProjectInstances'

vi.mock('@/commands/llmRuntime', async original => ({
  ...await original<typeof import('@/commands/llmRuntime')>(),
  llmChatStream: vi.fn(), llmCancelTask: vi.fn(async () => undefined),
}))

let projectId: string
let nodeId: string
const config: LlmConfigState = {
  providers: [{ providerId: 'fixture', displayName: 'Fixture', adapter: 'openai', enabled: true }],
  models: [{ providerId: 'fixture', modelId: 'text', displayName: 'Text', adapter: 'openai', enabled: true, capabilities: DEFAULT_LLM_CAPABILITIES }],
  promptProfiles: [], textProcessingPromptTemplates: [], agentProfiles: [], tools: [],
  policy: { allowedTools: [], requireHumanConfirmation: false }, memory: {},
}

beforeEach(async () => {
  vi.clearAllMocks()
  installHarnessNativeStorage()
  resetCanvasExecutionServiceForTests()
  vi.spyOn(llmConfigService, 'getConfig').mockResolvedValue(config)
  await useProjectStore.getState().hydrate()
  projectId = await useProjectStore.getState().createProject('文本工程 B')
  nodeId = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.textProcessing, { x: 0, y: 0 }, {
    prompt: '写一句话', providerId: 'fixture', modelId: 'text',
  })
})
afterEach(() => {
  resetCanvasExecutionServiceForTests()
  vi.restoreAllMocks()
  uninstallHarnessNativeStorage()
})

it('未挂载文本节点可从 A 页面运行 B，打开再关闭 B 不取消流，结果与历史保存到 B', async () => {
  let finish!: () => void
  vi.mocked(llmChatStream).mockImplementation(async (_request, emit) => {
    emit({ type: 'Token', data: '前半句' })
    await new Promise<void>(resolve => { finish = resolve })
    emit({ type: 'Token', data: '后半句' })
    emit({ type: 'Done', data: { providerId: 'fixture', modelId: 'text', startedAtMs: 0, elapsedMs: 1, inputChars: 4, outputChars: 6 } })
  })
  const visibleId = await useProjectStore.getState().createProject('可见 A')
  const running = runCanvasNode(nodeId, undefined, projectId)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(useProjectStore.getState().currentProjectId).toBe(visibleId)
  await useProjectStore.getState().openProject(projectId)
  await useProjectStore.getState().closeProject()
  expect(llmCancelTask).not.toHaveBeenCalled()
  finish()
  const result = await running
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.find(node => node.id === nodeId)?.data).toMatchObject({ lastOutput: '前半句后半句', lastExecutionStatus: 'success' })
  expect(saved.nodes.find(node => node.id === result.resultNodeIds[0])?.data).toMatchObject({ content: '前半句后半句', isGenerating: false })
  expect((await readPersistedCanvasProjectSnapshot(visibleId)).nodes).toHaveLength(0)
})

it('取消一条文本任务不会取消另一工程的流，已收到文本与失败状态仍保存', async () => {
  const finishers = new Map<string, () => void>()
  vi.mocked(llmChatStream).mockImplementation(async (request, emit) => {
    emit({ type: 'Token', data: '保留片段' })
    await new Promise<void>(resolve => { finishers.set(request.requestId!, resolve) })
    emit({ type: 'Done', data: { providerId: 'fixture', modelId: 'text', startedAtMs: 0, elapsedMs: 1, inputChars: 4, outputChars: 4 } })
  })
  vi.mocked(llmCancelTask).mockImplementation(async requestId => { finishers.get(requestId)?.() })
  const firstProject = projectId
  const firstNode = nodeId
  const secondProject = await useProjectStore.getState().createProject('并行工程')
  const secondNode = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.textProcessing, { x: 0, y: 0 }, { prompt: '另一句', providerId: 'fixture', modelId: 'text' })
  const controller = new AbortController()
  const first = runCanvasNode(firstNode, undefined, firstProject, controller.signal)
  const failure = expect(first).rejects.toThrow('取消')
  const second = runCanvasNode(secondNode, undefined, secondProject)
  await vi.waitFor(() => expect(finishers.size).toBe(2))
  controller.abort()
  await failure
  expect(llmCancelTask).toHaveBeenCalledTimes(1)
  const cancelledId = vi.mocked(llmCancelTask).mock.calls[0][0]
  for (const [requestId, finish] of finishers) if (requestId !== cancelledId) finish()
  await second
  const failed = await readPersistedCanvasProjectSnapshot(firstProject)
  expect(failed.nodes.find(node => node.type === CANVAS_NODE_TYPES.textAnnotation)?.data).toMatchObject({ content: '保留片段', isGenerating: false })
  expect(failed.nodes.find(node => node.id === firstNode)?.data.lastExecutionStatus).toBe('failed')
  expect((await readPersistedCanvasProjectSnapshot(secondProject)).nodes.find(node => node.id === secondNode)?.data.lastExecutionStatus).toBe('success')
})

it('流提前结束不发布成功缓存，保存已收到片段并释放工程租用', async () => {
  vi.mocked(llmChatStream).mockImplementation(async (_request, emit) => { emit({ type: 'Token', data: '未完成' }) })
  await expect(runCanvasNode(nodeId)).rejects.toThrow('未收到完成事件')
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.find(node => node.id === nodeId)?.data.latestExecution).toBeUndefined()
  expect(saved.nodes.find(node => node.type === CANVAS_NODE_TYPES.textAnnotation)?.data).toMatchObject({ content: '未完成', isGenerating: false })
  expect(findCanvasProjectInstance(projectId)?.leases).toBe(0)
})

it('未配置模型时仅通知已附着页面，后台执行仍返回同一业务失败', async () => {
  vi.mocked(llmConfigService.getConfig).mockResolvedValue({ ...config, models: [] })
  const notify = vi.fn()
  const detach = attachCanvasGenerationFeedback(projectId, nodeId, vi.fn(), notify)
  await expect(runCanvasNode(nodeId)).rejects.toThrow()
  expect(notify).toHaveBeenCalledTimes(1)
  detach()
  await expect(runCanvasNode(nodeId, undefined, projectId)).rejects.toThrow()
  expect(notify).toHaveBeenCalledTimes(1)
  expect(llmChatStream).not.toHaveBeenCalled()
})
