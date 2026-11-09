import { expect, it } from 'vitest'
import { SessionManager, type AgentSession } from '@earendil-works/pi-coding-agent'
import { archiveToolResult, contextReader } from './contextReader'
import { budgetContext, estimateContextTokens, messageTokens, projectText } from './contextBudget'

type ToolResultMessage = Extract<AgentSession['messages'][number], { role: 'toolResult' }>
/** Pi 1.x 的会话消息 details 只收 JSON；工具返回值的 details 仍是 unknown，测试按会话落盘形状收窄。 */
const toolMessage = (toolName: string, toolCallId: string, result: { content: ToolResultMessage['content']; details?: unknown }, isError = false, timestamp = 0): ToolResultMessage =>
  ({ role: 'toolResult', toolName, toolCallId, content: result.content, details: result.details as ToolResultMessage['details'], isError, timestamp })

it('ASCII 规则不变，CJK/BMP 逐码点计一、emoji 和扩展汉字计二', () => {
  expect(estimateContextTokens('abc_def123 !')).toBe(6)
  expect(estimateContextTokens('中文é。、　')).toBe(6)
  expect(estimateContextTokens('🙂𠀀')).toBe(4)
})

it('工具结果与技能原文原样进上下文，只有单条超过上限才转成摘要加可续读引用，分页无损且不越会话', async () => {
  const manager = SessionManager.inMemory()
  const skillText = '技能正文。'.repeat(2400)
  expect(archiveToolResult(manager, { content: [{ type: 'text', text: skillText }], details: undefined }, 40000).content[0]).toEqual({ type: 'text', text: skillText })
  const original = JSON.stringify({ ok: false, executionState: 'partial', operationId: 'original-operation',
    message: '修改已保留，保存失败', data: { text: '这是保留的中文转录事实。🙂'.repeat(4000), tail: '最终事实' } })
  const archived = archiveToolResult(manager, { content: [{ type: 'text', text: original }], details: undefined }, 4000)
  const text = archived.content[0]
  if (text.type !== 'text') throw new Error('missing text')
  const projected = JSON.parse(text.text) as { excerpt: string; read: { offset: number } }
  expect(projected).toMatchObject({ facts: { ok: false, executionState: 'partial', operationId: 'original-operation' }, hasMore: true })
  // 续读从摘录结束处接上，不重复已给出的内容
  expect(projected.read.offset).toBe(projected.excerpt.length)
  expect(original.startsWith(projected.excerpt)).toBe(true)
  const reference = `tool:${(archived.details as { resultId: string }).resultId}:0`
  const reader = contextReader(manager, 2000)
  let offset = 0; let restored = ''; let hasMore = true
  while (hasMore) {
    const page = await reader.execute('page', { reference, offset }, undefined, undefined, {} as never)
    const part = page.content[0]
    if (part.type !== 'text') throw new Error('missing page')
    expect(estimateContextTokens(part.text)).toBeLessThanOrEqual(2000)
    const parsed = JSON.parse(part.text) as { data: string; nextOffset: number; hasMore: boolean }
    restored += parsed.data; offset = parsed.nextOffset; hasMore = parsed.hasMore
  }
  expect(restored).toBe(original)
  await expect(contextReader(SessionManager.inMemory(), 4000).execute('foreign', { reference }, undefined, undefined, {} as never)).rejects.toThrow('不在当前对话')
})

it('较早内容超窗交给 Pi 压缩不报错；最后一次回复之后新进来的一批自己装不下窗口时才报上下文预算错误', () => {
  const big = (id: string): AgentSession['messages'][number] => ({ role: 'toolResult', toolName: 'read_application_entity', toolCallId: id,
    content: [{ type: 'text', text: '资料'.repeat(6000) }], isError: false, timestamp: 0 })
  const assistant = { role: 'assistant', content: [{ type: 'text', text: '好' }], api: 'openai-completions', provider: 'p', model: 'm',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'toolUse', timestamp: 0 } as unknown as AgentSession['messages'][number]
  const user: AgentSession['messages'][number] = { role: 'user', content: '继续', timestamp: 0 }
  const limits = { contextWindow: 14000, maxOutputTokens: 1024, instructions: '', tools: [] }
  expect(() => budgetContext([user, big('a'), assistant, big('b'), assistant], limits)).not.toThrow()
  expect(() => budgetContext([user, assistant, big('a'), big('b')], limits)).toThrow('上下文预算')
})

it('发给模型前不截工具结果；超出窗口时只让出最旧的界面快照，最新快照保留，其余交给 Pi 压缩', () => {
  const result: AgentSession['messages'][number] = { role: 'toolResult', toolName: 'read_application_entity', toolCallId: 'big',
    content: [{ type: 'text', text: '资料'.repeat(6000) }], isError: false, timestamp: 0 }
  const snapshot = (id: string): AgentSession['messages'][number] => ({ role: 'custom', customType: 'henji-context', content: `界面${id}`.repeat(400), display: false, timestamp: 0 } as AgentSession['messages'][number])
  const user: AgentSession['messages'][number] = { role: 'user', content: '继续', timestamp: 0 }
  const reply = { role: 'assistant', content: [{ type: 'text', text: '好' }], api: 'openai-completions', provider: 'p', model: 'm',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: 0 } as unknown as AgentSession['messages'][number]
  const messages = [snapshot('旧'), result, reply, snapshot('新'), user]
  const projected = budgetContext(messages, { contextWindow: 13000, maxOutputTokens: 1024, instructions: '', tools: [] })
  expect(projected).toContain(result)
  expect(projected.filter(message => message.role === 'custom')).toEqual([messages[3]])
  expect(budgetContext(messages, { contextWindow: 200000, maxOutputTokens: 1024, instructions: '', tools: [] })).toEqual(messages)
})

it('最小信封保留写入事实，放不下事实时明确拒绝而不是返回空壳', () => {
  const facts = { ok: true, executionState: 'completed', operationId: 'write', verificationState: 'verified', persistenceState: 'saved' }
  const original = JSON.stringify({ ...facts, data: '长正文'.repeat(4000) })
  const projected = JSON.parse(projectText(original, 'tool:write:0', 160))
  expect(projected.facts).toMatchObject(facts)
  expect(() => projectText(original, 'tool:write:0', 8)).toThrow('上下文预算')
})
