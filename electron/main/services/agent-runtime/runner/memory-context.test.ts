import { describe, expect, it, vi } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentMemoryRetrievalResult } from '../../../../../src/core/assistant/memory'
import { createAgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { AgentRouteDecision } from '../context/types'
import { AgentMemoryContextProvider } from './memory-context'

function snapshot(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-memory',
    revision: 1,
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: 'project-1', selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: [],
    capturedAt: new Date().toISOString(),
  }
}

const route: AgentRouteDecision = {
  intent: 'generate',
  toolDomains: ['models', 'generation'],
  reason: '生成任务',
  explicitUserIntent: true,
}

function result(): AgentMemoryRetrievalResult {
  const now = new Date().toISOString()
  return {
    entries: [{
      memoryId: 'memory-1',
      scope: { type: 'global', id: null },
      kind: 'preference',
      content: '优先使用 KIE。',
      sourceLabel: '用户确认',
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      layer: 'confirmed_preference',
      score: 24,
      retrievalReasons: ['已确认偏好与当前选择任务相关'],
    }],
    consideredCount: 1,
    excludedCount: 0,
    truncated: false,
    exclusionReasons: [],
    retrievedAt: now,
  }
}

describe('AgentMemoryContextProvider', () => {
  it('计划步骤变化时重新召回，未变化时复用结果', async () => {
    const retrieve = vi.fn().mockResolvedValue(result())
    const provider = new AgentMemoryContextProvider('run-memory', [], retrieve)
    const summary = createAgentWorkingSummary('生成图片')
    const input = {
      goal: '生成图片', snapshot: snapshot(), route, summary,
      signal: new AbortController().signal,
    }
    await provider.retrieve(input)
    await provider.retrieve(input)
    const changed = {
      ...summary,
      completedSteps: [{
        stepId: 'call-1', title: '搜索模型', status: 'completed' as const,
        toolName: 'search_models', toolCategory: 'models', readOnly: true, idempotent: true,
        summary: '已搜索', evidence: [], startedAt: summary.updatedAt, completedAt: summary.updatedAt,
      }],
    }
    await provider.retrieve({ ...input, summary: changed })

    expect(retrieve).toHaveBeenCalledTimes(2)
    expect(retrieve.mock.calls[0][0]).toMatchObject({
      workspaceId: 'generation', projectId: 'project-1', intent: 'generate',
    })
    expect(retrieve.mock.calls[1][0].stepSignals).toContain('search_models')
  })

  it('召回异常时使用上次安全结果继续运行', async () => {
    const retrieve = vi.fn()
      .mockResolvedValueOnce(result())
      .mockRejectedValueOnce(new Error('数据库暂时不可用'))
    const provider = new AgentMemoryContextProvider('run-memory-fallback', [], retrieve)
    const base = {
      goal: '生成图片', snapshot: snapshot(), route,
      summary: createAgentWorkingSummary('生成图片'),
      signal: new AbortController().signal,
    }
    const first = await provider.retrieve(base)
    const second = await provider.retrieve({
      ...base,
      summary: {
        ...base.summary,
        recovery: {
          mode: 'resume_read_only',
          reason: '刷新模型状态',
          toolName: 'search_models',
          toolCategory: 'models',
        },
      },
    })
    expect(second).toEqual(first)
  })
})


