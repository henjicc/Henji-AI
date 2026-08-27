import type { LlmChatMessageDto } from './chatTypes'

/** 流式内核与外部 module client 共用的纯输入计量，不读取或记录消息内容。 */
export function countLlmInputChars(messages: readonly LlmChatMessageDto[]): number {
  return messages.reduce((sum, message) => sum + countMessageContent(message.content), 0)
}

function countMessageContent(content: LlmChatMessageDto['content']): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  return content.reduce((sum, part) => sum + (typeof part.text === 'string' ? part.text.length : 0), 0)
}
