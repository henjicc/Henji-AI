// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useAutoResumePolling } from './useAutoResumePolling'
import type { GenerationTask } from '../types'

function task(overrides: Partial<GenerationTask>): GenerationTask {
  return {
    id: 'task', prompt: '提示词', model: 'kie-z-image', type: 'image',
    status: 'generating', createdAt: Date.now(), ...overrides,
  } as GenerationTask
}

function run(tasks: GenerationTask[]) {
  // 替身必须带上参数签名：`vi.fn(async () => {})` 的 calls 是长度 0 的元组，
  // 解构 [value] 在 tsc 下直接报错，而 vitest 单跑不做类型检查，会一路绿到 CI 才红。
  const handleContinuePolling = vi.fn(async (_task: GenerationTask) => {})
  const settleUnresumableTask = vi.fn((_task: GenerationTask) => {})
  renderHook(() => useAutoResumePolling({ tasks, isTasksLoaded: true, handleContinuePolling, settleUnresumableTask }))
  return {
    resumed: handleContinuePolling.mock.calls.map(([value]) => value.id),
    settled: settleUnresumableTask.mock.calls.map(([value]) => value.id),
  }
}

describe('应用重启后的生成任务收敛', () => {
  /*
   * 这条盯的是一个真机上出现过的状态：提交已经发出、供应商任务号还没回来就被强杀，
   * 那条记录会永远停在"生成中"——既没有结果也没有错误，跨重启也不会变。
   */
  it('一个任务号都找不到的运行态任务收敛成失败，不会留在生成中', () => {
    const { resumed, settled } = run([task({ id: '无任务号', serverTaskId: undefined })])
    expect(resumed).toEqual([])
    expect(settled).toEqual(['无任务号'])
  })

  it('任务号只留在错误文本或结果元数据里时照样自动续查，与手动继续轮询同一口径', () => {
    const { resumed, settled } = run([
      task({ id: '错误文本里有', result: undefined, serverTaskId: undefined, error: '供应商返回失败 task_id=provider-77' }),
      task({ id: '直接带号', serverTaskId: 'provider-1' }),
    ])
    expect(resumed.sort()).toEqual(['直接带号', '错误文本里有'])
    expect(settled).toEqual([])
  })

  it('已出结果或已终态的任务一律不动', () => {
    const { resumed, settled } = run([
      task({ id: '已成功', status: 'success' }),
      task({ id: '已失败', status: 'error', error: '供应商拒绝' }),
      task({ id: '有结果', status: 'generating', result: 'file:///done.png' as never }),
    ])
    expect(resumed).toEqual([])
    expect(settled).toEqual([])
  })

  it('画布任务由原工程核对恢复，不按生成页快照收敛或抢占续查', () => {
    const options = { __canvasGeneration: { version: 2, projectId: 'background-b', nodeId: 'source' } }
    const { resumed, settled } = run([
      task({ id: '任务号保存在画布节点', options }),
      task({ id: '历史也有任务号', options, serverTaskId: 'server-b' }),
      task({ id: '生成页自己的任务', serverTaskId: 'server-workspace' }),
    ])
    expect(resumed).toEqual(['生成页自己的任务'])
    expect(settled).toEqual([])
  })

  it('历史尚未加载完成时什么都不做，避免把在途任务误判成中断', () => {
    const handleContinuePolling = vi.fn(async (_task: GenerationTask) => {})
    const settleUnresumableTask = vi.fn((_task: GenerationTask) => {})
    renderHook(() => useAutoResumePolling({
      tasks: [task({ id: '未加载', serverTaskId: undefined })],
      isTasksLoaded: false, handleContinuePolling, settleUnresumableTask,
    }))
    expect(handleContinuePolling).not.toHaveBeenCalled()
    expect(settleUnresumableTask).not.toHaveBeenCalled()
  })
})
