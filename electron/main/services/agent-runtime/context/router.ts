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
  tryCreateModelTaskGraph,
} from './task-facets'
import { asksToGenerateMedia, hasAffirmativeIntent, inferIntentTaskSemantics } from './task-intent-semantics'
import {
  continuationDomains,
  describeContinuationForRouter,
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
}).passthrough()

export type RouterModelClassifier = (
  goal: string,
  snapshot: HostContextSnapshot,
  signal: AbortSignal,
  continuation?: string | null
) => Promise<unknown>

/**
 * 只要同线程有历史证据，就无条件把上一轮的领域并进 toolDomains。
 *
 * 这里以前挂着三条中文正则来判"这句话算不算承接"：句首的「再/还/继续/接着」、一张
 * 「不对/没成功/怎么回事/重来」的不满词表，外加 30 字符长度上限。方向从一开始就是错的——
 * 用户表达不满时的原话恰恰最短、最没有信息量、最不可能被词表穷尽，而那正是最需要承接的时候。
 * 实测连着三次都栽在这里：「再帮我添加一个白色的球体」判成 generate、「你这不对吧」判成
 * diagnose、「你继续」判成 canvas，上一轮三次都在 camera_stage。
 *
 * 放宽的代价很小：toolDomains 只影响能力发现的候选排序与至多 4 个锚点工具，真正的准入仍由
 * registry.list(context) 和审批把关。收窄的代价是整次运行没有出口。所以不再判断，直接并集。
 */
function widenWithContinuation(
  decision: AgentRouteDecision,
  continuation: AgentThreadContinuation | null
): AgentRouteDecision {
  if (!continuation) return decision
  const extraDomains = continuationDomains(continuation)
    .filter((domain) => !decision.toolDomains.includes(domain))
  if (extraDomains.length === 0) return decision
  return {
    ...decision,
    toolDomains: uniqueValues([...decision.toolDomains, ...extraDomains], 10),
    continuationDomains: extraDomains,
    reason: `${decision.reason}；同线程存在上一轮任务，已并入领域 ${extraDomains.join('、')}`,
  }
}


interface DeterministicRule {
  intent: AgentIntent
  matches: (goal: string) => boolean
  toolDomains?: AgentToolDomain[]
}

const routePolicy: Record<AgentIntent, Pick<AgentRouteDecision, 'toolDomains'>> = {
  navigate: { toolDomains: ['navigation'] },
  generate: { toolDomains: ['models', 'generation', 'navigation'] },
  inspect_model: { toolDomains: ['models'] },
  read_generation: { toolDomains: ['generation'] },
  cancel_generation: { toolDomains: ['generation'] },
  diagnose: { toolDomains: ['diagnostics'] },
  canvas: { toolDomains: ['canvas'] },
  toolbox: { toolDomains: ['toolbox'] },
  camera_stage: { toolDomains: ['toolbox', 'camera_stage'] },
  storyboard: { toolDomains: ['storyboard'] },
  image_edit: { toolDomains: ['toolbox', 'image_edit', 'assets'] },
  assets: { toolDomains: ['assets'] },
  workflow: { toolDomains: ['workflows'] },
  user_instructions: { toolDomains: ['user_instructions'] },
  memory: { toolDomains: ['memory'] },
  settings: { toolDomains: ['settings', 'navigation'] },
  general: { toolDomains: ['catalog'] },
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
  { intent: 'assets', matches: (goal) => (
    /(?:素材库|素材集合|素材集|asset (?:library|collection))/i.test(goal)
    && hasAffirmativeIntent(goal, /(?:创建|新建|改名|重命名|查询|查看|标签|集合|选择|删除|移除)/i)
  ) },
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
      intent,
      complexity: 'multi_step',
      toolDomains,
      reason: `识别为 ${composite.graph.facets.length} 个有依赖的跨领域任务 Facet`,
      explicitUserIntent: true,
      taskGraph: composite.graph,
    }
  }
  if (
    snapshot.surface?.id === 'workspace.generation'
    && !asksToGenerateMedia(normalized)
    && /(?:最后|最近|上一)(?:一张|一个|条)|生成历史|历史记录/i.test(normalized)
  ) {
    return {
      intent: 'read_generation',
      complexity: /(?:编辑|标注|裁剪|旋转|文字|矩形)/i.test(normalized) ? 'multi_step' : 'simple',
      toolDomains: ['generation', 'image_edit', 'catalog'],
      reason: '当前生成页面中的相对指代锚定生成历史',
      explicitUserIntent: true,
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
  if (
    /(?:设置|偏好|毛玻璃|主题|圆角|启动页面|上传服务)/i.test(normalized)
    || /\b(?:general|interface|storage)\.[a-z][a-z0-9_.-]*/i.test(normalized)
  ) {
    const taskSemantics = inferIntentTaskSemantics('settings', goal)
    const restoresOriginalValue = taskSemantics.effect === 'update'
      && /(?:恢复|还原|改回|切回|restore|revert).{0,12}(?:原值|原来|之前|original|previous)|(?:原值|原来|之前).{0,12}(?:恢复|还原|改回|切回)/i.test(normalized)
    return {
      intent: 'settings',
      complexity: /(?:并且|同时|批量|以及)/i.test(normalized) ? 'multi_step' : 'simple',
      toolDomains: ['settings', 'navigation', 'catalog'],
      reason: '识别为应用设置查询或修改',
      explicitUserIntent: true,
      taskGraph: createSingleFacetTaskGraph({
        goal,
        facetId: 'settings',
        domain: 'settings',
        targetSurfaceId: snapshot.surface?.id,
        capabilityKinds: taskSemantics.capabilityKinds,
        effect: taskSemantics.effect,
        entityTypes: taskSemantics.entityTypes,
        minimumCount: restoresOriginalValue ? 2 : 1,
        verificationRequired: taskSemantics.effect === 'update',
        completionCondition: '设置读取或变更结果包含稳定设置 ID 与 revision。',
      }),
    }
  }
  if (/(?:图片编辑|矩形标注|文字标注|裁剪图片|旋转图片)/i.test(normalized)) {
    const taskSemantics = inferIntentTaskSemantics('image_edit', goal)
    return {
      intent: 'image_edit',
      complexity: 'multi_step',
      toolDomains: ['image_edit', 'generation', 'assets', 'catalog'],
      reason: '识别为图片编辑任务',
      explicitUserIntent: true,
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
  // “生成一张图，并选择/查看合适模型”同时命中 generate 与 inspect_model 时，主动作必须优先。
  // inspect_model 只是生成链路的前置查询，不能把真正的写入任务降级成纯读。
  const generationMatch = matches.find((rule) => rule.intent === 'generate')
  if (generationMatch) matches.splice(0, matches.length, generationMatch)
  if (matches.length !== 1) return null
  const [match] = matches
  const taskSemantics = inferIntentTaskSemantics(match.intent, goal)
  return {
    intent: match.intent,
    complexity: 'simple',
    toolDomains: match.toolDomains ?? routePolicy[match.intent].toolDomains,
    reason: `命中确定性 ${match.intent} 规则`,
    // 能力概览规则（intent=general，toolDomains 为空）只是回答"你能做什么"，不是应用任务，
    // 不发放 R1 写工具的自动放行位；其余确定性规则都命中了一个具体动作。
    explicitUserIntent: match.intent !== 'general',
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
      widenWithContinuation(decision, continuation)
    )
    const deterministic = deterministicRoute(goal, snapshot)
    /*
     * 确定性任务图已经把领域、Effect、依赖与验证闭环全部声明完时，直接进入执行层。
     *
     * 旧实现仍会让 router 模型“润色” multi_step 图。真实 Camera Stage 运行中，本地图在
     * 1ms 内已正确生成，router 却按主模型的 60s × 4 次重试等待了 254 秒，最终超时后仍然
     * 回退到原图——整段调用没有提供任何执行信息。开放性目标仍走模型路由；这里只短路已经
     * 由本地可验证规则完整覆盖的目标，因此不缩小能力范围，也不改变权限判断。
     */
    if (deterministic) {
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
        const decision: AgentRouteDecision = {
          intent: classified.intent,
          complexity: selectComplexity(classified.complexity),
          toolDomains: resolveCandidateDomains(
            classified.intent,
            candidateIntents,
            requestedDomains
          ),
          reason: selectReason(classified.reason, classified.intent),
          // 路由模型判成 general 说明它没识别出具体应用任务；此时不发放 R1 写工具的自动放行位。
          explicitUserIntent: classified.intent !== 'general',
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
      intent: 'general',
      complexity: 'ambiguous',
      toolDomains: ['catalog'],
      reason: '确定性规则未命中，router 不可用或分类失败',
      // 兜底说明本轮**没有**识别出用户想做什么。此时绝不能自动放行写工具——
      // 那正好是最不该假设"用户明确要求过"的时刻。
      explicitUserIntent: false,
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
        explicitUserIntent: decision.explicitUserIntent,
        toolDomains: decision.toolDomains,
        continuationDomains: decision.continuationDomains ?? [],
        taskFacetIds: decision.taskGraph?.facets.map((facet) => facet.facetId) ?? [],
      },
    })
  }
}


