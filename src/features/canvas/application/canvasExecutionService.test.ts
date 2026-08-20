// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCanvasStore } from '@/stores/canvasStore'
import { useCanvasExecutionStateStore } from '@/stores/canvasExecutionStateStore'
import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
  type TextProcessingNodeData,
} from '../domain/canvasNodes'
import {
  hasReachableNonDisplayConsumer,
  registerCanvasNodeExecutor,
  resetCanvasExecutionServiceForTests,
  runCanvasNode,
} from './canvasExecutionService'

function node(id: string, type: CanvasNode['type'], data: Record<string, unknown> = {}): CanvasNode {
  return { id, type, position: { x: 0, y: 0 }, data } as CanvasNode
}

function edge(source: string, target: string): CanvasEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: 'source',
    targetHandle: 'param:__prompt',
  }
}

describe('canvasExecutionService', () => {
  beforeEach(() => {
    resetCanvasExecutionServiceForTests()
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  })

  it('从目标反向运行文本处理，完成后再读取最新输出运行目标', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing, { lastOutput: '' }),
      node('display', CANVAS_NODE_TYPES.textAnnotation, { content: '' }),
      node('image', CANVAS_NODE_TYPES.imageEdit, { prompt: '' }),
    ], [edge('text', 'display'), edge('display', 'image')])
    const order: string[] = []
    registerCanvasNodeExecutor('text', {
      kind: 'text-processing',
      run: async () => {
        order.push('text')
        useCanvasStore.getState().updateNodeData('display', { content: '最新提示词' }, { skipHistory: true })
      },
    })
    registerCanvasNodeExecutor('image', {
      kind: 'standard-generation',
      run: async () => {
        const display = useCanvasStore.getState().nodes.find((item) => item.id === 'display')
        order.push(`image:${String(display?.data.content)}`)
      },
    })

    await expect(runCanvasNode('image')).resolves.toMatchObject({
      executedNodeIds: ['text', 'image'],
    })
    expect(order).toEqual(['text', 'image:最新提示词'])
    expect(hasReachableNonDisplayConsumer(
      'text', useCanvasStore.getState().nodes, useCanvasStore.getState().edges
    )).toBe(true)
  })

  it('直连目标时同样严格等待文本处理完成', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing, { lastOutput: '' }),
      node('image', CANVAS_NODE_TYPES.imageEdit, { prompt: '' }),
    ], [edge('text', 'image')])
    const order: string[] = []
    registerCanvasNodeExecutor('text', {
      kind: 'text-processing',
      run: async () => {
        await Promise.resolve()
        useCanvasStore.getState().updateNodeData('text', { lastOutput: '直连提示词' }, { skipHistory: true })
        order.push('text:done')
      },
    })
    registerCanvasNodeExecutor('image', {
      kind: 'standard-generation',
      run: async () => {
        const source = useCanvasStore.getState().nodes.find((item) => item.id === 'text')
        order.push(`image:${String(source?.data.lastOutput)}`)
      },
    })

    await runCanvasNode('image')

    expect(order).toEqual(['text:done', 'image:直连提示词'])
  })

  it('上游失败时阻断目标执行', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text', 'image')])
    const targetRun = vi.fn()
    registerCanvasNodeExecutor('text', {
      kind: 'text-processing',
      run: async () => { throw new Error('上游失败') },
    })
    registerCanvasNodeExecutor('image', { kind: 'standard-generation', run: targetRun })

    await expect(runCanvasNode('image')).rejects.toThrow('上游失败')
    expect(targetRun).not.toHaveBeenCalled()
    expect(useCanvasExecutionStateStore.getState().activeNodes).toEqual({})
  })

  it('两个目标并发请求同一上游时共享正在运行的任务', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing),
      node('image-a', CANVAS_NODE_TYPES.imageEdit),
      node('image-b', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text', 'image-a'), edge('text', 'image-b')])
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const upstreamRun = vi.fn(async () => { await gate })
    registerCanvasNodeExecutor('text', { kind: 'text-processing', run: upstreamRun })
    registerCanvasNodeExecutor('image-a', { kind: 'standard-generation', run: async () => undefined })
    registerCanvasNodeExecutor('image-b', { kind: 'standard-generation', run: async () => undefined })

    const first = runCanvasNode('image-a')
    const second = runCanvasNode('image-b')
    await vi.waitFor(() => expect(upstreamRun).toHaveBeenCalledTimes(1))
    release?.()
    await Promise.all([first, second])

    expect(upstreamRun).toHaveBeenCalledTimes(1)
  })

  it('按依赖顺序切换当前执行节点，并在完成后清理瞬态状态', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text', 'image')])
    let releaseText: (() => void) | undefined
    let releaseImage: (() => void) | undefined
    const textGate = new Promise<void>((resolve) => { releaseText = resolve })
    const imageGate = new Promise<void>((resolve) => { releaseImage = resolve })
    registerCanvasNodeExecutor('text', {
      kind: 'text-processing',
      run: async () => { await textGate },
    })
    registerCanvasNodeExecutor('image', {
      kind: 'standard-generation',
      run: async () => { await imageGate },
    })

    const run = runCanvasNode('image')
    await vi.waitFor(() => expect(useCanvasExecutionStateStore.getState().activeNodes).toMatchObject({
      text: { phase: 'processing' },
    }))
    expect(useCanvasExecutionStateStore.getState().activeNodes.image).toBeUndefined()

    releaseText?.()
    await vi.waitFor(() => expect(useCanvasExecutionStateStore.getState().activeNodes).toMatchObject({
      image: { phase: 'generating' },
    }))
    expect(useCanvasExecutionStateStore.getState().activeNodes.text).toBeUndefined()

    releaseImage?.()
    await run
    expect(useCanvasExecutionStateStore.getState().activeNodes).toEqual({})
  })

  it('拒绝循环依赖，并识别只有展示节点时没有实际消费方', async () => {
    const nodes = [
      node('text', CANVAS_NODE_TYPES.textProcessing),
      node('display', CANVAS_NODE_TYPES.textAnnotation),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ]
    const displayOnlyEdges = [edge('text', 'display')]
    expect(hasReachableNonDisplayConsumer('text', nodes, displayOnlyEdges)).toBe(false)

    useCanvasStore.getState().setCanvasData(nodes, [
      ...displayOnlyEdges,
      edge('display', 'image'),
      edge('image', 'text'),
    ])
    registerCanvasNodeExecutor('image', { kind: 'standard-generation', run: async () => undefined })
    await expect(runCanvasNode('image')).rejects.toThrow('循环依赖')
    expect(useCanvasExecutionStateStore.getState().activeNodes).toEqual({})
  })

  it('把执行器声明的复用结果计入复用节点', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing, {
        fixedResult: true,
      } satisfies Partial<TextProcessingNodeData>),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text', 'image')])
    registerCanvasNodeExecutor('text', {
      kind: 'text-processing',
      run: async () => ({ status: 'reused' }),
    })
    registerCanvasNodeExecutor('image', { kind: 'standard-generation', run: async () => undefined })

    await expect(runCanvasNode('image')).resolves.toMatchObject({ reusedNodeIds: ['text'] })
  })
})
