import { z } from 'zod'

import { createMainLogger } from '../../logging'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentIntent, AgentRouteDecision } from './types'

const logger = createMainLogger('main.agent_router')

const routerModelDecisionSchema = z.object({
  intent: z.enum(['navigate', 'generate', 'inspect_model', 'read_generation', 'cancel_generation', 'diagnose', 'general']),
  complexity: z.enum(['simple', 'multi_step', 'ambiguous']),
  path: z.enum(['workflow', 'primary']),
  toolDomains: z.array(z.string().min(1)).max(4),
  reason: z.string().min(1).max(500),
}).strict()

export type RouterModelClassifier = (
  goal: string,
  snapshot: HostContextSnapshot,
  signal: AbortSignal
) => Promise<unknown>

interface DeterministicRule {
  intent: AgentIntent
  pattern: RegExp
  toolDomains: string[]
}

const deterministicRules: DeterministicRule[] = [
  { intent: 'cancel_generation', pattern: /(?:取消|停止|终止).{0,12}(?:生成|任务)|cancel.{0,12}(?:generation|task)/i, toolDomains: ['generation'] },
  { intent: 'diagnose', pattern: /(?:诊断|日志|报错|错误原因|排查)|diagnos|logs?|error/i, toolDomains: ['diagnostics'] },
  { intent: 'navigate', pattern: /(?:切换|打开|进入).{0,10}(?:工作区|画布|素材库|工具箱)|(?:switch|open).{0,10}workspace/i, toolDomains: ['navigation'] },
  { intent: 'read_generation', pattern: /(?:查看|查询).{0,10}(?:生成任务|任务状态)|generation task status/i, toolDomains: ['generation'] },
  { intent: 'inspect_model', pattern: /(?:模型参数|模型结构|查找模型|搜索模型)|model (?:schema|catalog|search)/i, toolDomains: ['models'] },
  { intent: 'generate', pattern: /(?:生成|制作|创建).{0,12}(?:图片|视频|音频|图像)|generate.{0,12}(?:image|video|audio)/i, toolDomains: ['models', 'generation'] },
]

function deterministicRoute(goal: string): AgentRouteDecision | null {
  const matches = deterministicRules.filter((rule) => rule.pattern.test(goal))
  if (matches.length !== 1) return null
  const [match] = matches
  return {
    intent: match.intent,
    complexity: 'simple',
    path: 'workflow',
    toolDomains: match.toolDomains,
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
        const decision: AgentRouteDecision = { ...classified, source: 'router_model' }
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
        // router 失败时按设计保守进入 primary，不把原始目标写入日志。
      }
    }
    const fallback: AgentRouteDecision = {
      intent: 'general',
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
