import { expect, it } from 'vitest'
import { SessionManager, type AgentSession } from '@earendil-works/pi-coding-agent'
import { archiveToolResult, contextReader } from './contextReader'
import { budgetContext, estimateContextTokens, messageTokens, projectText } from './contextBudget'

it('最小信封保留写入事实，放不下事实时明确拒绝而不是返回空壳', () => {
  const facts = { ok: true, executionState: 'completed', operationId: 'write', verificationState: 'verified', persistenceState: 'saved' }
  const original = JSON.stringify({ ...facts, data: '长正文'.repeat(4000) })
  const projected = JSON.parse(projectText(original, 'tool:write:0', 160))
  expect(projected.facts).toMatchObject(facts)
  expect(() => projectText(original, 'tool:write:0', 8)).toThrow('上下文预算')
})

it('长历史优先保留最新写入正文，当前轮分页信封不再二次裁剪', () => {
  const result = (id: string): AgentSession['messages'][number] => ({ role: 'toolResult', toolName: 'change_application_entities', toolCallId: id,
    content: [{ type: 'text', text: JSON.stringify({ ok: true, executionState: 'completed', operationId: id, data: '写入内容'.repeat(600) }) }], isError: false, timestamp: 0 })
  const history = Array.from({ length: 25 }, (_, i) => result(`old-${i}`))
  const page = JSON.stringify({ reference: 'tool:old-0:0', offset: 0, total: 10000, data: '分页面'.repeat(100), nextOffset: 300, hasMore: true })
  const messages: AgentSession['messages'] = [...history, { role: 'user', content: '继续', timestamp: 0 }, result('latest'),
    { role: 'toolResult', toolName: 'read_assistant_context', toolCallId: 'page', content: [{ type: 'text', text: page }], isError: false, timestamp: 0 }]
  const projected = budgetContext(messages, { contextWindow: 12000, maxOutputTokens: 1024, instructions: '', tools: [] })
  const text = (index: number) => { const m = projected[index]; if (m.role !== 'toolResult' || m.content[0].type !== 'text') throw new Error('text'); return m.content[0].text }
  expect(JSON.parse(text(26)).facts).toMatchObject({ ok: true, executionState: 'completed', operationId: 'latest' })
  expect(estimateContextTokens(text(26))).toBeGreaterThan(estimateContextTokens(text(0)))
  expect(text(27)).toBe(page)
})

it('中文大结果保留失败事实并按模型窗口投影，原文分页无损、分支隔离且不重放', async () => {
  const original = JSON.stringify({ ok: false, executionState: 'partial', operationId: 'original-operation',
    message: '修改已保留，保存失败', data: { text: '这是保留的中文转录事实。🙂'.repeat(4000), tail: '最终事实' } })
  expect(estimateContextTokens(original)).toBeGreaterThan(original.length)
  const manager = SessionManager.inMemory()
  const archived = archiveToolResult(manager, { content: [{ type: 'text', text: original }], details: undefined })
  const reference = `tool:${(archived.details as { resultId: string }).resultId}:0`
  const message: AgentSession['messages'][number] = { role: 'toolResult', toolName: 'read_project', toolCallId: 'result',
    ...archived, isError: true, timestamp: Date.now() }
  manager.appendMessage(message)
  const reader = contextReader(manager)
  const large = budgetContext([message], { contextWindow: 16000, maxOutputTokens: 1024, instructions: '系统', tools: [reader] })
  const small = budgetContext([message], { contextWindow: 5000, maxOutputTokens: 1024, instructions: '系统'.repeat(100), tools: [reader] })
  expect(messageTokens(small[0])).toBeLessThan(messageTokens(large[0]))
  const text = archived.content[0]
  if (text.type !== 'text') throw new Error('missing text')
  expect(JSON.parse(text.text)).toMatchObject({ facts: { ok: false, executionState: 'partial', operationId: 'original-operation' }, hasMore: true })
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
  await expect(contextReader(SessionManager.inMemory()).execute('foreign', { reference }, undefined, undefined, {} as never)).rejects.toThrow('不在当前对话')
  expect(() => budgetContext([message], { contextWindow: 2000, maxOutputTokens: 1024, instructions: '系统'.repeat(1000), tools: [reader] })).toThrow('上下文预算')
})
