// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCanvasStore } from '@/stores/canvasStore'
import { useCanvasExecutionStateStore } from '@/stores/canvasExecutionStateStore'
import { collectInputMedia } from './graphMediaResolver'
import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
} from '../domain/canvasNodes'
import {
  hasReachableNonDisplayConsumer,
  isCanvasNodeInputSignatureCurrent,
  registerCanvasNodeExecutor,
  resetCanvasExecutionServiceForTests,
  runCanvasNode,
  type CanvasNodeExecutionResult,
} from './canvasExecutionService'
import { createCanvasExecutionValueSignature } from './canvasExecutionCache'
import { isAuthoritativeIncomingSource } from '../domain/connectionIndex'

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

describe('canvasExecutionService', () => {
  beforeEach(() => {
    resetCanvasExecutionServiceForTests()
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  })

  it('按执行器的运行时契约校验跨进程任务签名而不是退化为节点 data', async () => {
    useCanvasStore.getState().setCanvasData([
      node('image', CANVAS_NODE_TYPES.imageEdit, { prompt: '节点里的旧文本不参与运行时签名' }),
    ], [])
    let runtime = { prompt: '雪山', images: ['/managed/source.png'] }
    registerCanvasNodeExecutor('image', {
      kind: 'standard-generation',
      inputSignatureScope: 'runtime',
      getInputSignatureExtras: () => runtime,
      run: async () => completed(),
    })
    const expected = createCanvasExecutionValueSignature({
      contractVersion: 1,
      nodeType: CANVAS_NODE_TYPES.imageEdit,
      executionKind: 'standard-generation',
      runtime,
    })

    await expect(isCanvasNodeInputSignatureCurrent('image', expected)).resolves.toBe(true)
    runtime = { prompt: '海边', images: ['/managed/source.png'] }
    await expect(isCanvasNodeInputSignatureCurrent('image', expected)).resolves.toBe(false)
  })

  it('先完成透明展示节点后的上游，再对最新图状态执行目标预检', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing, { prompt: '改写' }),
      node('display', CANVAS_NODE_TYPES.textAnnotation, { content: '' }),
      node('image', CANVAS_NODE_TYPES.imageEdit, { prompt: '' }),
    ], [edge('text', 'display'), edge('display', 'image')])
    const order: string[] = []
    registerText('text', async () => {
      order.push('text')
      useCanvasStore.getState().updateNodeData('display', { content: '最新提示词' }, { skipHistory: true })
      return completed()
    })
    registerCanvasNodeExecutor('image', {
      kind: 'standard-generation',
      preflight: () => {
        const display = useCanvasStore.getState().nodes.find((item) => item.id === 'display')
        order.push(`preflight:${String(display?.data.content)}`)
      },
      run: async () => {
        order.push('image')
        return completed()
      },
    })

    await expect(runCanvasNode('image')).resolves.toMatchObject({
      executedNodeIds: ['text', 'image'],
    })
    expect(order).toEqual(['text', 'preflight:最新提示词', 'image'])
    expect(hasReachableNonDisplayConsumer(
      'text', useCanvasStore.getState().nodes, useCanvasStore.getState().edges,
    )).toBe(true)
  })

  it('旧图多文本上游的完成顺序反转时仍只消费最后一条权威边', async () => {
    const runScenario = async (authoritativeFinishesFirst: boolean): Promise<string> => {
      resetCanvasExecutionServiceForTests()
      useCanvasStore.getState().setCanvasData([
        node('text-a', CANVAS_NODE_TYPES.textProcessing, { prompt: 'A' }),
        node('text-b', CANVAS_NODE_TYPES.textProcessing, { prompt: 'B' }),
        node('display', CANVAS_NODE_TYPES.textAnnotation, { content: '' }),
        node('root', CANVAS_NODE_TYPES.imageEdit),
      ], [
        edge('text-a', 'display', 'target'),
        edge('text-b', 'display', 'target'),
        edge('text-a', 'root'),
        edge('display', 'root'),
      ])

      let releaseA: (() => void) | undefined
      let releaseB: (() => void) | undefined
      const gateA = new Promise<void>((resolve) => { releaseA = resolve })
      const gateB = new Promise<void>((resolve) => { releaseB = resolve })
      const writeIfAuthoritative = (sourceNodeId: string, content: string): void => {
        const snapshot = useCanvasStore.getState()
        if (isAuthoritativeIncomingSource(snapshot.edges, 'display', sourceNodeId)) {
          snapshot.updateNodeData('display', { content }, { skipHistory: true })
        }
      }
      registerText('text-a', async () => {
        await gateA
        writeIfAuthoritative('text-a', 'A')
        return completed()
      })
      registerText('text-b', async () => {
        await gateB
        writeIfAuthoritative('text-b', 'B')
        return completed()
      })
      let consumed = ''
      registerRoot('root', async () => {
        consumed = String(useCanvasStore.getState().nodes.find((item) => item.id === 'display')?.data.content ?? '')
        return completed()
      })

      const running = runCanvasNode('root')
      await vi.waitFor(() => {
        const active = useCanvasExecutionStateStore.getState().activeNodes
        expect(active['text-a']).toBeDefined()
        expect(active['text-b']).toBeDefined()
      })
      if (authoritativeFinishesFirst) {
        releaseB?.()
        await vi.waitFor(() => expect(
          useCanvasExecutionStateStore.getState().activeNodes['text-b'],
        ).toBeUndefined())
        releaseA?.()
      } else {
        releaseA?.()
        await vi.waitFor(() => expect(
          useCanvasExecutionStateStore.getState().activeNodes['text-a'],
        ).toBeUndefined())
        releaseB?.()
      }
      await running
      return consumed
    }

    await expect(runScenario(true)).resolves.toBe('B')
    await expect(runScenario(false)).resolves.toBe('B')

    const reachabilityNodes = [
      node('text-a', CANVAS_NODE_TYPES.textProcessing),
      node('text-b', CANVAS_NODE_TYPES.textProcessing),
      node('display', CANVAS_NODE_TYPES.textAnnotation),
      node('root', CANVAS_NODE_TYPES.imageEdit),
    ]
    const reachabilityEdges = [
      edge('text-a', 'display', 'target'),
      edge('text-b', 'display', 'target'),
      edge('display', 'root'),
    ]
    expect(hasReachableNonDisplayConsumer('text-a', reachabilityNodes, reachabilityEdges)).toBe(false)
    expect(hasReachableNonDisplayConsumer('text-b', reachabilityNodes, reachabilityEdges)).toBe(true)
  })

  it('上传与结果节点是已有值边界，不继续追溯其上游配方', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing),
      node('result', CANVAS_NODE_TYPES.exportImage, { imageUrl: 'result.png', aspectRatio: '1:1' }),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text', 'result'), edge('result', 'image', 'param:__image')])
    const textRun = vi.fn(async () => completed())
    registerText('text', textRun)
    registerRoot('image')

    await runCanvasNode('image')

    expect(textRun).not.toHaveBeenCalled()
  })

  it('生成节点直连下游时自动运行，并用稳定结果引用发布媒体', async () => {
    useCanvasStore.getState().setCanvasData([
      node('generator', CANVAS_NODE_TYPES.imageEdit, { prompt: '猫' }),
      node('target', CANVAS_NODE_TYPES.imageEdit, { prompt: '动画化' }),
    ], [edge('generator', 'target', 'param:__image')])
    const generatorRun = vi.fn(async () => {
      const resultNodeId = useCanvasStore.getState().addNode(
        CANVAS_NODE_TYPES.exportImage,
        { x: 100, y: 0 },
        {
          imageUrl: 'generated.png',
          aspectRatio: '1:1',
          isGenerating: false,
          generationSourceNodeId: 'generator',
          generationOutputCommitId: 'generator-commit',
          generationOutputDescriptor: { outputId: 'output-1', order: 0 },
        },
      )
      return completed([resultNodeId])
    })
    registerCanvasNodeExecutor('generator', {
      kind: 'standard-generation',
      dependency: { mode: 'auto', outputMode: 'result-nodes' },
      run: generatorRun,
    })
    let receivedUrls: string[] = []
    registerRoot('target', async () => {
      const canvas = useCanvasStore.getState()
      receivedUrls = collectInputMedia('target', canvas.nodes, canvas.edges).map((item) => item.url)
      return completed()
    })

    await runCanvasNode('target')

    expect(receivedUrls).toEqual(['generated.png'])
    expect(useCanvasStore.getState().nodes.find((item) => item.id === 'generator')?.data.latestExecution)
      .toMatchObject({ outputMode: 'result-nodes' })

    await runCanvasNode('target')
    expect(generatorRun).toHaveBeenCalledTimes(1)
    const current = useCanvasStore.getState()
    current.setCanvasData(
      current.nodes.filter((item) => item.type !== CANVAS_NODE_TYPES.exportImage),
      current.edges,
      current.history,
    )
    await runCanvasNode('target')
    expect(generatorRun).toHaveBeenCalledTimes(2)
  })

  it('依赖输入未变且结果有效时复用；输入变化后重新运行', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing, { prompt: 'A' }),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text', 'image')])
    const upstreamRun = vi.fn(async () => completed())
    registerText('text', upstreamRun)
    registerRoot('image')

    await runCanvasNode('image')
    await expect(runCanvasNode('image')).resolves.toMatchObject({ reusedNodeIds: ['text'] })
    useCanvasStore.getState().updateNodeData('text', { prompt: 'B' })
    await runCanvasNode('image')

    expect(upstreamRun).toHaveBeenCalledTimes(2)
  })

  it('兼容 fixedResult=false：依赖每次都重新运行', async () => {
    useCanvasStore.getState().setCanvasData([
      node('text', CANVAS_NODE_TYPES.textProcessing, { prompt: 'A', fixedResult: false }),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('text', 'image')])
    const upstreamRun = vi.fn(async () => completed())
    registerText('text', upstreamRun)
    registerRoot('image')

    await runCanvasNode('image')
    await runCanvasNode('image')

    expect(upstreamRun).toHaveBeenCalledTimes(2)
  })

  it('独立依赖分支并行运行，目标严格等待全部完成', async () => {
    useCanvasStore.getState().setCanvasData([
      node('left', CANVAS_NODE_TYPES.textProcessing),
      node('right', CANVAS_NODE_TYPES.textProcessing),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('left', 'image'), edge('right', 'image')])
    let releaseLeft: (() => void) | undefined
    let releaseRight: (() => void) | undefined
    const leftGate = new Promise<void>((resolve) => { releaseLeft = resolve })
    const rightGate = new Promise<void>((resolve) => { releaseRight = resolve })
    const rootRun = vi.fn(async () => completed())
    registerText('left', async () => { await leftGate; return completed() })
    registerText('right', async () => { await rightGate; return completed() })
    registerRoot('image', rootRun)

    const running = runCanvasNode('image')
    await vi.waitFor(() => expect(useCanvasExecutionStateStore.getState().activeNodes).toMatchObject({
      left: { phase: 'processing' },
      right: { phase: 'processing' },
    }))
    expect(rootRun).not.toHaveBeenCalled()
    releaseLeft?.()
    await Promise.resolve()
    expect(rootRun).not.toHaveBeenCalled()
    releaseRight?.()
    await running
    expect(rootRun).toHaveBeenCalledTimes(1)
  })

  it('已完成上游在等待并行分支时被修改，不让目标消费旧结果', async () => {
    useCanvasStore.getState().setCanvasData([
      node('fast', CANVAS_NODE_TYPES.textProcessing, { prompt: 'A' }),
      node('slow', CANVAS_NODE_TYPES.textProcessing),
      node('image', CANVAS_NODE_TYPES.imageEdit),
    ], [edge('fast', 'image'), edge('slow', 'image')])
    let releaseSlow: (() => void) | undefined
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve })
    const rootRun = vi.fn(async () => completed())
    registerText('fast', async () => completed())
    registerText('slow', async () => { await slowGate; return completed() })
    registerRoot('image', rootRun)

    const running = runCanvasNode('image')
    await vi.waitFor(() => expect(
      useCanvasStore.getState().nodes.find((item) => item.id === 'fast')?.data.latestExecution,
    ).toBeDefined())
    useCanvasStore.getState().updateNodeData('fast', { prompt: 'B' })
    releaseSlow?.()

    await expect(running).rejects.toThrow('上游节点输入已变化')
    expect(rootRun).not.toHaveBeenCalled()
  })

  it('生成分支最多并发两个，释放名额后再启动下一支', async () => {
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
    const started: string[] = []
    const releases = new Map<string, () => void>()
    for (const nodeId of ['generator-a', 'generator-b', 'generator-c']) {
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
    registerRoot('target')

    const running = runCanvasNode('target')
    await vi.waitFor(() => expect(started).toHaveLength(2))
    expect(started).toEqual(['generator-a', 'generator-b'])
    releases.get('generator-a')?.()
    await vi.waitFor(() => expect(started).toHaveLength(3))
    releases.get('generator-b')?.()
    releases.get('generator-c')?.()
    await running
  })

})
