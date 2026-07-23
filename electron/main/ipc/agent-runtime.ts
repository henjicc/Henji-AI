import {
  agentApprovalResponseSchema,
  agentCancelRunRequestSchema,
  agentRunControlRequestSchema,
  agentStartRunRequestSchema,
} from '../../../src/core/assistant/runtimeContracts'
import {
  agentListRunsRequestSchema,
  agentRetryRunRequestSchema,
} from '../../../src/core/assistant/persistence'
import { getAgentRuntimeService } from '../services/agent-runtime/runtime'
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
  registerIpcHandler('assistant:agent:listRuns', input => agentListRunsRequestSchema.parse(input), (request) => (
    runtime.listRuns(request.threadId, request.limit)
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
