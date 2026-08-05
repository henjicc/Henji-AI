import { z } from 'zod'

import { createMainLogger } from '../../logging'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { createSingleFacetTaskGraph } from '../../../../../src/core/assistant/taskGraph'
import {
  AGENT_INTENTS,
  AGENT_TOOL_DOMAINS,
  type AgentIntent,
  type AgentRouteDecision,
  type AgentToolDomain,
} from './types'
import {
  createDeterministicTaskGraph,
  createModelTaskGraph,
  taskGraphCoversBaseline,
  tryCreateModelTaskGraph,
} from './task-facets'
import { inferIntentTaskSemantics } from './task-intent-semantics'
import {
  continuationDomains,
  continuationIntents,
  describeContinuationForRouter,
  isContinuationGoal,
  type AgentThreadContinuation,
} from './thread-continuation'

const logger = createMainLogger('main.agent_router')

const routerModelDecisionSchema = z.object({
  intent: z.enum(AGENT_INTENTS),
  // 供应商未强制 JSON Schema 时，附属字段偶发变形不应掩盖已识别的主意图。
  // 工具权限仍只由本地 routePolicy 和白名单值决定，绝不采纳模型自由生成的对象。
  candidateIntents: z.unknown().optional(),
  toolDomains: z.unknown().optional(),
  complexity: z.unknown().optional(),
  reason: z.unknown().optional(),
  taskFacets: z.unknown().optional(),
}).passthrough()

export type RouterModelClassifier = (
  goal: string,
  snapshot: HostContextSnapshot,
  signal: AbortSignal,
  continuation?: string | null
) => Promise<unknown>

/**
 * 把上一轮的领域并入本轮决策。
 *
 * 只做**放宽**：新增候选意图与工具域，绝不改写主意图，也不删除任何已有域。理由是路由的主意图
 * 还影响模型目录注入、任务图形状等一串下游行为，而"多给几个候选工具"的代价只是能力发现多排
 * 几个候选——两边风险完全不对称。真正卡死的是"camera_stage 根本不在池子里"，把它放进去就够了。
 */
function widenWithContinuation(
  decision: AgentRouteDecision,
  goal: string,
  continuation: AgentThreadContinuation | null
): AgentRouteDecision {
  if (!continuation || !isContinuationGoal(goal)) return decision
  const extraDomains = continuationDomains(continuation)
    .filter((domain) => !decision.toolDomains.includes(domain))
  if (extraDomains.length === 0) return decision
  const extraIntents = continuationIntents(continuation)
    .filter((intent) => intent !== decision.intent)
  return {
    ...decision,
    candidateIntents: uniqueValues([...(decision.candidateIntents ?? [decision.intent]), ...extraIntents], 6),
    toolDomains: uniqueValues([...decision.toolDomains, ...extraDomains], 10),
    suggestedCapabilityQueries: uniqueValues([
      ...(decision.suggestedCapabilityQueries ?? []),
      ...extraDomains,
    ], 10),
    continuationDomains: extraDomains,
    reason: `${decision.reason}；检测到承接上一轮任务，已并入领域 ${extraDomains.join('、')}`,
  }
}

interface DeterministicRule {
  intent: AgentIntent
  matches: (goal: string) => boolean
  toolDomains?: AgentToolDomain[]
}

const routePolicy: Record<AgentIntent, Pick<AgentRouteDecision, 'path' | 'toolDomains'>> = {
  navigate: { path: 'workflow', toolDomains: ['navigation'] },
  generate: { path: 'workflow', toolDomains: ['models', 'generation', 'navigation'] },
  inspect_model: { path: 'workflow', toolDomains: ['models'] },
  read_generation: { path: 'workflow', toolDomains: ['generation'] },
  cancel_generation: { path: 'workflow', toolDomains: ['generation'] },
  diagnose: { path: 'workflow', toolDomains: ['diagnostics'] },
  canvas: { path: 'workflow', toolDomains: ['canvas'] },
  toolbox: { path: 'workflow', toolDomains: ['toolbox'] },
  camera_stage: { path: 'workflow', toolDomains: ['toolbox', 'camera_stage'] },
  storyboard: { path: 'workflow', toolDomains: ['storyboard'] },
  image_edit: { path: 'workflow', toolDomains: ['toolbox', 'image_edit', 'assets'] },
  assets: { path: 'workflow', toolDomains: ['assets'] },
  workflow: { path: 'workflow', toolDomains: ['workflows'] },
  user_instructions: { path: 'workflow', toolDomains: ['user_instructions'] },
  memory: { path: 'workflow', toolDomains: ['memory'] },
  settings: { path: 'workflow', toolDomains: ['settings', 'navigation'] },
  general: { path: 'primary', toolDomains: ['catalog'] },
}

function uniqueValues<TValue extends string>(values: TValue[], limit: number): TValue[] {
  return [...new Set(values)].slice(0, limit)
}

function selectEnumValues<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  limit: number
): TValue[] {
  if (!Array.isArray(value)) return []
  const allowedValues = new Set<string>(allowed)
  return uniqueValues(value.filter((item): item is TValue => (
    typeof item === 'string' && allowedValues.has(item)
  )), limit)
}

function selectComplexity(value: unknown): AgentRouteDecision['complexity'] {
  return value === 'simple' || value === 'multi_step' || value === 'ambiguous' ? value : 'ambiguous'
}

function selectReason(value: unknown, intent: AgentIntent): string {
  if (typeof value !== 'string') return `路由模型判断为 ${intent} 任务`
  const normalized = value.trim().slice(0, 500)
  return normalized || `路由模型判断为 ${intent} 任务`
}

function resolveCandidateDomains(
  intent: AgentIntent,
  candidateIntents: AgentIntent[],
  requestedDomains: AgentToolDomain[]
): AgentToolDomain[] {
  return uniqueValues([
    ...routePolicy[intent].toolDomains,
    ...candidateIntents.flatMap((candidate) => routePolicy[candidate].toolDomains),
    ...requestedDomains,
  ], 8)
}

const taskIdPattern = /\btask-[a-z0-9-]+\b/i
const cancelGenerationPattern = /(?:取消|停止|终止|cancel|stop).{0,24}\btask-[a-z0-9-]+\b/i
const readGenerationPattern = /(?:查看|查询|状态|进度|status|progress).{0,24}\btask-[a-z0-9-]+\b|\btask-[a-z0-9-]+\b.{0,24}(?:查看|查询|状态|进度|status|progress)/i

function asksForAssistantCapabilityOverview(goal: string): boolean {
  const normalized = goal.normalize('NFKC').trim().toLowerCase()
  if (!normalized || normalized.length > 80) return false
  const referencesAssistant = /(?:^|[\s，。！？,.!?])(?:你|智能助手|助手|痕迹\s*ai|这个应用|本应用|应用)(?:[\s，。！？,.!?]|$)/i.test(normalized)
    || /^(?:你|智能助手|助手|痕迹\s*ai|这个应用|本应用|应用)/i.test(normalized)
  const asksCapability = /(?:能|会|可以)(?:帮我)?(?:做什么|做啥|干什么|干啥|做哪些事)|(?:有什么|有哪些)(?:能力|功能)|支持(?:什么|哪些)(?:能力|功能|事情)?/i.test(normalized)
    || /what can you do|what (?:can|does) (?:the )?(?:assistant|app) do|your capabilities/i.test(normalized)
  return referencesAssistant && asksCapability
}

function regexMatcher(pattern: RegExp): (goal: string) => boolean {
  return (goal) => pattern.test(goal)
}

function asksToGenerateMedia(goal: string): boolean {
  return /(?:生成|制作|创作|画|create|generate).{0,24}(?:图片|图像|照片|视频|音频|音乐|语音|image|video|audio)/i.test(goal)
    && !/(?:历史|记录|状态|进度|取消|停止)/i.test(goal)
}

function asksToInspectModel(goal: string): boolean {
  return /(?:查找|搜索|查看|查询|比较|推荐).{0,20}(?:模型|model)|(?:模型|model).{0,20}(?:参数|价格|能力|支持)/i.test(goal)
}

function asksForCanvasAction(goal: string): boolean {
  return /(?:画布|canvas).{0,24}(?:节点|连线|项目|布局)|(?:节点|连线).{0,24}(?:画布|canvas)/i.test(goal)
    && !/(?:画布工作区|canvas workspace)/i.test(goal)
}

const deterministicRules: DeterministicRule[] = [
  { intent: 'cancel_generation', matches: regexMatcher(cancelGenerationPattern) },
  { intent: 'generate', matches: asksToGenerateMedia },
  { intent: 'inspect_model', matches: asksToInspectModel },
  { intent: 'canvas', matches: asksForCanvasAction },
  { intent: 'assets', matches: regexMatcher(/(?:素材库|asset library).{0,24}(?:查询|查看|标签|集合|选择|删除|移除)|(?:查询|查看|选择|删除|移除).{0,24}(?:素材库|asset library)/i) },
  { intent: 'workflow', matches: regexMatcher(/(?:工作流|workflow)/i) },
  { intent: 'memory', matches: regexMatcher(/(?:助手记忆|长期记忆|记住这|忘记这|agent memory)/i) },
  { intent: 'toolbox', matches: regexMatcher(/(?:工具箱|toolbox).{0,16}(?:有什么|状态|工具)/i) },
  { intent: 'storyboard', matches: regexMatcher(/(?:分镜项目|storyboard)/i) },
  {
    intent: 'general',
    matches: asksForAssistantCapabilityOverview,
    toolDomains: [],
  },
  {
    intent: 'user_instructions',
    matches: regexMatcher(/(?:用户指令|助手指令|user instructions?)/i),
  },
  { intent: 'navigate', matches: regexMatcher(/(?:切换|打开|进入).{0,10}(?:工作区|画布工作区|素材库工作区|工具箱工作区)|(?:switch|open).{0,10}workspace/i) },
  { intent: 'read_generation', matches: (goal) => taskIdPattern.test(goal) && readGenerationPattern.test(goal) },
]

function deterministicRoute(
  goal: string,
  snapshot: HostContextSnapshot
): AgentRouteDecision | null {
  const normalized = goal.normalize('NFKC')
  const composite = createDeterministicTaskGraph(goal, snapshot)
  if (composite) {
    const intent = composite.intents.includes('camera_stage')
      ? 'camera_stage'
      : composite.intents.includes('canvas') ? 'canvas' : composite.intents[0] ?? 'general'
    const toolDomains = uniqueValues([
      ...composite.intents.flatMap((candidate) => routePolicy[candidate].toolDomains),
      ...composite.domains,
      'catalog',
    ], 8)
    return {
      routeVersion: 'agent-route/v2',
      intent,
      candidateIntents: composite.intents,
      complexity: 'multi_step',
      path: 'workflow',
      toolDomains,
      source: 'deterministic',
      reason: `识别为 ${composite.graph.facets.length} 个有依赖的跨领域任务 Facet`,
      anchorSurfaceId: snapshot.surface?.id,
      taskFacets: composite.graph.facets.map((facet) => facet.facetId),
      suggestedCapabilityQueries: composite.graph.facets.map((facet) => facet.domain),
      taskGraph: composite.graph,
    }
  }
  if (
    snapshot.surface?.id === 'workspace.generation'
    && /(?:最后|最近|上一)(?:一张|一个|条)|生成历史|历史记录/i.test(normalized)
  ) {
    return {
      routeVersion: 'agent-route/v2',
      intent: 'read_generation',
      candidateIntents: ['read_generation', 'image_edit'],
      complexity: /(?:编辑|标注|裁剪|旋转|文字|矩形)/i.test(normalized) ? 'multi_step' : 'simple',
      path: 'workflow',
      toolDomains: ['generation', 'image_edit', 'catalog'],
      source: 'deterministic',
      reason: '当前生成页面中的相对指代锚定生成历史',
      anchorSurfaceId: snapshot.surface.id,
      taskFacets: ['current_surface', 'generation_history'],
      suggestedCapabilityQueries: ['最近成功生成结果', '图片编辑'],
      taskGraph: createSingleFacetTaskGraph({
        goal,
        facetId: 'generation_history',
        domain: 'generation',
        targetSurfaceId: snapshot.surface.id,
        capabilityKinds: ['observe', 'query'],
        effect: 'observe',
        entityTypes: ['generation.record', 'generation.result'],
        completionCondition: '返回目标生成记录或明确说明没有符合条件的记录。',
      }),
    }
  }
  if (/(?:设置|偏好|毛玻璃|主题|圆角|启动页面|上传服务)/i.test(normalized)) {
    const taskSemantics = inferIntentTaskSemantics('settings', goal)
    return {
      routeVersion: 'agent-route/v2',
      intent: 'settings',
      candidateIntents: ['settings'],
      complexity: /(?:并且|同时|批量|以及)/i.test(normalized) ? 'multi_step' : 'simple',
      path: 'workflow',
      toolDomains: ['settings', 'navigation', 'catalog'],
      source: 'deterministic',
      reason: '识别为应用设置查询或修改',
      anchorSurfaceId: snapshot.surface?.id,
      taskFacets: ['settings'],
      suggestedCapabilityQueries: ['应用设置'],
      taskGraph: createSingleFacetTaskGraph({
        goal,
        facetId: 'settings',
        domain: 'settings',
        targetSurfaceId: snapshot.surface?.id,
        capabilityKinds: taskSemantics.capabilityKinds,
        effect: taskSemantics.effect,
        entityTypes: taskSemantics.entityTypes,
        completionCondition: '设置读取或变更结果包含稳定设置 ID 与 revision。',
      }),
    }
  }
  if (/(?:图片编辑|矩形标注|文字标注|裁剪图片|旋转图片)/i.test(normalized)) {
    const taskSemantics = inferIntentTaskSemantics('image_edit', goal)
    return {
      routeVersion: 'agent-route/v2',
      intent: 'image_edit',
      candidateIntents: ['image_edit'],
      complexity: 'multi_step',
      path: 'workflow',
      toolDomains: ['image_edit', 'generation', 'assets', 'catalog'],
      source: 'deterministic',
      reason: '识别为图片编辑任务',
      anchorSurfaceId: snapshot.surface?.id,
      taskFacets: ['image_edit'],
      suggestedCapabilityQueries: ['图片编辑 来源引用'],
      taskGraph: createSingleFacetTaskGraph({
        goal,
        facetId: 'image_edit',
        domain: 'image_edit',
        targetSurfaceId: 'tool.image_edit',
        capabilityKinds: taskSemantics.capabilityKinds,
        effect: taskSemantics.effect,
        entityTypes: taskSemantics.entityTypes,
        completionCondition: '返回图片编辑会话或预览稳定引用及 revision。',
      }),
    }
  }
  const matches = deterministicRules.filter((rule) => rule.matches(goal))
  if (matches.length !== 1) return null
    const [match] = matches
  const taskSemantics = inferIntentTaskSemantics(match.intent, goal)
  return {
    routeVersion: 'agent-route/v2',
    intent: match.intent,
    candidateIntents: [match.intent],
    complexity: 'simple',
    path: routePolicy[match.intent].path,
    toolDomains: match.toolDomains ?? routePolicy[match.intent].toolDomains,
    source: 'deterministic',
    reason: `命中确定性 ${match.intent} 规则`,
    anchorSurfaceId: snapshot.surface?.id,
    taskFacets: [match.intent],
    suggestedCapabilityQueries: match.toolDomains ?? routePolicy[match.intent].toolDomains,
    taskGraph: createSingleFacetTaskGraph({
      goal,
      facetId: match.intent,
      domain: (match.toolDomains ?? routePolicy[match.intent].toolDomains)[0] ?? 'catalog',
      targetSurfaceId: snapshot.surface?.id,
      capabilityKinds: taskSemantics.capabilityKinds,
      effect: taskSemantics.effect,
      entityTypes: taskSemantics.entityTypes,
      verificationRequired: match.intent === 'generate',
      completionCondition: match.intent === 'general'
        ? '直接回答用户问题且不声称执行未发生的动作。'
        : '目标动作具有结构化结果或明确的受阻说明。',
    }),
  }
}

export class AgentIntentRouter {
  constructor(private readonly classifyWithModel?: RouterModelClassifier) {}

  async route(
    runId: string,
    goal: string,
    snapshot: HostContextSnapshot,
    signal: AbortSignal,
    continuation: AgentThreadContinuation | null = null
  ): Promise<AgentRouteDecision> {
    const widen = (decision: AgentRouteDecision): AgentRouteDecision => (
      widenWithContinuation(decision, goal, continuation)
    )
    const deterministic = deterministicRoute(goal, snapshot)
    if (deterministic && (deterministic.complexity !== 'multi_step' || !this.classifyWithModel)) {
      const decision = widen(deterministic)
      this.logDecision(runId, decision)
      return decision
    }
    if (this.classifyWithModel) {
      try {
        const classified = routerModelDecisionSchema.parse(await this.classifyWithModel(
          goal,
          snapshot,
          signal,
          describeContinuationForRouter(continuation)
        ))
        const candidateIntents = selectEnumValues(classified.candidateIntents, AGENT_INTENTS, 4)
        const requestedDomains = selectEnumValues(classified.toolDomains, AGENT_TOOL_DOMAINS, 6)
        if (deterministic) {
          const candidatePlan = tryCreateModelTaskGraph({
            goal,
            rawFacets: classified.taskFacets,
            primaryIntent: deterministic.intent,
            candidateDomains: deterministic.toolDomains,
            snapshot,
          })
          const planned = candidatePlan && deterministic.taskGraph
            && taskGraphCoversBaseline(candidatePlan, deterministic.taskGraph)
            ? candidatePlan
            : null
          const decision = widen(planned
            ? {
                ...deterministic,
                source: 'router_model',
                reason: `${deterministic.reason}；结构化 Planner 已声明 Effect 与依赖`,
                taskGraph: planned,
                taskFacets: planned.facets.map((facet) => facet.facetId),
              }
            : deterministic)
          this.logDecision(runId, decision)
          return decision
        }
        const decision: AgentRouteDecision = {
          routeVersion: 'agent-route/v2',
          intent: classified.intent,
          candidateIntents: uniqueValues([
            classified.intent,
            ...candidateIntents,
          ], 4),
          complexity: selectComplexity(classified.complexity),
          path: routePolicy[classified.intent].path,
          toolDomains: resolveCandidateDomains(
            classified.intent,
            candidateIntents,
            requestedDomains
          ),
          source: 'router_model',
          reason: selectReason(classified.reason, classified.intent),
          anchorSurfaceId: snapshot.surface?.id,
          taskFacets: uniqueValues([
            classified.intent,
            ...candidateIntents,
          ], 6),
          suggestedCapabilityQueries: resolveCandidateDomains(
            classified.intent,
            candidateIntents,
            requestedDomains
          ),
        }
        const planned = tryCreateModelTaskGraph({
          goal,
          rawFacets: classified.taskFacets,
          primaryIntent: classified.intent,
          candidateDomains: decision.toolDomains,
          snapshot,
        })
        if (planned || classified.intent !== 'general') {
          decision.taskGraph = planned ?? createModelTaskGraph({
            goal,
            rawFacets: classified.taskFacets,
            primaryIntent: classified.intent,
            candidateDomains: decision.toolDomains,
            snapshot,
          })
          decision.taskFacets = decision.taskGraph.facets.map((facet) => facet.facetId)
        }
        const widened = widen(decision)
        this.logDecision(runId, widened)
        return widened
      } catch (error) {
        if (
          signal.aborted
          || (error instanceof Error && (
            error.name === 'AgentBudgetExceededError'
            || error.message.includes('[task_cancelled]')
          ))
        ) {
          throw error
        }
        logger.warn('Agent 路由模型分类失败，进入受控能力发现', {
          event: 'agent_router.classify.failed',
          requestId: runId,
          context: {
            errorCode: error instanceof z.ZodError ? 'ROUTER_OUTPUT_INVALID' : 'ROUTER_MODEL_FAILED',
          },
        })
      }
    }
    if (deterministic) {
      const decision = widen(deterministic)
      this.logDecision(runId, decision)
      return decision
    }
    const fallback: AgentRouteDecision = {
      routeVersion: 'agent-route/v2',
      intent: 'general',
      candidateIntents: ['general'],
      complexity: 'ambiguous',
      path: 'primary',
      toolDomains: ['catalog'],
      source: 'fallback',
      reason: '确定性规则未命中，router 不可用或分类失败',
      anchorSurfaceId: snapshot.surface?.id,
      taskFacets: ['ambiguous'],
      suggestedCapabilityQueries: ['当前页面相关能力'],
      taskGraph: createSingleFacetTaskGraph({
        goal,
        facetId: 'clarify_goal',
        domain: 'catalog',
        targetSurfaceId: snapshot.surface?.id,
        capabilityKinds: ['query'],
        completionCondition: '向用户提出一个最小澄清问题，或明确说明不支持的边界。',
        uncertainty: '确定性规则和路由模型均未形成可信任务分解。',
      }),
    }
    const widenedFallback = widen(fallback)
    this.logDecision(runId, widenedFallback)
    return widenedFallback
  }

  private logDecision(runId: string, decision: AgentRouteDecision): void {
    logger.info('Agent 意图路由完成', {
      event: 'agent_router.route.completed',
      requestId: runId,
      context: {
        intent: decision.intent,
        complexity: decision.complexity,
        path: decision.path,
        source: decision.source,
        toolDomains: decision.toolDomains,
        continuationDomains: decision.continuationDomains ?? [],
        taskFacetIds: decision.taskGraph?.facets.map((facet) => facet.facetId) ?? [],
      },
    })
  }
}
