import { setCanvasTestProjectState } from '@/tests/canvasProjectFixture';
// @vitest-environment jsdom
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../domain/canvasNodes';
import { resolveLayerStackRecoveryTask } from '../domain/layerStackResultRecovery';
import { useCanvasStore } from '@/stores/canvasStore';
import { type Project } from '@/stores/projectStore';
import { retryLayerStackResult } from './layerStackResultRecoveryService';
import { registerCanvasCapabilityHandlers } from '@/features/canvas/application/registerCanvasCapabilityHandlers';
import type { CapabilityHandler } from '@/features/application-control/capabilities/handlerTypes';
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry';
import { useProjectStore } from '@/stores/projectStore';
import { resumeCanvasGenerationInProject } from './canvasResumePollingService';
vi.mock('./canvasResumePollingService', () => ({ resumeCanvasGenerationInProject: vi.fn(async () => 1) }));

const task = { taskId: 'existing-task', modelId: 'kie-seedream-5.0-pro' }
const error = `Continue polling failed for ${task.modelId}: terminated`
function fixture(): CanvasNode {
  return {
    id: 'result', type: 'layerStackResultNode', position: { x: 200, y: 120 },
    data: {
      imageUrl: null, aspectRatio: '1:1', resultKind: 'layer-stack',
      generationInputSignature: 'input-a', generationSourceNodeId: 'source',
      generationProviderId: 'kie', sourceCapabilityId: 'image.layer-separation',
      generationInputImages: ['input.jpg'], isGenerating: false, generationError: error,
      serverTaskId: null, serverTaskModelId: null,
    },
  }
}
function pending(): CanvasNode {
  const node = fixture()
  node.data = { ...node.data, isGenerating: true, generationError: null,
    serverTaskId: task.taskId, serverTaskModelId: task.modelId }
  return node
}
function history(nodes: CanvasNode[]): { past: Array<{ nodes: CanvasNode[]; edges: [] }> } {
  return { past: nodes.map((node) => ({ nodes: [node], edges: [] })) }
}

describe('多图层下载失败原任务恢复', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const node = fixture()
    const other: CanvasNode = { id: 'other', type: 'uploadNode', position: { x: 77, y: 88 },
      data: { imageUrl: 'other.jpg', aspectRatio: '1:1' } }
    useCanvasStore.getState().setCanvasData([node, other], [], { ...history([pending()]), future: [] })
    const project: Project = { id: 'project', name: '恢复测试', createdAt: 1, updatedAt: 1,
      nodeCount: 2, coverPath: null, nodes: [node, other], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
      history: { ...history([pending()]), future: [] } }
    setCanvasTestProjectState({ currentProjectId: project.id, currentProject: project })
  })

  it('从最近历史恢复原任务，只写结果节点且重复点击不重复提交', async () => {
    const before = useCanvasStore.getState()
    const other = before.nodes[1]
    const first = await retryLayerStackResult({ projectId: 'project', nodeId: 'result' })
    const after = useCanvasStore.getState()
    expect(first).toMatchObject({ status: 'retrieving', nodeRef: { kind: 'canvas.node', id: 'project:result' } })
    expect(after.nodes[0].data).toMatchObject({ serverTaskId: task.taskId, serverTaskModelId: task.modelId,
      generationError: null, isGenerating: true })
    expect(after.nodes[1]).toBe(other)
    expect(after.nodes[0].position).toEqual(before.nodes[0].position)
    expect(after.edges).toEqual(before.edges)
    expect((await retryLayerStackResult({ projectId: 'project', nodeId: 'result' })).status).toBe('already_retrieving')
    expect(useCanvasStore.getState().nodes).toBe(after.nodes)
  })

  it('不要求活动画布或挂载 hook，显式启动原文档后台续查', async () => {
    useProjectStore.setState({ currentProjectId: null, currentProject: null })
    await expect(retryLayerStackResult({ projectId: 'project', nodeId: 'result' })).resolves.toMatchObject({ status: 'retrieving' })
    expect(resumeCanvasGenerationInProject).toHaveBeenCalledWith('project', new Set(['result']))
    expect(useProjectStore.getState().currentProjectId).toBeNull()
  })

  it('已有任务优先续取，不用历史中的旧编号', () => {
    const node = fixture()
    node.data = { ...node.data, serverTaskId: 'current-task', serverTaskModelId: task.modelId }
    expect(resolveLayerStackRecoveryTask(node, history([pending()]))?.taskId).toBe('current-task')
  })

  it.each(['generationInputSignature', 'generationSourceNodeId', 'generationProviderId', 'sourceCapabilityId'])(
    '%s 变化即拒绝跨生成恢复', (field) => {
      const changed = pending()
      changed.data[field] = 'different'
      expect(resolveLayerStackRecoveryTask(fixture(), history([pending(), changed]))).toBeNull()
    },
  )

  it('节点曾移除、输入图变化或模型不一致时，不跨越该边界搜更旧任务', () => {
    const removed = pending(); removed.id = 'different-node'
    const inputChanged = pending(); inputChanged.data.generationInputImages = ['changed.jpg']
    const modelChanged = pending(); modelChanged.data.serverTaskModelId = 'other-model'
    for (const changed of [removed, inputChanged, modelChanged]) {
      expect(resolveLayerStackRecoveryTask(fixture(), history([pending(), changed]))).toBeNull()
    }
  })

  it.each(['cancelled', 'API key invalid', 'generation failed', 'invalid parameters'])(
    '不复活非下载失败：%s', (message) => {
      const node = fixture(); node.data.generationError = message
      expect(resolveLayerStackRecoveryTask(node, history([pending()]))).toBeNull()
    },
  )

  it('已交付结果即便残留生成态和任务号也不能进入恢复', async () => {
    const node = pending(); node.data.imageUrl = 'completed.png'
    useCanvasStore.getState().setCanvasData([node], [])
    await expect(retryLayerStackResult({ projectId: 'project', nodeId: 'result' })).rejects.toThrow('已经完成')
    expect(useCanvasStore.getState().nodes[0].data.imageUrl).toBe('completed.png')
  })

  it('取消和缺失节点在事务前拒绝，不产生写入', async () => {
    const before = useCanvasStore.getState().nodes
    const controller = new AbortController(); controller.abort()
    await expect(retryLayerStackResult({ projectId: 'project', nodeId: 'result', signal: controller.signal })).rejects.toThrow('已取消')
    await expect(retryLayerStackResult({ projectId: 'project', nodeId: 'missing' })).rejects.toThrow('多图层结果节点')
    expect(useCanvasStore.getState().nodes).toBe(before)
  })

  it('助手正式处理器复用相同恢复服务并只报告已提交，契约不接受服务端任务号', async () => {
    const handlers = new Map<string, CapabilityHandler>()
    registerCanvasCapabilityHandlers({ registerHandler: (id, handler) => handlers.set(id, handler) })
    const capability = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('retry_layer_stack_result')!
    const input = { canvasRef: { kind: 'canvas.document', id: 'project' }, nodeRef: { kind: 'canvas.node', id: 'project:result' } }
    expect(capability.completionKind).toBe('submitted')
    expect(capability.aiInputSchema.additionalProperties).toBe(false)
    expect(capability.inputSchema.safeParse({ ...input, serverTaskId: 'injected' }).success).toBe(false)
    const result = await handlers.get(capability.id)!(input, { signal: new AbortController().signal })
    expect(result.status).toBe('retrieving')
    expect(useCanvasStore.getState().nodes[0].data.serverTaskId).toBe(task.taskId)
    expect(capability.outputSchema.safeParse({ ...result, revision: 1, scopeRevisions: { canvas: 1 } }).success).toBe(true)
    expect(capability.resolveObservedEffects?.(input, result)?.[0].targetRefs).toEqual(result.resultRefs)
    expect(JSON.stringify(result)).not.toContain(task.taskId)
    await expect(handlers.get(capability.id)!({ ...input, nodeRef: { kind: 'canvas.node', id: 'result' } },
      { signal: new AbortController().signal })).rejects.toThrow('完整节点引用')
  })
})
