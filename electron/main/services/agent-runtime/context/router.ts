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
  candidateIntents: z.array(z.enum(AGENT_INTENTS)).max(4).optional().default([]),
  toolDomains: z.array(z.enum(AGENT_TOOL_DOMAINS)).max(6).optional().default([]),
  complexity: z.enum(['simple', 'multi_step', 'ambiguous']).optional().default('ambiguous'),
  reason: z.string().min(1).max(500).optional(),
}).passthrough()

export type RouterModelClassifier = (
  goal: string,
  snapshot: HostContextSnapshot,
  signal: AbortSignal
) => Promise<unknown>

interface DeterministicRule {
  intent: AgentIntent
  matches: (goal: string) => boolean
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
  general: { path: 'primary', toolDomains: ['catalog'] },
}

function uniqueValues<TValue extends string>(values: TValue[], limit: number): TValue[] {
  return [...new Set(values)].slice(0, limit)
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

function regexMatcher(pattern: RegExp): (goal: string) => boolean {
  return (goal) => pattern.test(goal)
}

const deterministicRules: DeterministicRule[] = [
  { intent: 'cancel_generation', matches: regexMatcher(cancelGenerationPattern) },
  {
    intent: 'user_instructions',
    matches: regexMatcher(/(?:用户指令|助手指令|user instructions?)/i),
  },
  { intent: 'navigate', matches: regexMatcher(/(?:切换|打开|进入).{0,10}(?:工作区|画布工作区|素材库工作区|工具箱工作区)|(?:switch|open).{0,10}workspace/i) },
  { intent: 'read_generation', matches: (goal) => taskIdPattern.test(goal) && readGenerationPattern.test(goal) },
]

function deterministicRoute(goal: string): AgentRouteDecision | null {
  const matches = deterministicRules.filter((rule) => rule.matches(goal))
  if (matches.length !== 1) return null
  const [match] = matches
  return {
    intent: match.intent,
    candidateIntents: [match.intent],
    complexity: 'simple',
    ...routePolicy[match.intent],
    source: 'deterministic',
    reason: `命中确定性 ${match.intent} 规则`,
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
    const deterministic = deterministicRoute(goal)
    if (deterministic) {
      this.logDecision(runId, deterministic)
      return deterministic
    }
    if (this.classifyWithModel) {
      try {
        const classified = routerModelDecisionSchema.parse(await this.classifyWithModel(goal, snapshot, signal))
        const decision: AgentRouteDecision = {
          intent: classified.intent,
          candidateIntents: uniqueValues([
            classified.intent,
            ...classified.candidateIntents,
          ], 4),
          complexity: classified.complexity,
          path: routePolicy[classified.intent].path,
          toolDomains: resolveCandidateDomains(
            classified.intent,
            classified.candidateIntents,
            classified.toolDomains
          ),
          source: 'router_model',
          reason: classified.reason?.trim() || `路由模型判断为 ${classified.intent} 任务`,
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
