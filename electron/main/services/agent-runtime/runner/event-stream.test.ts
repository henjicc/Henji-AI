import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentEvent } from '../../../../../src/core/assistant/events'
import { AgentEventStream } from './event-stream'

describe('AgentEventStream', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('在分配 sequence 前合并一万个原始文本增量并保持耐久事件连续', () => {
    const stream = new AgentEventStream('run-1')
    const events: AgentEvent[] = []
    stream.subscribe((event) => events.push(event))

    for (let index = 0; index < 10_000; index += 1) {
      stream.emit({ type: 'ModelDelta', stepId: 'step-1', text: String(index % 10) })
    }
    stream.emit({
      type: 'ModelCompleted',
      stepId: 'step-1',
      finishReason: 'stop',
      toolCallCount: 0,
      usage: {
        inputTokens: 1,
        inputNoCacheTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 10_000,
        textTokens: 10_000,
        reasoningTokens: 0,
        totalTokens: 10_001,
      },
    })

    const deltas = events.filter((event): event is Extract<AgentEvent, { type: 'ModelDelta' }> => (
      event.type === 'ModelDelta'
    ))
    expect(deltas.length).toBeLessThan(10)
    expect(deltas.map((event) => event.text).join('')).toBe(
      Array.from({ length: 10_000 }, (_, index) => String(index % 10)).join('')
    )
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1)
    )
    expect(events.at(-1)?.type).toBe('ModelCompleted')
  })

  it('聚合窗口达到最小分片数后及时发布，单个慢片段留到边界刷新', () => {
    vi.useFakeTimers()
    const stream = new AgentEventStream('run-1', {
      deltaFlushIntervalMs: 50,
      deltaMaxLatencyMs: 120,
      deltaMinFragments: 2,
    })
    const events: AgentEvent[] = []
    stream.subscribe((event) => events.push(event))

    stream.emit({ type: 'ModelDelta', stepId: 'step-1', text: '你' })
    vi.advanceTimersByTime(50)
    expect(events).toEqual([])
    vi.advanceTimersByTime(70)
    expect(events).toEqual([expect.objectContaining({
      type: 'ModelDelta',
      sequence: 1,
      text: '你',
    })])

    stream.emit({ type: 'ModelDelta', stepId: 'step-1', text: '好' })
    stream.emit({ type: 'ModelDelta', stepId: 'step-1', text: '。' })
    stream.emit({
      type: 'RunStateChanged',
      previous: 'running',
      current: 'completed',
    })
    expect(events.slice(-2)).toEqual([
      expect.objectContaining({ type: 'ModelDelta', sequence: 2, text: '好。' }),
      expect.objectContaining({ type: 'RunStateChanged', sequence: 3 }),
    ])
  })

  it('达到最小分片数后从最大延迟重排到低延迟窗口', () => {
    vi.useFakeTimers()
    const stream = new AgentEventStream('run-1', {
      deltaFlushIntervalMs: 50,
      deltaMaxLatencyMs: 200,
      deltaMinFragments: 2,
    })
    const events: AgentEvent[] = []
    stream.subscribe((event) => events.push(event))

    stream.emit({ type: 'ModelDelta', stepId: 'step-1', text: 'A' })
    vi.advanceTimersByTime(10)
    stream.emit({ type: 'ModelDelta', stepId: 'step-1', text: 'B' })
    vi.advanceTimersByTime(39)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toEqual([expect.objectContaining({ type: 'ModelDelta', text: 'AB' })])
  })

  it('定时刷新监听器异常通过受控通道上报而不逃逸', () => {
    vi.useFakeTimers()
    const onDispatchError = vi.fn()
    const stream = new AgentEventStream('run-1', {
      deltaFlushIntervalMs: 50,
      deltaMaxLatencyMs: 100,
      deltaMinFragments: 2,
      onDispatchError,
    })
    stream.subscribe(() => {
      throw new Error('持久化暂时不可用')
    })

    stream.emit({ type: 'ModelDelta', stepId: 'step-1', text: 'A' })
    expect(() => vi.advanceTimersByTime(100)).not.toThrow()
    expect(onDispatchError).toHaveBeenCalledWith(expect.objectContaining({
      message: '持久化暂时不可用',
    }))
  })

  it('同步边界事件的接收端异常同样受控上报', () => {
    const onDispatchError = vi.fn()
    const stream = new AgentEventStream('run-1', { onDispatchError })
    stream.subscribe(() => {
      throw new Error('事件接收端持续失败')
    })

    expect(() => stream.emit({
      type: 'RunStarted',
      threadId: 'thread-1',
    })).not.toThrow()
    expect(onDispatchError).toHaveBeenCalledWith(expect.objectContaining({
      message: '事件接收端持续失败',
    }))
  })
})
