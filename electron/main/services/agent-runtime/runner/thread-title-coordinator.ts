import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import type {
  AgentThreadTitleContext,
  AgentThreadTitleStage,
  AgentThreadTitleUpdateResult,
} from '../../../../../src/core/assistant/threadTitle'
import { createMainLogger } from '../../logging'
import type { AgentRuntimeModel } from './models'
import type { AgentModelStepExecutor } from './types'

const logger = createMainLogger('main.agent_thread_title')
const titleOutputSchema = z.object({ title: z.string().min(1).max(80) }).strict()

interface AgentThreadTitleCoordinatorOptions {
  runId: string
  threadId: string
  model: AgentRuntimeModel
  runModelStep: AgentModelStepExecutor
  getContext?: (input: {
    runId: string
    threadId: string
  }) => Promise<AgentThreadTitleContext>
  updateTitle?: (input: {
    runId: string
    threadId: string
    title: string
    expectedStage: AgentThreadTitleStage
    nextStage: AgentThreadTitleStage
  }) => Promise<AgentThreadTitleUpdateResult>
}

function nextTitleStage(context: AgentThreadTitleContext): AgentThreadTitleStage | null {
  if (context.generationStage === 2) return null
  if (context.generationStage === 1) return context.userMessageCount >= 3 ? 2 : null
  if (context.userMessageCount >= 3) return 2
  return context.userMessageCount >= 1 ? 1 : null
}

export function normalizeGeneratedThreadTitle(value: string): string {
  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/^[#\s"'“”‘’`]+|[#\s"'“”‘’`。！？.!?：:；;]+$/g, '')
    .trim()
  return Array.from(normalized).slice(0, 36).join('')
}

export class AgentThreadTitleCoordinator {
  constructor(private readonly options: AgentThreadTitleCoordinatorOptions) {}

  start(): void {
    void this.refresh().catch((error: unknown) => {
      logger.warn('Agent 会话标题生成失败，保留当前标题', {
        event: 'agent_thread_title.generate.failed',
        requestId: this.options.runId,
        modelId: this.options.model.modelId,
        providerId: this.options.model.providerId,
        error,
      })
    })
  }

  async refresh(): Promise<void> {
    if (!this.options.getContext || !this.options.updateTitle) return
    const context = await this.options.getContext({
      runId: this.options.runId,
      threadId: this.options.threadId,
    })
    const nextStage = nextTitleStage(context)
    if (nextStage === null || context.userInstructions.length === 0) return

    const stepId = `thread-title:${nextStage}`
    logger.info('Agent 会话标题生成开始', {
      event: 'agent_thread_title.generate.start',
      requestId: this.options.runId,
      taskId: stepId,
      modelId: this.options.model.modelId,
      providerId: this.options.model.providerId,
      context: {
        stage: nextStage,
        userMessageCount: context.userMessageCount,
      },
    })
    const result = await this.options.runModelStep({
      requestId: `thread-title:${this.options.threadId}:${nextStage}:${randomUUID()}`,
      runId: this.options.runId,
      stepId,
      providerId: this.options.model.providerId,
      modelId: this.options.model.modelId,
      apiProtocol: this.options.model.apiProtocol,
      adapter: this.options.model.adapter,
      baseUrl: this.options.model.baseUrl,
      system: [
        '你只生成会话标题，不回答用户问题，也不执行任务。',
        '标题只概括用户想完成的事情；禁止写执行状态、停止原因、结果判断、助手能力或模型名称。',
        '中文标题使用 4 至 18 个汉字，其他语言使用 3 至 10 个词。',
        '不要使用引号、句号、冒号、Markdown 或“关于”之类的空泛前缀。',
        '若有多条用户指令，提炼贯穿多轮对话的稳定主题。',
        '输出必须严格符合 JSON schema。',
      ].join('\n'),
      messages: [{
        role: 'user',
        content: JSON.stringify({
          phase: nextStage === 1 ? 'initial' : 'refined',
          userInstructions: context.userInstructions,
        }),
      }],
      output: {
        mode: 'object',
        name: 'agent_thread_title',
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 80 },
          },
          required: ['title'],
          additionalProperties: false,
        },
      },
      capabilities: this.options.model.capabilities,
      reasoning: this.options.model.reasoning,
      settings: {
        ...this.options.model.settings,
        maxOutputTokens: Math.min(128, this.options.model.settings.maxOutputTokens),
      },
      pricing: this.options.model.pricing,
      trace: { kind: 'summarizer' },
    }, () => undefined)
    if (result.finishReason !== 'stop') {
      throw new Error(`[THREAD_TITLE_INCOMPLETE] 标题模型以 ${result.finishReason} 结束`)
    }
    const title = normalizeGeneratedThreadTitle(
      titleOutputSchema.parse(result.structuredOutput).title
    )
    if (!title) throw new Error('[THREAD_TITLE_EMPTY] 标题模型返回了空标题')

    const update = await this.options.updateTitle({
      runId: this.options.runId,
      threadId: this.options.threadId,
      title,
      expectedStage: context.generationStage,
      nextStage,
    })
    logger.info('Agent 会话标题生成完成', {
      event: 'agent_thread_title.generate.completed',
      requestId: this.options.runId,
      taskId: stepId,
      modelId: this.options.model.modelId,
      providerId: this.options.model.providerId,
      context: { stage: nextStage, updated: update.updated },
    })
  }
}
