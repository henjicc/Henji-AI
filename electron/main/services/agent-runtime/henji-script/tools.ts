import { runHenjiScriptCapability } from '../../../../../src/core/assistant/capabilities/henjiScriptApplicationCapabilities'
import { runHenjiScriptOutputSchema } from '../../../../../src/core/assistant/capabilities/henjiScriptApplicationCapabilities'
import { henjiScriptCheckpointSchema } from '../../../../../src/core/assistant/externalWait'
import { z } from 'zod'
import { HenjiScriptService } from '../../application-control/henji-script/service'
import type { AgentToolGateway } from '../tools/gateway'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentToolDefinition } from '../tools/types'
import { createBackendCapabilityTool } from '../tools/backend-capability-tool'
import { defineAgentTool } from '../tools/define-tool'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { getHenjiScriptApiLease } from '../context/script-api-lease'

export interface HenjiScriptToolDependencies {
  service: HenjiScriptService
  gateway: AgentToolGateway
  getHostContext: (runId: string) => HostContextSnapshot | null
}

export const RESUME_HENJI_SCRIPT_TOOL = 'resume_henji_script'

const resumeHenjiScriptInputSchema = z.object({
  checkpoint: henjiScriptCheckpointSchema,
  observedStatus: z.enum(['success', 'error', 'cancelled', 'timeout']),
}).strict()

export function createHenjiScriptTools(
  dependencies: HenjiScriptToolDependencies,
): AgentToolDefinition[] {
  return [createBackendCapabilityTool(runHenjiScriptCapability, {
    outputLimitProfile: 'checkpoint',
    preview: (input) => dependencies.service.preview(input),
    execute: async (input, context) => dependencies.service.execute(input, {
      runId: context.runId,
      threadId: context.threadId,
      toolCallId: context.toolCallId,
      signal: context.signal,
      gateway: dependencies.gateway,
      getHostContext: dependencies.getHostContext,
    }),
  }), defineAgentTool({
    name: RESUME_HENJI_SCRIPT_TOOL,
    version: 1,
    title: '续跑 Henji Script',
    description: '运行时根据已验证断点继续 Henji Script；不向模型暴露。',
    category: 'application', side: 'backend', modelVisible: false,
    risk: 'R1', permission: 'application:script:execute', readOnly: false,
    destructive: false, openWorld: false, idempotent: false, timeoutMs: 120_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false,
    supportsUndo: false, requiredContext: [], inputSchema: resumeHenjiScriptInputSchema,
    outputSchema: runHenjiScriptOutputSchema,
    outputLimitProfile: 'checkpoint',
    aiInputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (input, context) => dependencies.service.resume(input.checkpoint, input.observedStatus, {
      runId: context.runId, threadId: context.threadId, toolCallId: context.toolCallId,
      signal: context.signal, gateway: dependencies.gateway,
      getHostContext: dependencies.getHostContext,
    }),
    concurrencyKey: (input) => `henji-script:${input.checkpoint.scriptRunRef}`,
    targetIds: (input) => ({ scriptRunRef: input.checkpoint.scriptRunRef }),
    dataClasses: () => ['C1'], summarize: (output) => output.verification.summary,
    resolveObservedEffects: (_input, output) => output.effects,
  })] as AgentToolDefinition[]
}

export function createHenjiScriptService(registry: AgentToolRegistry): HenjiScriptService {
  return new HenjiScriptService({ registry, getLease: getHenjiScriptApiLease })
}
