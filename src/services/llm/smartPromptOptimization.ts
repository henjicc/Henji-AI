import type { LlmChatRequest } from '@henjicc/ai-sdk'

import { readAssistantSkill } from '@/commands/assistant'
import { llmChatStream } from '@/commands/llmRuntime'
import { createDefaultPromptProfile } from '@/core/llm/defaults'
import { createLogger } from '@/core/logging'
import {
  PROMPT_GUIDE_SKILL_NAME,
  buildPromptGuideRoutingMessages,
  buildSmartOptimizationSystemPrompt,
  extractCommonPromptRules,
  needsPromptGuideRouting,
  parsePromptGuideRoutingAnswer,
  promptGuidePath,
  resolvePromptGuideCandidates,
  type PromptGuideId,
  type PromptGuideRoutingInput,
} from '@/core/llm/promptGuideRouting'

const logger = createLogger('services.llm.smartPromptOptimization')

export interface SmartPromptOptimizationPlan {
  systemPrompt: string
  guides: PromptGuideId[]
  /** 是否花了一次模型调用来选指南 */
  routed: boolean
}

export interface SmartPromptOptimizationInput extends PromptGuideRoutingInput {
  prompt: string
  modelName?: string
  mediaSummary: string
  /** 选指南用的请求底稿：与优化同一个模型，不带素材、不开思考 */
  routingRequest: Omit<LlmChatRequest, 'messages' | 'requestId'>
  /** 取消优化时中止选指南的调用 */
  signal?: AbortSignal
}

/** 一次不需要流式展示的短调用，收齐文字后返回 */
async function collectChatText(request: LlmChatRequest, signal?: AbortSignal): Promise<string> {
  let text = ''
  let failure: string | null = null
  await llmChatStream(request, (event) => {
    if (event.type === 'Token') text += event.data
    else if (event.type === 'Error') failure = event.data
  }, { category: 'generation', titleKey: 'paidApproval.generateText', signal })
  if (failure) throw new Error(failure)
  return text
}

/**
 * 智能优化：先判断该按哪份指南写，再把通用写法与选中的指南组成系统提示词。
 * 指南直接读助手技能 prompt-optimization，用户覆盖了同名技能时也随之生效。
 * 选指南的那次调用失败不挡优化，回退到第一个基础模式。
 */
export async function planSmartPromptOptimization(input: SmartPromptOptimizationInput): Promise<SmartPromptOptimizationPlan> {
  const candidates = resolvePromptGuideCandidates(input)
  let guides: PromptGuideId[] = candidates.base.slice(0, 1)
  let routed = false
  if (needsPromptGuideRouting(candidates, input.prompt)) {
    const messages = buildPromptGuideRoutingMessages(candidates, {
      prompt: input.prompt,
      modelName: input.modelName,
      modelType: input.modelType,
      mediaSummary: input.mediaSummary,
    })
    try {
      const answer = await collectChatText({
        ...input.routingRequest,
        requestId: `prompt-guide-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        messages: [{ role: 'system', content: messages.system }, { role: 'user', content: messages.user }],
      }, input.signal)
      guides = parsePromptGuideRoutingAnswer(answer, candidates)
      routed = true
    } catch (error) {
      if (input.signal?.aborted) throw error
      logger.warn('选择提示词指南失败，按第一个基础模式优化', {
        event: 'prompt_optimization.smart.route_failed',
        context: { candidates: candidates.base, error: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  let skillTexts: { main: string; guides: string[] }
  try {
    const [main, ...guideFiles] = await Promise.all([
      readAssistantSkill({ name: PROMPT_GUIDE_SKILL_NAME }),
      ...guides.map((id) => readAssistantSkill({ name: PROMPT_GUIDE_SKILL_NAME, path: promptGuidePath(id) })),
    ])
    skillTexts = { main: main.content, guides: guideFiles.map((file) => file.content) }
  } catch (error) {
    // 技能被停用、被覆盖成缺文件的版本或不受信任时，优化照常可用：退回内置的通用优化规则
    logger.warn('读取提示词写作指南失败，改用内置通用规则', {
      event: 'prompt_optimization.smart.guide_unavailable',
      context: { guides, error: error instanceof Error ? error.message : String(error) },
    })
    return { systemPrompt: createDefaultPromptProfile().systemPrompt, guides: [], routed }
  }
  const commonRules = extractCommonPromptRules(skillTexts.main)
  if (!commonRules) {
    logger.warn('技能主文件缺少通用写法一节，只按选中的指南优化', { event: 'prompt_optimization.smart.common_rules_missing' })
  }
  logger.info('智能优化已选定指南', {
    event: 'prompt_optimization.smart.planned',
    context: { modelType: input.modelType, candidates: candidates.base, guides, routed },
  })
  return { systemPrompt: buildSmartOptimizationSystemPrompt(commonRules, skillTexts.guides), guides, routed }
}
