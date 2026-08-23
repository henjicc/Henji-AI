import { describe, expect, it } from 'vitest'

import { buildResultNodeTitle, resolveGenerationPromptInput } from './generationNodeGuards'

describe('generationNodeGuards', () => {
  it('来源任务 ID 可以代替提示词构成生成输入', () => {
    expect(resolveGenerationPromptInput(
      { alternativeInputParamIds: ['sourceTaskId'] },
      { sourceTaskId: 'task-1' },
      '',
      undefined
    )).toEqual({ prompt: '', hasValidInput: true })
  })

  it('上游提示词覆盖本地提示词，空输入仍会被拒绝', () => {
    expect(resolveGenerationPromptInput(undefined, {}, 'local prompt', 'upstream prompt'))
      .toEqual({ prompt: 'upstream prompt', hasValidInput: true })
    expect(resolveGenerationPromptInput(undefined, {}, '', undefined).hasValidInput).toBe(false)
  })

  it('空提示词的结果节点使用回退标题', () => {
    expect(buildResultNodeTitle('', '生成结果')).toBe('生成结果')
  })
})
