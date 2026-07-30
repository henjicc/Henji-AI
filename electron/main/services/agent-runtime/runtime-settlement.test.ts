import { describe, expect, it, vi } from 'vitest'

import type { AgentRunState } from '../../../../src/core/assistant/events'
import type { AgentPersistenceStore } from './persistence/store'
import { settleRuntimeRun } from './runtime-settlement'

describe('runtime settled cleanup', () => {
  it('100 次短 run 后清空 live map 与订阅表', () => {
    const persistence = {
      saveState: vi.fn(), appendTerminalMessage: vi.fn(), appendSettledSavePoint: vi.fn(),
    } as unknown as AgentPersistenceStore
    const activeByThread = new Map<string, string>()
    const eventListeners = new Map<string, Set<() => void>>()
    const runs = new Map<string, { threadId: string }>()
    for (let index = 0; index < 100; index += 1) {
      const runId = `run-${index}`
      const threadId = `thread-${index}`
      const record = { threadId }
      runs.set(runId, record)
      activeByThread.set(threadId, runId)
      eventListeners.set(runId, new Set())
      settleRuntimeRun({
        runId, state: { runId } as AgentRunState, record, persistence,
        activeByThread, eventListeners, runs,
      })
    }
    expect(runs.size).toBe(0)
    expect(activeByThread.size).toBe(0)
    expect(eventListeners.size).toBe(0)
    expect(persistence.appendSettledSavePoint).toHaveBeenCalledTimes(100)
  })
})
