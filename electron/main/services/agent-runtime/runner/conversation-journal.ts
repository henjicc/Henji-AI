import type {
  ModelStepFinishReason,
  ModelStepMessage,
  ModelStepUsage,
} from '@henjicc/ai-sdk'
import type { AgentRunnerDependencies } from './types'

interface ConversationJournalOptions {
  runId: string
  threadId: string
  history?: ModelStepMessage[]
  historySequences?: number[]
  append?: AgentRunnerDependencies['appendSessionInternal']
  getTurn: () => number
}

interface InternalMessageMetadata {
  providerId?: string
  modelId?: string
  stepId?: string
  finishReason?: ModelStepFinishReason
  usage?: ModelStepUsage
}

export class AgentConversationJournal {
  readonly messages: ModelStepMessage[]
  readonly sourceSequences: number[]
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly options: ConversationJournalOptions) {
    this.messages = [...(options.history ?? [])]
    this.sourceSequences = [
      ...(options.historySequences ?? []),
      ...Array.from({
        length: Math.max(
          0,
          (options.history?.length ?? 0) - (options.historySequences?.length ?? 0)
        ),
      }, () => 0),
    ]
  }

  appendEphemeral(message: ModelStepMessage): void {
    this.messages.push(message)
    this.sourceSequences.push(0)
  }

  appendInternal(
    kind: 'model_message' | 'tool_result',
    message: ModelStepMessage,
    idempotencyKey: string,
    metadata: InternalMessageMetadata = {}
  ): void {
    const sourceIndex = this.messages.length
    this.messages.push(message)
    this.sourceSequences.push(0)
    const append = this.options.append
    if (!append) return
    this.writeChain = this.writeChain.then(async () => {
      const entry = await append({
        runId: this.options.runId,
        threadId: this.options.threadId,
        turn: Math.max(1, this.options.getTurn()),
        kind,
        payload: { message, ...metadata },
        idempotencyKey,
      })
      this.sourceSequences[sourceIndex] = entry.sequence
    })
  }

  async flush(): Promise<void> {
    await this.writeChain
  }
}
