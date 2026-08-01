import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import { AgentConversationJournal } from './conversation-journal'
import { AgentCurrentMessageConsumer } from './current-message-consumer'
import type { AgentRunnerOptions } from './types'

export function createRunnerConversation(
  options: AgentRunnerOptions,
  getTurn: () => number
): {
  journal: AgentConversationJournal
  messages: ModelStepMessage[]
  sourceSequences: number[]
  currentMessageConsumer: AgentCurrentMessageConsumer
} {
  const journal = new AgentConversationJournal({
    runId: options.runId,
    threadId: options.request.threadId,
    history: options.conversationHistory,
    historySequences: options.conversationHistorySequences,
    append: options.dependencies.appendSessionInternal,
    getTurn,
  })
  return {
    journal,
    messages: journal.messages,
    sourceSequences: journal.sourceSequences,
    currentMessageConsumer: new AgentCurrentMessageConsumer(
      options.runId,
      journal.messages,
      journal.sourceSequences,
      options.dependencies.consumeCurrentTaskMessages
    ),
  }
}
