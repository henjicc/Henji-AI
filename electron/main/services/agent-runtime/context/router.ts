import { z } from 'zod'

import { createMainLogger } from '../../logging'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import {
  AGENT_INTENTS,
  AGENT_TOOL_DOMAINS,
  type AgentIntent,
  type AgentRouteDecision,
  type AgentToolDomain,
} from './types'

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
  signal: AbortSignal
) => Promise<unknown>

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

const deterministicRules: DeterministicRule[] = [
  { intent: 'cancel_generation', matches: regexMatcher(cancelGenerationPattern) },
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
  if (
    snapshot.surface?.id === 'workspace.generation'
    && /(?:最后|最近|上一)(?:一张|一个|条)|生成历史|历史记录/i.test(normalized)
  ) {
    return {
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
    }
  }
  if (/(?:设置|偏好|毛玻璃|主题|圆角|启动页面|上传服务)/i.test(normalized)) {
    return {
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
    }
  }
  if (/(?:图片编辑|矩形标注|文字标注|裁剪图片|旋转图片)/i.test(normalized)) {
    return {
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
    }
  }
  const matches = deterministicRules.filter((rule) => rule.matches(goal))
  if (matches.length !== 1) return null
  const [match] = matches
  return {
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
  }
}

export class AgentIntentRouter {
  constructor(private readonly classifyWithModel?: RouterModelClassifier) {}

  async route(
    runId: string,
    goal: string,
    snapshot: HostContextSnapshot,
    signal: AbortSignal
  ): Promise<AgentRouteDecision> {
    const deterministic = deterministicRoute(goal, snapshot)
    if (deterministic) {
      this.logDecision(runId, deterministic)
      return deterministic
    }
    if (this.classifyWithModel) {
      try {
        const classified = routerModelDecisionSchema.parse(await this.classifyWithModel(goal, snapshot, signal))
        const candidateIntents = selectEnumValues(classified.candidateIntents, AGENT_INTENTS, 4)
        const requestedDomains = selectEnumValues(classified.toolDomains, AGENT_TOOL_DOMAINS, 6)
        const decision: AgentRouteDecision = {
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
        this.logDecision(runId, decision)
        return decision
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
    const fallback: AgentRouteDecision = {
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
    }
    this.logDecision(runId, fallback)
    return fallback
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
      },
    })
  }
}
