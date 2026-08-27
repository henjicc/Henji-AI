import type {
  ModelStepMessage,
  ModelStepEvent,
  ModelStepResult,
  ModelStepTool,
  ModelStepTraceMetadata,
} from '@henjicc/ai-sdk'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentContextBuilder } from '../context/builder'
import { AGENT_INTENTS, AGENT_TOOL_DOMAINS } from '../context/types'
import type { AgentRuntimeModel } from './models'
import type { AgentModelStepExecutor } from './types'

interface RouterModelExecutionInput {
  runId: string
  goal: string
  snapshot: HostContextSnapshot
  model: AgentRuntimeModel
  runModelStep: AgentModelStepExecutor
  signal: AbortSignal
  /** 同一会话的延续证据；缺省表示这是线程里的第一轮。 */
  continuation?: string | null
}

function compactRouterSnapshot(snapshot: HostContextSnapshot): Record<string, unknown> {
  return {
    revision: snapshot.revision,
    scopeRevisions: snapshot.scopeRevisions,
    /*
     * surface 必须带上。
     *
     * 这份摘要原来只给 workspace，而 workspace 的粒度是"生成/画布/工具"，看不出用户正开着
     * 三维编辑器还是图片编辑器。确定性路由分支一直在用 snapshot.surface?.id，唯独路由模型
     * 被蒙着眼——同一个快照，两条路径看到的信息不一样。
     */
    surface: snapshot.surface ?? null,
    workspace: snapshot.workspace,
    project: snapshot.project,
    generation: {
      commandReady: snapshot.generation.commandReady,
      modelCatalogAvailable: Boolean(snapshot.generation.modelCatalog),
      modelCatalogGroupCount: snapshot.generation.modelCatalog?.modelGroups.length ?? 0,
    },
    assets: snapshot.assets,
    uiReady: snapshot.uiReady,
    availableCapabilities: snapshot.availableCapabilities ?? [],
  }
}

interface PrimaryModelExecutionInput {
  runId: string
  turn: number
  stepId?: string
  model: AgentRuntimeModel
  system: string
  messages: ModelStepMessage[]
  tools?: ModelStepTool[]
  trace?: ModelStepTraceMetadata
  runModelStep: AgentModelStepExecutor
  onTextDelta: (text: string) => void
  onReasoningDelta?: (text: string) => void
  onRetry?: (event: Extract<ModelStepEvent, { type: 'Retrying' }>) => void
}

interface RouterModelClassificationResult {
  decision: unknown
  usage: ModelStepResult['usage']
}

export function buildPrimaryModelTraceMetadata(
  turn: number,
  context: ReturnType<AgentContextBuilder['build']>,
  model: AgentRuntimeModel
): ModelStepTraceMetadata {
  return {
    kind: 'primary',
    turn,
    snapshotRevision: context.snapshotRevision,
    contextWindowBudget: model.limits.contextWindow,
    maxOutputTokens: model.settings.maxOutputTokens,
    estimatedTokens: context.estimatedTokens,
    compacted: context.compacted,
    beforeCompactionTokens: context.beforeCompactionTokens,
    retainedLayers: context.retainedLayers,
    droppedLayers: context.droppedLayers,
    layerReports: context.layerReports,
    activeToolNames: context.activeToolNames,
  }
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
  const requestId = `${input.runId}:router:${input.snapshot.revision}`
  const result = await input.runModelStep({
    requestId,
    runId: input.runId,
    stepId: `router:${input.snapshot.revision}`,
    providerId: input.model.providerId,
    modelId: input.model.modelId,
    adapter: input.model.adapter,
    apiProtocol: input.model.apiProtocol,
    baseUrl: input.model.baseUrl,
    system: [
      '只判断用户真正想完成的目标，不执行工具。',
      '根据完整语义分类，不依赖固定关键词，也不要把内容题材误判成模型搜索。',
      'generate 表示生成图片、视频或音频；diagnose 表示寻找错误原因或解决办法；canvas 表示操作画布或项目；memory 表示用户明确要求查看、保存、纠正或删除助手长期记忆。',
      'intent 是当前最可能主意图；candidateIntents 和 toolDomains 用于表达跨工作区、多步骤或不确定任务的合法候选，不能用它们请求越权能力。',
      // 只判领域，不拆步骤：拆步骤要在动手前猜"会做几件事、每件产生什么 Effect"，猜错就没有出口。
      // 那部分整体删除了，判错领域的代价只是候选能力排序偏一点，主模型仍可自己写发现请求要回来。
      '不要规划步骤、不要预测会产生哪些写入效果：那些由主模型看着完整会话历史决定。',
      // 当前页面只是弱证据：用户常在 A 页面下达针对 B 页面的指令，尤其是承接上一轮任务时。
      '宿主快照说明用户此刻在哪，不代表任务属于那里。若延续证据显示上一轮在别的领域，优先按上一轮的领域分类，并把需要的领域写进 toolDomains。',
      '输出必须符合给定 JSON 结构。',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `用户目标：${input.goal}`,
          ...(input.continuation ? [input.continuation] : []),
          '当前宿主快照（仅用于判断当前工作区、项目、可用命令和 revision）：',
          JSON.stringify(compactRouterSnapshot(input.snapshot)),
        ].join('\n'),
      },
    ],
    output: {
      mode: 'object',
      name: 'agent_intent_route',
      schema: {
        type: 'object',
        properties: {
          intent: {
            type: 'string',
            enum: [...AGENT_INTENTS],
          },
          candidateIntents: {
            type: 'array', maxItems: 4, items: { type: 'string', enum: [...AGENT_INTENTS] },
          },
          toolDomains: {
            type: 'array', maxItems: 6, items: { type: 'string', enum: [...AGENT_TOOL_DOMAINS] },
          },
          reason: { type: 'string', maxLength: 500 },
        },
        required: ['intent', 'candidateIntents', 'toolDomains', 'reason'],
        additionalProperties: false,
      },
    },
    capabilities: input.model.capabilities,
    reasoning: input.model.reasoning,
    settings: input.model.settings,
    pricing: input.model.pricing,
    trace: {
      kind: 'router',
      snapshotRevision: input.snapshot.revision,
      contextWindowBudget: input.model.limits.contextWindow,
      maxOutputTokens: input.model.settings.maxOutputTokens,
    },
  }, () => undefined)
  if (input.signal.aborted) throw new Error('[task_cancelled] router cancelled')
  if (result.finishReason !== 'stop') {
    throw new Error(
      `[MODEL_OUTPUT_INCOMPLETE] 路由模型以 ${result.finishReason} 结束，拒绝使用可能不完整的分类结果`
    )
  }
  return {
    decision: result.structuredOutput ?? parseJsonObjectText(result.text),
    usage: result.usage,
  }
}

export function runPrimaryAgentModelStep(
  input: PrimaryModelExecutionInput
): Promise<ModelStepResult> {
  if (input.messages.some((message) => message.role === 'system')) {
    throw new Error('[invalid_context] 普通 Agent messages 中禁止 system 消息')
  }
  const stepId = input.stepId ?? `step-${input.turn}`
  return input.runModelStep({
    requestId: `${input.runId}:${stepId}`,
    runId: input.runId,
    stepId,
    providerId: input.model.providerId,
    modelId: input.model.modelId,
    adapter: input.model.adapter,
    apiProtocol: input.model.apiProtocol,
    baseUrl: input.model.baseUrl,
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    output: { mode: 'text' },
    capabilities: input.model.capabilities,
    reasoning: input.model.reasoning,
    settings: input.model.settings,
    pricing: input.model.pricing,
    trace: input.trace,
  }, (event) => {
    if (event.type === 'TextDelta') input.onTextDelta(event.text)
    else if (event.type === 'ReasoningDelta') input.onReasoningDelta?.(event.text)
    else if (event.type === 'Retrying') input.onRetry?.(event)
  })
}
