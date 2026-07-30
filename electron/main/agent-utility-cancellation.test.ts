import { describe, expect, it, vi } from 'vitest'

import type { AgentRunState } from '../../src/core/assistant/events'
import {
  cancelUtilityRun,
  prepareUtilityShutdown,
  type AgentUtilityCancellableRunner,
} from './agent-utility-cancellation'

function cancelledState(runId: string): AgentRunState {
  return { runId, status: 'cancelled' } as AgentRunState
}

function delayedRunner(runId: string): {
  runner: AgentUtilityCancellableRunner
  release: () => void
  started: Promise<void>
} {
  let release: () => void = () => undefined
  let markStarted: () => void = () => undefined
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  return {
    runner: {
      cancelAndWait: vi.fn(async () => {
        markStarted()
        await gate
        return cancelledState(runId)
      }),
    },
    release,
    started,
  }
}

describe('agent utility cancellation', () => {
  it('run.cancel 命令路径等待 Runner 终止审计后才返回', async () => {
    const delayed = delayedRunner('run-command-cancel')
    let settled = false
    const command = cancelUtilityRun(delayed.runner, '用户取消').then((state) => {
      settled = true
      return state
    })

    await delayed.started
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(delayed.runner.cancelAndWait).toHaveBeenCalledWith('用户取消')

    delayed.release()
    await expect(command).resolves.toMatchObject({
      runId: 'run-command-cancel',
      status: 'cancelled',
    })
  })

  it('process.shutdown 等待所有 Runner 尽力完成终止审计', async () => {
    const first = delayedRunner('run-shutdown-1')
    const second = delayedRunner('run-shutdown-2')
    let settled = false
    const shutdown = prepareUtilityShutdown([first.runner, second.runner]).then(() => {
      settled = true
    })

    await Promise.all([first.started, second.started])
    first.release()
    await Promise.resolve()
    expect(settled).toBe(false)

    second.release()
    await shutdown
    expect(settled).toBe(true)
    expect(first.runner.cancelAndWait).toHaveBeenCalledWith('应用正在退出')
    expect(second.runner.cancelAndWait).toHaveBeenCalledWith('应用正在退出')
  })
})
