import { describe, expect, it } from 'vitest'

import { releaseUtilityRun } from './agent-utility-control'
import type { AgentRunner } from './services/agent-runtime/runner/runner'

describe('utility settled cleanup', () => {
  it('100 次短 run 释放后不保留 Runner、host context 或模型请求', () => {
    const runners = new Map<string, AgentRunner>()
    const hostContexts = new Map<string, unknown>()
    const activeModelSteps = new Map<string, AbortController>()
    for (let index = 0; index < 100; index += 1) {
      const runId = `run-${index}`
      runners.set(runId, {} as AgentRunner)
      hostContexts.set(runId, {})
      activeModelSteps.set(`${runId}:step-1`, new AbortController())
      expect(releaseUtilityRun(runId, { runners, hostContexts, activeModelSteps })).toBe(true)
    }
    expect(runners.size).toBe(0)
    expect(hostContexts.size).toBe(0)
    expect(activeModelSteps.size).toBe(0)
  })
})
