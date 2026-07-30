import {
  agentApprovalResponseSchema,
  agentCancelRunRequestSchema,
  agentRunControlRequestSchema,
  agentRunEventsRequestSchema,
  agentStartRunRequestSchema,
} from '../../../src/core/assistant/runtimeContracts'
import {
  agentListRunsRequestSchema,
  agentRetryRunRequestSchema,
} from '../../../src/core/assistant/persistence'
import {
  agentListThreadsRequestSchema,
  agentTranscriptRequestSchema,
  agentEnqueueMessageRequestSchema,
  agentCancelQueuedMessageRequestSchema,
  agentDeleteThreadsRequestSchema,
} from '../../../src/core/assistant/session'
import { getAgentRuntimeService } from '../services/agent-runtime/runtime'
import {
  agentCancelExternalWaitRequestSchema,
  generationStatusReportRequestSchema,
} from '../../../src/core/assistant/externalWait'
import { getAssistantUserInstructions } from '../services/assistant/user-instructions'
import { assertTrustedAssistantRenderer } from './assistant'
import { registerIpcHandler } from './registry'

export function registerAgentRuntimeIpc(): void {
  const runtime = getAgentRuntimeService()
  registerIpcHandler(
    'assistant:agent:startRun',
    input => agentStartRunRequestSchema.parse(input),
    async (request, event) => {
      const instructions = await getAssistantUserInstructions()
      return runtime.startRun(event.sender, {
        ...request,
        userInstructions: instructions.content || undefined,
      })
    },
    assertTrustedAssistantRenderer
  )
  registerIpcHandler('assistant:agent:cancelRun', input => agentCancelRunRequestSchema.parse(input), (request, event) => (
    runtime.cancelRun(event.sender, request.runId, request.reason)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:pauseRun', input => agentRunControlRequestSchema.parse(input), (request, event) => (
    runtime.pauseRun(event.sender, request.runId)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:resumeRun', input => agentRunControlRequestSchema.parse(input), (request, event) => (
    runtime.resumeRun(event.sender, request.runId)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:respondApproval', input => agentApprovalResponseSchema.parse(input), (request, event) => (
    runtime.respondApproval(event.sender, request.runId, request.approvalId, request.decision)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:getRunState', input => agentRunControlRequestSchema.parse(input), (request, event) => (
    runtime.getRunState(event.sender, request.runId)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:getRunSnapshot', input => agentRunControlRequestSchema.parse(input), (request, event) => (
    runtime.getRunSnapshot(event.sender, request.runId)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:getRunEvents', input => agentRunEventsRequestSchema.parse(input), (request, event) => (
    runtime.getRunEvents(event.sender, request.runId, request.afterSequence, request.limit)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:listRuns', input => agentListRunsRequestSchema.parse(input), (request) => (
    runtime.listRuns(request.threadId, request.limit)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:listThreads', input => agentListThreadsRequestSchema.parse(input), (request) => (
    runtime.listThreads(request.limit)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:deleteThreads', input => agentDeleteThreadsRequestSchema.parse(input), (request) => (
    runtime.deleteThreads(request)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:getTranscript', input => agentTranscriptRequestSchema.parse(input), (request, event) => (
    runtime.getTranscript(event.sender, request.threadId, request.afterSequence, request.limit)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:enqueueMessage', input => agentEnqueueMessageRequestSchema.parse(input), (request, event) => (
    runtime.enqueueMessage(event.sender, request)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:cancelQueuedMessage', input => agentCancelQueuedMessageRequestSchema.parse(input), (request, event) => (
    runtime.cancelQueuedMessage(event.sender, request)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:reportGenerationStatus', input => generationStatusReportRequestSchema.parse(input), (request, event) => (
    runtime.reportGenerationStatus(event.sender, request)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:agent:cancelExternalWait', input => agentCancelExternalWaitRequestSchema.parse(input), (request, event) => (
    runtime.cancelExternalWait(event.sender, request)
  ), assertTrustedAssistantRenderer)
  registerIpcHandler(
    'assistant:agent:retryRun',
    input => agentRetryRunRequestSchema.parse(input),
    async (request, event) => {
      const instructions = await getAssistantUserInstructions()
      return runtime.retryRun(event.sender, request.runId, instructions.content || undefined)
    },
    assertTrustedAssistantRenderer
  )
}
