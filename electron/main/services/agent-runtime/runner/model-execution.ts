import type {
  ModelStepMessage,
  ModelStepResult,
  ModelStepTool,
} from '../../../../../src/core/llm/modelStep'
import type { AgentRuntimeModel } from './models'
import type { AgentModelStepExecutor } from './types'

interface RouterModelExecutionInput {
  runId: string
  goal: string
  revision: number
  model: AgentRuntimeModel
  runModelStep: AgentModelStepExecutor
  signal: AbortSignal
}

interface PrimaryModelExecutionInput {
  runId: string
  turn: number
  model: AgentRuntimeModel
  messages: ModelStepMessage[]
  tools?: ModelStepTool[]
  runModelStep: AgentModelStepExecutor
  onTextDelta: (text: string) => void
}

export async function runRouterModelClassification(
  input: RouterModelExecutionInput
): Promise<ModelStepResult> {
  const requestId = `${input.runId}:router:${input.revision}`
  const result = await input.runModelStep({
    requestId,
    runId: input.runId,
    stepId: `router:${input.revision}`,
    providerId: input.model.providerId,
    modelId: input.model.modelId,
    adapter: input.model.adapter,
    baseUrl: input.model.baseUrl,
    messages: [
      { role: 'system', content: '只分类用户意图。输出必须符合给定 JSON 结构，不执行工具。' },
      { role: 'user', content: input.goal },
    ],
    output: {
      mode: 'object',
      name: 'agent_intent_route',
      schema: {
        type: 'object',
        properties: {
          intent: {
            type: 'string',
            enum: [
              'navigate',
              'generate',
              'inspect_model',
              'read_generation',
              'cancel_generation',
              'diagnose',
              'canvas',
              'user_instructions',
              'general',
            ],
          },
          complexity: { type: 'string', enum: ['simple', 'multi_step', 'ambiguous'] },
          reason: { type: 'string', maxLength: 500 },
        },
        required: ['intent', 'complexity', 'reason'],
        additionalProperties: false,
      },
    },
    capabilities: input.model.capabilities,
    settings: input.model.settings,
  }, () => undefined)
  if (input.signal.aborted) throw new Error('[task_cancelled] router cancelled')
  return result
}

export function runPrimaryAgentModelStep(
  input: PrimaryModelExecutionInput
): Promise<ModelStepResult> {
  const stepId = `step-${input.turn}`
  return input.runModelStep({
    requestId: `${input.runId}:${stepId}`,
    runId: input.runId,
    stepId,
    providerId: input.model.providerId,
    modelId: input.model.modelId,
    adapter: input.model.adapter,
    baseUrl: input.model.baseUrl,
    messages: input.messages,
    tools: input.tools,
    output: { mode: 'text' },
    capabilities: input.model.capabilities,
    settings: input.model.settings,
  }, (event) => {
    if (event.type === 'TextDelta') input.onTextDelta(event.text)
  })
}
