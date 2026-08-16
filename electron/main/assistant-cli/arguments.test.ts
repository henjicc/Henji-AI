import { describe, expect, it } from 'vitest'

import { parseAssistantCliArguments } from './arguments'

describe('parseAssistantCliArguments', () => {
  it('解析运行所需参数和可选项', () => {
    expect(parseAssistantCliArguments([
      '.', '--assistant-cli', '--goal', '生成一只小猫', '--approval', 'full_access',
      '--trace', 'detailed', '--print-trace', '--await-generation', '--timeout', '120000', '--thread', 'cli-test',
      '--visible', '--require-verified-write',
    ])).toEqual({
      goal: '生成一只小猫',
      approvalMode: 'full_access',
      captureMode: 'detailed',
      printTrace: true,
      awaitGeneration: true,
      visible: true,
      requireVerifiedWrite: true,
      timeoutMs: 120000,
      threadId: 'cli-test',
    })
  })

  it('拒绝缺少目标和未知参数', () => {
    expect(() => parseAssistantCliArguments(['.', '--assistant-cli'])).toThrow('参数 --goal 不能为空')
    expect(() => parseAssistantCliArguments(['.', '--assistant-cli', '--goal', '测试', '--unknown'])).toThrow('不支持的参数')
  })
})
