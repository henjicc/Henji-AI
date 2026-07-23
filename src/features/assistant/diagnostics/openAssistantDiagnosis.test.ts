import { describe, expect, it } from 'vitest'

import { createAssistantDiagnosticGoal } from './openAssistantDiagnosis'

describe('createAssistantDiagnosticGoal', () => {
  it('携带关联字段并在 requestId 缺失时声明低置信度', () => {
    const goal = createAssistantDiagnosticGoal({
      title: '生成失败',
      message: '请求失败 token=secret C:\\private\\image.png',
      taskId: 'task-1',
      errorCode: 'GENERATION_FAILED',
      domain: 'core.services.GenerationService',
      occurredAt: '2026-07-23T00:15:00.000Z',
    })

    expect(goal).toContain('requestId：缺失')
    expect(goal).toContain('taskId：task-1')
    expect(goal).toContain('2026-07-23T00:00:00.000Z 至 2026-07-23T00:30:00.000Z')
    expect(goal).not.toContain('secret')
    expect(goal).not.toContain('C:\\private')
  })
})
