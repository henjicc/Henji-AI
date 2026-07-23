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
  system: string
  messages: ModelStepMessage[]
  tools?: ModelStepTool[]
  runModelStep: AgentModelStepExecutor
  onTextDelta: (text: string) => void
}

interface RouterModelClassificationResult {
  decision: unknown
  usage: ModelStepResult['usage']
}

function parseJsonObjectText(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1] ?? trimmed
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}

export async function runRouterModelClassification(
  input: RouterModelExecutionInput
): Promise<RouterModelClassificationResult> {
  const requestId = `${input.runId}:router:${input.revision}`
  const result = await input.runModelStep({
    requestId,
    runId: input.runId,
    stepId: `router:${input.revision}`,
    providerId: input.model.providerId,
    modelId: input.model.modelId,
    adapter: input.model.adapter,
    baseUrl: input.model.baseUrl,
    system: [
      '只判断用户真正想完成的目标，不执行工具。',
      '根据完整语义分类，不依赖固定关键词，也不要把内容题材误判成模型搜索。',
      'generate 表示生成图片、视频或音频；diagnose 表示寻找错误原因或解决办法；canvas 表示操作画布或项目；memory 表示用户明确要求查看、保存、纠正或删除助手长期记忆。',
      '输出必须符合给定 JSON 结构。',
    ].join('\n'),
    messages: [
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
              'memory',
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
  return {
    decision: result.structuredOutput ?? parseJsonObjectText(result.text),
    usage: result.usage,
  }
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
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    output: { mode: 'text' },
    capabilities: input.model.capabilities,
    settings: input.model.settings,
  }, (event) => {
    if (event.type === 'TextDelta') input.onTextDelta(event.text)
  })
}
