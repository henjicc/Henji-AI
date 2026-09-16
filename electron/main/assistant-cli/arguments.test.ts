import { describe, expect, it } from 'vitest'

import { parseAssistantCliArguments } from './arguments'

describe('parseAssistantCliArguments', () => {
  it('仅保留 Pi 入口，拒绝旧执行链选项', () => {
    expect(parseAssistantCliArguments(['--assistant-cli', '--goal', '读取当前项目'])).toMatchObject({ approvalMode: 'assistant_decides' })
    for (const flag of ['--engine', '--require-verified-write']) {
      expect(() => parseAssistantCliArguments(['--assistant-cli', '--goal', '读取', flag])).toThrow('不支持的参数')
    }
  })
  it('解析运行所需参数和可选项', () => {
    expect(parseAssistantCliArguments([
      '.', '--assistant-cli', '--goal', '生成一只小猫', '--approval', 'full_access',
      '--trace', 'detailed', '--timeout', '120000', '--thread', 'cli-test',
      '--visible',
    ])).toEqual({
      goal: '生成一只小猫',
      approvalMode: 'full_access',
      captureMode: 'detailed',
      visible: true,
      timeoutMs: 120000,
      threadId: 'cli-test',
    })
  })

  it('拒绝缺少目标和未知参数', () => {
    expect(() => parseAssistantCliArguments(['.', '--assistant-cli'])).toThrow('参数 --goal 不能为空')
    expect(() => parseAssistantCliArguments(['.', '--assistant-cli', '--goal', '测试', '--unknown'])).toThrow('不支持的参数')
  })
})
