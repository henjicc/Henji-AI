import { describe, expect, it } from 'vitest'

import {
  AGENT_MEMORY_SCHEMA_VERSION,
  agentMemoryRecordSchema,
  type AgentMemoryRecord,
  type AgentMemoryRetrievalQuery,
} from '../../../../src/core/assistant/memory'
import { scoreAgentMemory } from './memory-relevance'

function memory(overrides: Partial<AgentMemoryRecord>): AgentMemoryRecord {
  const now = new Date().toISOString()
  return agentMemoryRecordSchema.parse({
    schemaVersion: AGENT_MEMORY_SCHEMA_VERSION,
    memoryId: 'memory-1',
    scope: { type: 'global', id: null },
    kind: 'preference',
    content: '图片生成优先使用 KIE 供应商。',
    sourceRunId: 'run-1',
    sourceLabel: '用户确认',
    sensitivity: 'C0',
    status: 'active',
    conflictKey: 'image-provider',
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })
}

function query(overrides: Partial<AgentMemoryRetrievalQuery> = {}): AgentMemoryRetrievalQuery {
  return {
    goal: '制作一张产品海报',
    workspaceId: 'generation',
    projectId: 'project-1',
    intent: 'generate',
    toolDomains: ['models', 'generation'],
    stepSignals: [],
    limit: 6,
    ...overrides,
  }
}

describe('scoreAgentMemory', () => {
  it('生成任务会召回已确认供应商偏好并给出原因', () => {
    const result = scoreAgentMemory(memory({}), query())
    expect(result).toMatchObject({ layer: 'confirmed_preference' })
    expect(result?.score).toBeGreaterThan(0)
    expect(result?.reasons).toEqual(expect.arrayContaining([
      '全局作用域匹配',
      '已确认偏好与当前选择任务相关',
    ]))
  })

  it('项目知识只在对应项目召回', () => {
    const projectMemory = memory({
      scope: { type: 'project', id: 'project-1' },
      kind: 'fact',
      content: '本项目采用竖屏构图。',
      conflictKey: null,
    })
    expect(scoreAgentMemory(projectMemory, query({ intent: 'canvas' }))).toMatchObject({
      layer: 'project_knowledge',
    })
    expect(scoreAgentMemory(projectMemory, query({ projectId: 'project-2', intent: 'canvas' }))).toBeNull()
  })

  it('用户明确纠正比同条件旧偏好获得更高优先级', () => {
    const original = scoreAgentMemory(memory({ sourceLabel: '用户确认' }), query())
    const corrected = scoreAgentMemory(memory({ sourceLabel: '用户纠正' }), query())
    expect(corrected?.score).toBeGreaterThan(original?.score ?? 0)
    expect(corrected?.reasons).toContain('来源是用户较新的明确纠正')
  })
})
