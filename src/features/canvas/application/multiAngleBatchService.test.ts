import { describe, expect, it } from 'vitest'

import { createDefaultMultiAngleConfig } from '../capabilities/multiAnglePolicy'
import { executeMultiAngleBatch } from './multiAngleBatchService'

describe('多角度批次执行服务', () => {
  it('默认 4 视图最多并发 2，结果仍保持计划顺序', async () => {
    let active = 0
    let maxActive = 0
    const result = await executeMultiAngleBatch({
      config: createDefaultMultiAngleConfig(),
      sourceImage: 'source.png',
      createBatchId: () => 'batch-4',
      execute: async (plan, context) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        context.onProviderRequestId(`req-${plan.order}`)
        await new Promise((resolve) => setTimeout(resolve, (4 - plan.order) * 2))
        active -= 1
        return { mediaUrl: `${plan.order}.png` }
      },
    })
    expect(maxActive).toBe(2)
    expect(result.complete).toBe(true)
    expect(result.completed.map((item) => item.mediaUrl)).toEqual(['0.png', '1.png', '2.png', '3.png'])
    expect(result.snapshot.items.every((item) => item.attempt === 1)).toBe(true)
  })

  it('支持 6 视图且仍固定并发 2', async () => {
    const config = createDefaultMultiAngleConfig()
    const extra = createDefaultMultiAngleConfig().views.slice(0, 2).map((view, index) => ({
      ...view,
      viewId: `extra-${index}`,
      label: `额外 ${index}`,
      ...(view.kind === 'continuous' ? { proximity: index + 1 } : {}),
    }))
    let active = 0
    let maxActive = 0
    const result = await executeMultiAngleBatch({
      config: { ...config, views: [...config.views, ...extra] },
      sourceImage: 'source.png',
      execute: async (plan, context) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        context.onProviderRequestId(`req-${plan.order}`)
        await Promise.resolve()
        active -= 1
        return { mediaUrl: `${plan.order}.png` }
      },
    })
    expect(result.snapshot.items).toHaveLength(6)
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(result.complete).toBe(true)
  })

  it('部分失败不产生完整输出，重试仅请求失败项并保留成功项', async () => {
    const firstCalls: number[] = []
    const first = await executeMultiAngleBatch({
      config: createDefaultMultiAngleConfig(),
      sourceImage: 'source.png',
      createBatchId: () => 'retry-batch',
      execute: async (plan, context) => {
        firstCalls.push(plan.order)
        context.onProviderRequestId(`req-${plan.order}-1`)
        if (plan.order === 2) throw new Error('供应商失败')
        return { mediaUrl: `${plan.order}.png` }
      },
    })
    expect(first.complete).toBe(false)
    expect(first.completed).toEqual([])
    expect(first.snapshot.items[2]).toMatchObject({ status: 'failed', attempt: 1 })

    const retryCalls: number[] = []
    const retry = await executeMultiAngleBatch({
      config: createDefaultMultiAngleConfig(),
      sourceImage: 'source.png',
      previous: first.snapshot,
      execute: async (plan, context) => {
        retryCalls.push(plan.order)
        context.onProviderRequestId(`req-${plan.order}-2`)
        return { mediaUrl: `${plan.order}-retry.png` }
      },
    })
    expect(firstCalls).toEqual([0, 1, 2, 3])
    expect(retryCalls).toEqual([2])
    expect(retry.complete).toBe(true)
    expect(retry.snapshot.items.map((item) => item.attempt)).toEqual([1, 1, 2, 1])
    expect(retry.completed.map((item) => item.mediaUrl)).toEqual(['0.png', '1.png', '2-retry.png', '3.png'])
  })

  it('来源图或视图计划改变时不复用旧成功项', async () => {
    const first = await executeMultiAngleBatch({
      config: createDefaultMultiAngleConfig(),
      sourceImage: 'source-a.png',
      createBatchId: () => 'old-batch',
      execute: async (plan, context) => {
        context.onProviderRequestId(`old-${plan.order}`)
        return { mediaUrl: `old-${plan.order}.png` }
      },
    })
    const calls: number[] = []
    const second = await executeMultiAngleBatch({
      config: createDefaultMultiAngleConfig(),
      sourceImage: 'source-b.png',
      previous: first.snapshot,
      createBatchId: () => 'new-batch',
      execute: async (plan, context) => {
        calls.push(plan.order)
        context.onProviderRequestId(`new-${plan.order}`)
        return { mediaUrl: `new-${plan.order}.png` }
      },
    })
    expect(second.snapshot.batchId).toBe('new-batch')
    expect(calls).toEqual([0, 1, 2, 3])
  })

  it('保存重开后恢复仍在供应商队列中的请求，不重复提交计费请求', async () => {
    const config = createDefaultMultiAngleConfig()
    const first = await executeMultiAngleBatch({
      config,
      sourceImage: 'source.png',
      createBatchId: () => 'resume-batch',
      execute: async (plan, context) => {
        context.onProviderRequestId(`status-url-${plan.order}`)
        return { mediaUrl: `${plan.order}.png` }
      },
    })
    const interrupted = {
      ...first.snapshot,
      items: first.snapshot.items.map((item, index) => index === 1
        ? { ...item, status: 'running' as const, mediaUrl: undefined }
        : item),
    }
    const resumed: Array<string | undefined> = []
    const result = await executeMultiAngleBatch({
      config,
      sourceImage: 'source.png',
      previous: interrupted,
      execute: async (plan, context) => {
        resumed.push(context.resumeProviderRequestId)
        return {
          mediaUrl: `${plan.order}-resumed.png`,
          providerRequestId: context.resumeProviderRequestId,
        }
      },
    })
    expect(resumed).toEqual(['status-url-1'])
    expect(result.complete).toBe(true)
    expect(result.snapshot.items[1]).toMatchObject({
      attempt: 2,
      providerRequestId: 'status-url-1',
      mediaUrl: '1-resumed.png',
    })
  })

  it('取消后不再启动后续视图，且结果不可提交', async () => {
    const controller = new AbortController()
    const cancelled: string[] = []
    let calls = 0
    const result = await executeMultiAngleBatch({
      config: createDefaultMultiAngleConfig(),
      sourceImage: 'source.png',
      signal: controller.signal,
      cancelTask: async (requestId) => { cancelled.push(requestId) },
      execute: async (plan, context) => {
        calls += 1
        context.onProviderRequestId(`req-${plan.order}`)
        controller.abort()
        await Promise.resolve()
        return { mediaUrl: `${plan.order}.png` }
      },
    })
    expect(calls).toBeLessThanOrEqual(2)
    expect(result.complete).toBe(false)
    expect(result.completed).toEqual([])
    expect(cancelled.length).toBeGreaterThan(0)
  })
})
