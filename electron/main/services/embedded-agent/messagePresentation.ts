import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { EmbeddedAgentMessage } from '../../../../src/core/assistant/embeddedAgent'
import type { PiAttachments } from './piAttachments'

/** 从 Pi 正式历史派生展示，重新打开会话也保留过程；不暴露工具参数及原始回执。 */
export function visibleMessages(messages: AgentSession['messages'], sessionId: string, attachments: PiAttachments,
  titles: ReadonlyMap<string, string> = new Map()): EmbeddedAgentMessage[] {
  const output: EmbeddedAgentMessage[] = []
  const results = new Map(messages.flatMap(message => message.role === 'toolResult' ? [[message.toolCallId, message] as const] : []))
  for (const [index, message] of messages.entries()) {
    const id = `${sessionId}:${index}`
    if (message.role === 'user') {
      const text = typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
      if (text) output.push({ id, role: 'user', ...attachments.visible(text) })
    } else if (message.role === 'assistant') {
      const thinking = message.content.filter(part => part.type === 'thinking').map(part => part.thinking).join('\n')
      const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
      if (thinking) output.push({ id: `${id}:thinking`, role: 'assistant', kind: 'process', text: thinking })
      if (text) output.push({ id, role: 'assistant', text,
        kind: message.stopReason === 'stop' || message.stopReason === 'length' ? 'answer' : 'process' })
      for (const part of message.content) {
        if (part.type !== 'toolCall') continue
        const result = results.get(part.id)
        output.push({ id: `${id}:tool:${part.id}`, role: 'assistant', kind: 'tool', text: titles.get(part.name) ?? '操作应用',
          status: result?.role === 'toolResult' ? result.isError ? 'failed' : 'completed' : 'running' })
      }
    }
  }
  return output
}
