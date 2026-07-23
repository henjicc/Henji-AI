import { z } from 'zod'

import { createMainLogger } from '../../logging'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentIntent, AgentRouteDecision } from './types'

const logger = createMainLogger('main.agent_router')

const routerModelDecisionSchema = z.object({
  intent: z.enum(['navigate', 'generate', 'inspect_model', 'read_generation', 'cancel_generation', 'diagnose', 'canvas', 'user_instructions', 'general']),
  complexity: z.enum(['simple', 'multi_step', 'ambiguous']),
  reason: z.string().min(1).max(500),
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
  user_instructions: { path: 'workflow', toolDomains: ['user_instructions'] },
  general: { path: 'primary', toolDomains: ['catalog'] },
}

const cancelGenerationPattern = /(?:取消|停止|终止).{0,12}(?:生成|任务)|cancel.{0,12}(?:generation|task)/i
const generationActionPattern = /(?:生成|制作|创建|创作|绘制|画出|渲染)|(?:generate|create|make|draw|render)/i
const generationMediaPattern = /(?:图片|图像|照片|相片|插画|海报|头像|壁纸|封面|图标|视频|短片|动画|影片|音频|音乐|歌曲|配音|语音|音效|logo)|(?:image|picture|photo|video|animation|audio|music|song|voice)/i

function regexMatcher(pattern: RegExp): (goal: string) => boolean {
  return (goal) => pattern.test(goal)
}

function matchesGenerationRequest(goal: string): boolean {
  return !cancelGenerationPattern.test(goal)
    && generationActionPattern.test(goal)
    && generationMediaPattern.test(goal)
}

const deterministicRules: DeterministicRule[] = [
  { intent: 'cancel_generation', matches: regexMatcher(cancelGenerationPattern) },
  {
    intent: 'user_instructions',
    matches: regexMatcher(/(?:(?:记住|以后|默认|偏好|优先|避免|不要用).{0,40}(?:供应商|模型|ppio|fal|kie|modelscope|回答|回复|解释|格式|风格))|(?:(?:供应商|模型|ppio|fal|kie|modelscope|回答|回复|解释|格式|风格).{0,40}(?:记住|以后|默认|偏好|优先|避免|不要用))|(?:(?:查看|修改|更新|保存|清空).{0,12}(?:用户|助手)?指令)|user instructions?|model preferences?/i),
  },
  { intent: 'diagnose', matches: regexMatcher(/(?:诊断|日志|报错|错误原因|排查)|diagnos|logs?|error/i) },
  { intent: 'canvas', matches: regexMatcher(/(?:画布|节点).{0,24}(?:添加|放置|连接|定位|高亮|撤销)|(?:添加|放置|连接|定位|高亮|撤销).{0,24}(?:画布|节点)|canvas.{0,24}(?:node|connect|focus|undo)/i) },
  { intent: 'navigate', matches: regexMatcher(/(?:切换|打开|进入).{0,10}(?:工作区|画布|素材库|工具箱)|(?:switch|open).{0,10}workspace/i) },
  { intent: 'read_generation', matches: regexMatcher(/(?:查看|查询).{0,10}(?:生成任务|任务状态)|generation task status/i) },
  { intent: 'inspect_model', matches: regexMatcher(/(?:模型参数|模型结构|查找模型|搜索模型)|model (?:schema|catalog|search)/i) },
  { intent: 'generate', matches: matchesGenerationRequest },
]

function deterministicRoute(goal: string): AgentRouteDecision | null {
  const matches = deterministicRules.filter((rule) => rule.matches(goal))
  if (matches.length !== 1) return null
  const [match] = matches
  return {
    intent: match.intent,
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
          complexity: classified.complexity,
          ...routePolicy[classified.intent],
          source: 'router_model',
          reason: classified.reason,
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
