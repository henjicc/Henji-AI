import { expect, it } from 'vitest'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { deduplicateHostContexts, prepareHostContext } from './hostContext'
import { budgetContext } from './contextBudget'

type Message = AgentSession['messages'][number]
const raw = (frame: number, summary = '风格原文'.repeat(1500)) => JSON.stringify({ capturedAt: `time-${frame}`, surface: { id: 'workspace.video_edit' }, videoEdit: { frame, currentStyleKit: { summary } } })
function message(value: NonNullable<ReturnType<typeof prepareHostContext>>): Extract<Message, { role: 'custom' }> {
  return { role: 'custom', customType: 'henji-context', ...value, display: false, timestamp: 0 }
}

it('忽略采集时间及选区采集时间，保留帧/选区变化；原文只在新消息构造时去重', () => {
  const selection = { capturedAt: 'first', selectedRefs: ['clip:a'] }
  const first = message(prepareHostContext(raw(0), [], selection, '')!)
  const history = [first]
  expect(prepareHostContext(raw(0).replace('time-0', 'new-time'), history, { ...selection, capturedAt: 'second' }, '')).toBeUndefined()
  const next = message(prepareHostContext(raw(1), history, selection, '')!)
  expect(next.content).toContain('风格说明书与前文相同（未改动）')
  expect(first.content).toContain('风格原文'.repeat(1500))
  expect(next.content).toContain('video-edit-code-creation、video-edit-workbench 当前界面相关')
  expect(prepareHostContext(raw(1), [first, next], { ...selection, selectedRefs: ['clip:b'] }, '')).toBeDefined()
  expect(prepareHostContext(raw(2, '新风格'), [first, next], selection, '')!.content).toContain('新风格')
  expect(prepareHostContext(raw(1), [], selection, '')!.content).toContain('风格原文')
  expect(deduplicateHostContexts([first, { ...first }, next])).toEqual([first, next])
})

it('预算不足淘汰旧宿主消息，最新快照恢复完整风格，原始历史不变', () => {
  const first = message(prepareHostContext(JSON.stringify({ ...JSON.parse(raw(0)), oldNote: '旧内容'.repeat(1000) }), [], undefined, '')!)
  const next = message(prepareHostContext(raw(1), [first], undefined, '')!)
  const messages: Message[] = [first, { role: 'user', content: '继续', timestamp: 0 }, next]
  const result = budgetContext(messages, { contextWindow: 9000, maxOutputTokens: 1024, instructions: '', tools: [] })
  expect(result.filter(item => item.role === 'custom')).toHaveLength(1)
  expect(result.at(-1)).toMatchObject({ content: expect.stringContaining('风格原文'.repeat(1500)) })
  expect(result.at(-1)).toMatchObject({ content: expect.stringContaining('"frame":1') })
  expect(next.content).toContain('未改动')
  expect(() => budgetContext(messages, { contextWindow: 2000, maxOutputTokens: 1024, instructions: '', tools: [] })).toThrow('上下文预算')
})
