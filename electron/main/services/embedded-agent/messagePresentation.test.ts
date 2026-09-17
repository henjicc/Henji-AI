import { expect, it } from 'vitest'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { visibleMessages } from './messagePresentation'
import { PiAttachments } from './piAttachments'

it('同一正式历史包含思考、工具成功或失败以及最终回答，不泄露原始工具数据', () => {
  const assistant: Extract<AgentSession['messages'][number], { role: 'assistant' }> = {
    role: 'assistant', content: [{ type: 'thinking', thinking: '核对用户选择的图片。' }, { type: 'text', text: '正在读取。' },
      { type: 'toolCall', id: 'call', name: 'read_image', arguments: { secret: 'private-input' } }],
    api: 'openai-completions', provider: 'fixture', model: 'fixture', stopReason: 'toolUse', timestamp: 1,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }
  const history: AgentSession['messages'] = [assistant, { role: 'toolResult', toolCallId: 'call', toolName: 'read_image',
    content: [{ type: 'text', text: 'private-result' }], isError: true, timestamp: 2 },
    { ...assistant, content: [{ type: 'text', text: '请重新选择图片。' }], stopReason: 'stop' }]
  const result = visibleMessages(history, 'session', {} as PiAttachments, new Map([['read_image', '读取图片']]))
  expect(result.map(message => [message.kind, message.text])).toEqual([
    ['process', '核对用户选择的图片。'], ['process', '正在读取。'], ['tool', '读取图片'], ['answer', '请重新选择图片。'],
  ])
  expect(result[2].status).toBe('failed')
  expect(JSON.stringify(result)).not.toContain('private')
})
