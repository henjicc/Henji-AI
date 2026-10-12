import { expect, it } from 'vitest'
import { SessionManager, type AgentSession } from '@earendil-works/pi-coding-agent'
import { archiveToolResult, contextReader } from './contextReader'
import { budgetContext, estimateContextTokens, messageTokens } from './contextBudget'

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
