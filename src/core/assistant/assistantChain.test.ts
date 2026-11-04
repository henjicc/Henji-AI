import { expect, it } from 'vitest'
import { buildAssistantChain, formatAssistantChainReport, type AssistantChainLogEvent } from './assistantChain'

const run = 'run-1'
const at = (second: number): string => new Date(Date.UTC(2026, 10, 4, 0, 0, second)).toISOString()
const event = (second: number, name: string, context: Record<string, unknown> = {}, extra: Partial<AssistantChainLogEvent> = {}): AssistantChainLogEvent => ({
  timestamp: at(second), level: 'info', domain: 'main.embedded_agent', event: name, message: name, source: 'backend', requestId: run, context, ...extra,
})

// 保护日志窗口与 logs:query --chain 共用的配对规则：工具按 toolCallId、模型按轮次，事务紧跟工具，Pi 自己拒绝的调用也在链路里。
it('按时间把模型轮次、工具调用与事务排成同一条链路', () => {
  const events = [
    event(0, 'embedded_agent.message.queued', { text: '把字幕调大' }),
    event(1, 'embedded_agent.turn.start', { sessionId: 's1' }),
    event(1, 'embedded_agent.context.prepared', { durationMs: 40, parts: [{ id: 'skills', estimatedTokens: 300, count: 2 }, { id: 'tools', estimatedTokens: 900, count: 12 }] }),
    event(2, 'embedded_agent.turn.model_requested', { turn: 1 }, { providerId: 'p', modelId: 'm' }),
    event(4, 'embedded_agent.turn.model_completed', { turn: 1, durationMs: 2000, stopReason: 'toolUse', metrics: { input: 100, output: 20, cacheRead: 50, cacheWrite: 0 } }),
    event(4, 'embedded_agent.turn.tool_executed', { tool: { toolCallId: 'z', toolName: 'get_current_application_context', isError: true, resultText: 'Tool not found' } }),
    event(5, 'embedded_agent.tool.start', { toolCallId: 'a', toolName: 'create_visible_generation_task', paid: true, input: { prompt: 'x' } }),
    event(6, 'embedded_agent.tool.start', { toolCallId: 'b', toolName: 'update_application_entity', input: { ref: 'r' } }),
    event(7, 'embedded_agent.tool.failed', { toolCallId: 'a', durationMs: 2000, failureReason: '余额不足' }, { level: 'error' }),
    event(8, 'embedded_agent.tool.completed', { toolCallId: 'b', durationMs: 2000, result: { ok: true, transactionRef: 't', undoRef: 'u', resultRefCount: 1 } }),
    event(8, 'embedded_agent.turn.tool_executed', { tool: { toolCallId: 'b', toolName: 'update_application_entity', isError: false, resultText: '已修改' } }),
    event(9, 'embedded_agent.turn.model_requested', { turn: 2 }),
    event(10, 'embedded_agent.turn.model_completed', { turn: 2, durationMs: 1000, stopReason: 'stop' }),
    event(11, 'embedded_agent.turn.completed', { durationMs: 10000, answer: '已调大' }),
    event(11, 'embedded_agent.turn.completed', {}, { requestId: `${run}:memory` }),
  ]
  const chain = buildAssistantChain(run, events)
  expect(chain).toMatchObject({ status: 'completed', input: '把字幕调大', sessionId: 's1', answer: '已调大' })
  expect(chain.steps.map(step => `${step.kind}:${step.status}`)).toEqual([
    'input:completed', 'context:completed', 'model:completed', 'tool:failed', 'tool:failed', 'tool:completed', 'transaction:completed', 'model:completed', 'reply:completed',
  ])
  expect(chain.steps[3]).toMatchObject({ title: 'get_current_application_context', summary: 'Tool not found' })
  expect(chain.steps[4]).toMatchObject({ paid: true, summary: '余额不足', durationMs: 2000 })
  expect(chain.steps[5].data.modelSawResult).toBe('已修改')
  expect(chain.steps[6]).toMatchObject({ nested: true, summary: '写入 1 项 · 有撤销点' })
  expect(chain.events).toHaveLength(14)
  expect(formatAssistantChainReport(chain)).toContain('5. [失败][付费] create_visible_generation_task · 2.0s · 余额不足')
})

it('媒体分块读取归并回同一次工具调用', () => {
  const chain = buildAssistantChain(run, [
    event(0, 'embedded_agent.message.queued', { text: '看图' }),
    event(1, 'embedded_agent.tool.start', { toolCallId: 'm:0', toolName: 'read_application_media' }),
    event(2, 'embedded_agent.tool.completed', { toolCallId: 'm:0', durationMs: 100 }),
    event(2, 'embedded_agent.tool.start', { toolCallId: 'm:262144', toolName: 'read_application_media' }),
    event(3, 'embedded_agent.tool.completed', { toolCallId: 'm:262144', durationMs: 50 }),
    event(3, 'embedded_agent.turn.tool_executed', { tool: { toolCallId: 'm', toolName: 'read_application_media', isError: false } }),
    event(4, 'embedded_agent.turn.completed', {}),
  ])
  const tools = chain.steps.filter(step => step.kind === 'tool')
  expect(tools).toHaveLength(1)
  expect(tools[0]).toMatchObject({ id: 'tool-m', durationMs: 150, data: { chunks: 2 } })
})

it('还没发出模型请求就失败时，回复步骤带上失败原因', () => {
  const chain = buildAssistantChain(run, [
    event(0, 'embedded_agent.message.queued', { text: '你好' }),
    event(1, 'embedded_agent.request.failed', {}, { level: 'error', error: { message: '请先配置助手主模型' } }),
  ])
  expect(chain.status).toBe('failed')
  expect(chain.steps.at(-1)).toMatchObject({ kind: 'reply', status: 'failed', summary: '请先配置助手主模型' })
})
