import { describe, expect, it } from 'vitest'

import { GENERATION_APPLICATION_CAPABILITIES } from './generationApplicationCapabilities'

describe('生成能力 Effect Receipt', () => {
  it('提交任务的每项世界变化都携带完整稳定任务引用', () => {
    const capability = GENERATION_APPLICATION_CAPABILITIES.find(
      (candidate) => candidate.id === 'create_visible_generation_task'
    )
    if (!capability?.resolveObservedEffects) throw new Error('缺少生成任务 Effect resolver')

    const effects = capability.resolveObservedEffects(
      { modelId: 'kie-gpt-image-2', mediaType: 'image' },
      {
        taskId: 'task-effect-1', status: 'submitted', revision: 1,
        scopeRevisions: { generation: 1 }, resultReferences: { taskId: 'task-effect-1' },
      }
    )

    expect(effects).toHaveLength(2)
    expect(effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ effect: 'execute' }),
      expect.objectContaining({ effect: 'create' }),
    ]))
    for (const effect of effects) {
      expect(effect.targetRefs).toEqual([{ kind: 'generation.task', id: 'task-effect-1' }])
    }
  })
})
