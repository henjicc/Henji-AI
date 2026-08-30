// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCanvasStore } from '@/stores/canvasStore'
import { useCanvasExecutionStateStore } from '@/stores/canvasExecutionStateStore'
import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
} from '../domain/canvasNodes'
import {
  hasReachableNonDisplayConsumer,
  registerCanvasNodeExecutor,
  resetCanvasExecutionServiceForTests,
  runCanvasNode,
  type CanvasNodeExecutionResult,
} from './canvasExecutionService'

function node(id: string, type: CanvasNode['type'], data: Record<string, unknown> = {}): CanvasNode {
  return { id, type, position: { x: 0, y: 0 }, data } as CanvasNode
}

function edge(source: string, target: string, targetHandle = 'param:__prompt'): CanvasEdge {
  return {
    id: `${source}-${target}-${targetHandle}`,
    source,
    target,
    sourceHandle: 'source',
    targetHandle,
  }
}

function completed(resultNodeIds: string[] = []): CanvasNodeExecutionResult {
  return { status: 'completed', resultNodeIds }
}

function registerRoot(nodeId: string, run?: () => Promise<CanvasNodeExecutionResult>): void {
  registerCanvasNodeExecutor(nodeId, {
    kind: 'standard-generation',
    run: run ?? (async () => completed()),
  })
}

function registerText(nodeId: string, run: () => Promise<CanvasNodeExecutionResult>): void {
  registerCanvasNodeExecutor(nodeId, {
    kind: 'text-processing',
    dependency: { mode: 'auto', outputMode: 'inline' },
    run,
  })
}

describe('canvasExecutionService 并发与一致性', () => {
  beforeEach(() => {
    resetCanvasExecutionServiceForTests()
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  })
  it('排队期间输入变化时按新签名执行，等待与缓存命中不占生成名额', async () => {
    useCanvasStore.getState().setCanvasData([
      node('generator-a', CANVAS_NODE_TYPES.imageEdit),
      node('generator-b', CANVAS_NODE_TYPES.imageEdit),
      node('generator-c', CANVAS_NODE_TYPES.imageEdit, { prompt: 'A' }),
      node('target', CANVAS_NODE_TYPES.imageEdit),
    ], [
      edge('generator-a', 'target', 'param:__image'),
      edge('generator-b', 'target', 'param:__image'),
      edge('generator-c', 'target', 'param:__image'),
    ])
    const started: string[] = []
    const releases = new Map<string, () => void>()
    for (const nodeId of ['generator-a', 'generator-b']) {
      registerCanvasNodeExecutor(nodeId, {
        kind: 'standard-generation',
        dependency: { mode: 'auto', outputMode: 'inline' },
        run: async () => {
          started.push(nodeId)
          await new Promise<void>((resolve) => releases.set(nodeId, resolve))
          return completed()
        },
      })
    }
    const seenPrompts: string[] = []
    const queuedRun = vi.fn(async () => {
      const current = useCanvasStore.getState().nodes.find((item) => item.id === 'generator-c')
      seenPrompts.push(String(current?.data.prompt))
      return completed()
    })
    registerCanvasNodeExecutor('generator-c', {
      kind: 'standard-generation',
      dependency: { mode: 'auto', outputMode: 'inline' },
      run: queuedRun,
    })
    registerRoot('target')

    const running = runCanvasNode('target')
    await vi.waitFor(() => expect(started).toHaveLength(2))
    useCanvasStore.getState().updateNodeData('generator-c', { prompt: 'B' })
    releases.get('generator-a')?.()
    await vi.waitFor(() => expect(seenPrompts).toEqual(['B']))
    releases.get('generator-b')?.()
    await running
    await runCanvasNode('target')

    expect(queuedRun).toHaveBeenCalledTimes(1)
  })

  it('一个分支失败后不再启动仍在限流队列中的付费分支', async () => {
    useCanvasStore.getState().setCanvasData([
      node('generator-a', CANVAS_NODE_TYPES.imageEdit),
      node('generator-b', CANVAS_NODE_TYPES.imageEdit),
      node('generator-c', CANVAS_NODE_TYPES.imageEdit),
      node('target', CANVAS_NODE_TYPES.imageEdit),
    ], [
      edge('generator-a', 'target', 'param:__image'),
      edge('generator-b', 'target', 'param:__image'),
      edge('generator-c', 'target', 'param:__image'),
    ])
    let rejectFirst: (() => void) | undefined
    let releaseSecond: (() => void) | undefined
    const started: string[] = []
    registerCanvasNodeExecutor('generator-a', {
      kind: 'standard-generation',
      dependency: { mode: 'auto', outputMode: 'inline' },
      run: async () => {
        started.push('generator-a')
        await new Promise<void>((resolve) => { rejectFirst = resolve })
        throw new Error('第一分支失败')
      },
    })
    registerCanvasNodeExecutor('generator-b', {
      kind: 'standard-generation',
      dependency: { mode: 'auto', outputMode: 'inline' },
      run: async () => {
        started.push('generator-b')
        await new Promise<void>((resolve) => { releaseSecond = resolve })
        return completed()
      },
    })
    const queuedRun = vi.fn(async () => completed())
    registerCanvasNodeExecutor('generator-c', {
      kind: 'standard-generation',
      dependency: { mode: 'auto', outputMode: 'inline' },
      run: queuedRun,
    })
    registerRoot('target')

    const running = runCanvasNode('target')
    const failure = expect(running).rejects.toThrow('第一分支失败')
    await vi.waitFor(() => expect(started).toHaveLength(2))
    rejectFirst?.()
    await failure
    await Promise.resolve()
    expect(queuedRun).not.toHaveBeenCalled()
    releaseSecond?.()
    await vi.waitFor(() => expect(useCanvasExecutionStateStore.getState().activeNodes).toEqual({}))
  })

  it('同一节点运行中输入变化时阻断旧链路，再按新输入串行运行', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing, { prompt: 'A' }),
      node('image-a', CANVAS_NODE_TYPES.imageEdit),
      node('image-b', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text', 'image-a'), edge('text', 'image-b')])
    const seenPrompts: string[] = []
    const releases: Array<() => void> = []
    registerText('text', async () => {
      const current = useCanvasStore.getState().nodes.find((item) => item.id === 'text')
      seenPrompts.push(String(current?.data.prompt))
      await new Promise<void>((resolve) => releases.push(resolve))
      return completed()
    })
    registerRoot('image-a')
    registerRoot('image-b')

    const first = runCanvasNode('image-a')
    const firstFailure = expect(first).rejects.toThrow('运行期间输入已变化')
    await vi.waitFor(() => expect(seenPrompts).toEqual(['A']))
    useCanvasStore.getState().updateNodeData('text', { prompt: 'B' })
    const second = runCanvasNode('image-b')
    await Promise.resolve()
    expect(seenPrompts).toEqual(['A'])
    releases[0]?.()
    await vi.waitFor(() => expect(seenPrompts).toEqual(['A', 'B']))
    releases[1]?.()
    await Promise.all([firstFailure, second])
  })

  it('两个目标并发请求同一签名的上游时加入同一任务', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing),
      node('image-a', CANVAS_NODE_TYPES.imageEdit),
      node('image-b', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text', 'image-a'), edge('text', 'image-b')])
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const upstreamRun = vi.fn(async () => { await gate; return completed() })
    registerText('text', upstreamRun)
    registerRoot('image-a')
    registerRoot('image-b')

    const first = runCanvasNode('image-a')
    const second = runCanvasNode('image-b')
    await vi.waitFor(() => expect(upstreamRun).toHaveBeenCalledTimes(1))
    release?.()
    const results = await Promise.all([first, second])

    expect(upstreamRun).toHaveBeenCalledTimes(1)
    expect(results.some((result) => result.joinedNodeIds.includes('text'))).toBe(true)
  })

  it('上游失败时阻断目标并清理瞬态状态', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text', 'image')])
    const targetRun = vi.fn(async () => completed())
    registerText('text', async () => { throw new Error('上游失败') })
    registerRoot('image', targetRun)

    await expect(runCanvasNode('image')).rejects.toThrow('上游失败')
    expect(targetRun).not.toHaveBeenCalled()
    expect(useCanvasExecutionStateStore.getState().activeNodes).toEqual({})
  })

  it('运行期间输入变化时保留本次结果但不发布缓存或继续下游', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing, { prompt: 'A' }),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text', 'image')])
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const targetRun = vi.fn(async () => completed())
    registerText('text', async () => { await gate; return completed() })
    registerRoot('image', targetRun)

    const running = runCanvasNode('image')
    await vi.waitFor(() => expect(useCanvasExecutionStateStore.getState().activeNodes.text).toBeDefined())
    useCanvasStore.getState().updateNodeData('text', { prompt: 'B' })
    release?.()

    await expect(running).rejects.toThrow('运行期间输入已变化')
    expect(targetRun).not.toHaveBeenCalled()
    expect(useCanvasStore.getState().nodes.find((item) => item.id === 'text')?.data.latestExecution)
      .toBeUndefined()
  })

  it('运行期间依赖结构变化时不让旧计划继续执行目标', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text-a', CANVAS_NODE_TYPES.textProcessing, { prompt: 'A' }),
      node('text-b', CANVAS_NODE_TYPES.textProcessing, { prompt: 'B' }),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text-a', 'image')])
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const targetRun = vi.fn(async () => completed())
    registerText('text-a', async () => { await gate; return completed() })
    registerText('text-b', async () => completed())
    registerRoot('image', targetRun)

    const running = runCanvasNode('image')
    const failure = expect(running).rejects.toThrow('依赖结构已变化')
    await vi.waitFor(() => expect(useCanvasExecutionStateStore.getState().activeNodes['text-a']).toBeDefined())
    useCanvasStore.getState().addEdge('text-b', 'image')
    release?.()

    await failure
    expect(targetRun).not.toHaveBeenCalled()
  })

  it('inline 输出校验失败时不会复用空结果', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing, { prompt: 'A' }),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text', 'image')])
    const upstreamRun = vi.fn(async () => {
      useCanvasStore.getState().updateNodeData('text', {
        lastExecutionStatus: 'success',
        lastOutput: '',
      }, { skipHistory: true })
      return completed()
    })
    registerCanvasNodeExecutor('text', {
      kind: 'text-processing',
      dependency: { mode: 'auto', outputMode: 'inline' },
      isCachedOutputValid: (current) => Boolean(String(current.data.lastOutput ?? '').trim()),
      run: upstreamRun,
    })
    registerRoot('image')

    await runCanvasNode('image')
    await runCanvasNode('image')

    expect(upstreamRun).toHaveBeenCalledTimes(2)
  })

  it('非空上传边界不执行，空上传边界在任何生成前明确失败', async () => {
    useCanvasStore.getState().setCanvasData([
      node('upload', CANVAS_NODE_TYPES.upload, { imageUrl: 'uploaded.png' }),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('upload', 'image', 'param:__image')])
    const rootRun = vi.fn(async () => completed())
    registerRoot('image', rootRun)

    await runCanvasNode('image')
    expect(rootRun).toHaveBeenCalledTimes(1)

    useCanvasStore.getState().setCanvasData([
      node('upload', CANVAS_NODE_TYPES.upload, { imageUrl: null }),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('upload', 'image', 'param:__image')])
    await expect(runCanvasNode('image')).rejects.toThrow('上游媒体节点没有可用输出')
    expect(rootRun).toHaveBeenCalledTimes(1)

    useCanvasStore.getState().setCanvasData([
      node('upload-placeholder', CANVAS_NODE_TYPES.universalUpload, { lockedMediaKind: 'image' }),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('upload-placeholder', 'image', 'param:__image')])
    await expect(runCanvasNode('image')).rejects.toThrow('上游媒体节点没有可用输出')
    expect(rootRun).toHaveBeenCalledTimes(1)
  })

  it('只有整条前驱链都确定复用时才跳过依赖静态预检', async () => {
    useCanvasStore.getState().setCanvasData([
      node('source', CANVAS_NODE_TYPES.imageEdit, { dependencyRunPolicy: 'always-run' }),
      node('middle', CANVAS_NODE_TYPES.imageEdit),
      node('root', CANVAS_NODE_TYPES.imageEdit),
    ], [
      edge('source', 'middle', 'param:__image'),
      edge('middle', 'root', 'param:__image'),
    ])
    let sourceRevision = 0
    const sourceRun = vi.fn(async () => {
      sourceRevision += 1
      useCanvasStore.getState().updateNodeData('source', { imageUrl: `source-${sourceRevision}.png` })
      return completed()
    })
    const middleRun = vi.fn(async () => completed())
    registerCanvasNodeExecutor('source', {
      kind: 'standard-generation',
      dependency: { mode: 'auto', outputMode: 'inline' },
      run: sourceRun,
    })
    registerCanvasNodeExecutor('middle', {
      kind: 'standard-generation',
      dependency: { mode: 'auto', outputMode: 'inline' },
      run: middleRun,
    })
    registerRoot('root')
    await runCanvasNode('root')

    registerCanvasNodeExecutor('middle', {
      kind: 'standard-generation',
      dependency: { mode: 'auto', outputMode: 'inline' },
      preflightBeforeDependencies: () => { throw new Error('中间节点缺少配置') },
      run: middleRun,
    })
    await expect(runCanvasNode('root')).rejects.toThrow('中间节点缺少配置')

    expect(sourceRun).toHaveBeenCalledTimes(1)
  })

  it('拒绝原始可达图中的循环依赖，并识别仅有展示节点的消费链', async () => {
    const nodes = [
      node('text', CANVAS_NODE_TYPES.textProcessing),
      node('display', CANVAS_NODE_TYPES.textAnnotation),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ]
    expect(hasReachableNonDisplayConsumer('text', nodes, [edge('text', 'display')])).toBe(false)
    useCanvasStore.getState().setCanvasData(nodes, [
      edge('text', 'display'),
      edge('display', 'image'),
      edge('image', 'text'),
    ])
    registerRoot('image')

    await expect(runCanvasNode('image')).rejects.toThrow('循环依赖')
    expect(useCanvasExecutionStateStore.getState().activeNodes).toEqual({})
  })
})
