import { agentQueuedMessagePayloadSchema } from '../../../../../src/core/assistant/session'
import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import type { AgentRunnerDependencies } from './types'

export class AgentCurrentMessageConsumer {
  constructor(
    private readonly runId: string,
    private readonly conversation: ModelStepMessage[],
    private readonly consume: AgentRunnerDependencies['consumeCurrentTaskMessages']
  ) {}

  async pull(): Promise<number> {
    const entries = await this.consume?.(this.runId) ?? []
    for (const entry of entries) {
      const payload = agentQueuedMessagePayloadSchema.parse(entry.payload)
      this.conversation.push({ role: 'user', content: payload.content })
    }
    return entries.length
  }
}
