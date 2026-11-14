import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { EmbeddedAgentMessage } from '../../../../src/core/assistant/embeddedAgent'
import type { PiAttachments } from './piAttachments'
import { APPLICATION_TOOL_DISPATCHER } from './toolDisclosureProfiles'
import { describeLocalToolCall } from './localTools'

/** 从 Pi 正式历史派生展示，重新打开会话也保留过程；不暴露应用工具的参数及原始回执，本机命令与文件操作显示命令和路径，让人看得见助手在电脑上做了什么。 */
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
        // 分派入口显示它实际调用的那个工具
        const inner: unknown = part.name === APPLICATION_TOOL_DISPATCHER ? part.arguments?.name : undefined
        output.push({ id: `${id}:tool:${part.id}`, role: 'assistant', kind: 'tool', text: answeredStep(part.name, result) ?? describeLocalToolCall(part.name, part.arguments) ?? (typeof inner === 'string' ? titles.get(inner) : undefined) ?? titles.get(part.name) ?? '操作应用',
          status: result?.role === 'toolResult' ? result.isError ? 'failed' : 'completed' : 'running' })
      }
    }
  }
  return output
}

/**
 * 问过用户的那一步在对话里写成用户的回答：问题卡片接管输入框，答完就收起，对话里留下“已回答：…”才知道当时选了什么。
 * 回答原文来自工具结果（questionTools.ts 的格式：每题一行“问题 → 回答”）。
 */
const LINE_BREAK = String.fromCharCode(10)
function answeredStep(name: string, result: AgentSession['messages'][number] | undefined): string | undefined {
  if (name !== 'ask_user' && name !== 'present_plan' || result?.role !== 'toolResult' || result.isError) return undefined
  const text = result.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(LINE_BREAK)
  if (name === 'present_plan') return text.startsWith('用户同意') ? '计划：已同意执行' : text.startsWith('用户希望修改') ? '计划：要求修改' : '计划：先不执行'
  if (text.startsWith('用户跳过')) return '已跳过问题'
  const answers = text.split(LINE_BREAK).map(line => line.split(' → ').at(-1)?.trim()).filter(Boolean)
  return answers.length ? `已回答：${answers.join('；')}` : undefined
}
