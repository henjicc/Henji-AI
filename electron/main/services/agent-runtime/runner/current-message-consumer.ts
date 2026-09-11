import { agentQueuedMessagePayloadSchema } from '../../../../../src/core/assistant/session'
import type { ModelStepMessage } from '@henjicc/ai-sdk'
import type { AgentRunnerDependencies } from './types'
import type { TaskPolicyUserMessage } from '../context/task-execution-policy'

export class AgentCurrentMessageConsumer {
  private listener?: (messages: TaskPolicyUserMessage[]) => Promise<void>
  private pulling: Promise<number> | null = null

  onMessages(listener: (messages: TaskPolicyUserMessage[]) => Promise<void>): void { this.listener = listener }
  constructor(
    private readonly runId: string,
    private readonly conversation: ModelStepMessage[],
    private readonly sourceSequences: number[],
    private readonly consume: AgentRunnerDependencies['consumeCurrentTaskMessages']
  ) {}

  async pull(): Promise<number> {
    if (this.pulling) return this.pulling
    this.pulling = this.consumeMessages()
    try { return await this.pulling } finally { this.pulling = null }
  }

  private async consumeMessages(): Promise<number> {
    const entries = await this.consume?.(this.runId) ?? []
    if (entries.length > 0) await this.listener?.(entries.map((entry) => ({
      messageId: entry.entryId, content: agentQueuedMessagePayloadSchema.parse(entry.payload).content,
    })))
    for (const entry of entries) {
      const payload = agentQueuedMessagePayloadSchema.parse(entry.payload)
      this.conversation.push({ role: 'user', content: payload.content })
      this.sourceSequences.push(entry.sequence)
    }
    return entries.length
  }
}
