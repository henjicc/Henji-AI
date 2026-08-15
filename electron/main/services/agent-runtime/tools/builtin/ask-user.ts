import { z } from 'zod'

import type { AgentToolObservation } from '../../../../../../src/core/assistant/toolContracts'
import type { ModelStepToolCall } from '../../../../../../src/core/llm/modelStep'
import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'

export const ASK_USER_TOOL_NAME = 'ask_user'

export interface PendingUserQuestion {
  question: string
  reason: string
}

/**
 * 一次运行最多打断用户几次。
 *
 * 这是防滥用而不是防误用：模型把提问当成规避调查的捷径时，用户体验会从"太多确认"退化成
 * "更多确认"。真正需要问的选择项一次运行里很少超过一两个；超过三个说明模型该做的调查没做。
 */
const ASK_USER_MAX_CALLS_PER_RUN = 3

const askUserInputSchema = z.object({
  /** 一个具体问题，用用户的语言写，直接展示给用户。 */
  question: z.string().min(1).max(2_000),
  /** 为什么现在必须问。进入 ClarificationRequired.reason，也是给用户看的。 */
  reason: z.string().min(1).max(500),
}).strict()

const askUserOutputSchema = z.object({
  status: z.literal('waiting_user'),
}).strict()

/**
 * 向用户提出一个具体问题并停在那里。
 *
 * **为什么需要这个工具**：在它之前，"运行要不要停下来等用户"是运行时拿正则去嗅探模型最终
 * 答复的措辞（`/请提供|请确认|请选择|需要你|[?？]/`）。两种失败都会发生且都很难：
 * 假阴性——模型确实在问问题，但用词没命中词表，运行直接 completed，用户的回答变成一次全新
 * 运行，本轮上下文全部丢失；假阳性——答复里恰好有个问号，运行挂在 waiting_user 等一个用户
 * 根本不知道要回答的东西。
 *
 * 判断"我需要问用户"是模型的判断题，不是运行时能从散文里嗅出来的。所以把它变成一次显式调用。
 *
 * **返回是非阻塞的**：工具立刻返回 `waiting_user`，真正的等待由 runner 在工具回合结束后接管，
 * 复用已经调通的 emit / transition / savePoint / await / appendEphemeral 那一段。这样不需要把
 * 新依赖穿进 AgentToolContext → gateway → scheduler，也不用重新处理暂停、取消与审批的交叠。
 */
/**
 * 从一次工具观察里读出待提问内容；不是 ask_user 或调用未成功时返回 null。
 *
 * 用调用输入而不是输出取 question/reason：输出只用来确认这一步真的走通了（没有被审批拒绝、
 * 没有超时、没有被 Gateway 挡下）。挡下时不能把运行挂进 waiting_user，否则用户会看到一个
 * 永远等不到答案的问题。
 */
export function readPendingUserQuestion(
  call: ModelStepToolCall,
  observation: AgentToolObservation,
): PendingUserQuestion | null {
  if (call.toolName !== ASK_USER_TOOL_NAME) return null
  const output = observation.output
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  if ((output as Record<string, unknown>).status !== 'waiting_user') return null
  const parsed = askUserInputSchema.safeParse(call.input)
  return parsed.success ? { question: parsed.data.question, reason: parsed.data.reason } : null
}

export function createAskUserTool(): AgentToolDefinition {
  return defineAgentTool({
    name: ASK_USER_TOOL_NAME,
    version: 1,
    title: '向用户提出一个具体问题',
    description: '当某个选择项你无法从正式状态源查明、且猜错代价高时，用它提出一个具体问题并停下来等待。'
      + '能自己查的一律先查；不要用提问代替调查，也不要在最终答复里写"请你确认…"然后结束'
      + '——那样用户的回答会开启一次新运行，本轮上下文会全部丢失。',
    category: 'application',
    side: 'backend',
    risk: 'R0',
    permission: 'application:read',
    readOnly: true,
    destructive: false,
    openWorld: false,
    idempotent: false,
    timeoutMs: 5_000,
    maxCallsPerRun: ASK_USER_MAX_CALLS_PER_RUN,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: askUserInputSchema,
    outputSchema: askUserOutputSchema,
    aiInputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '给用户看的一个具体问题' },
        reason: { type: 'string', description: '为什么必须现在问用户' },
      },
      required: ['question', 'reason'],
      additionalProperties: false,
    },
    // 工具本身不阻塞：真正的等待在 runner 的工具回合之后接管。
    execute: () => Promise.resolve({ status: 'waiting_user' as const }),
    concurrencyKey: () => 'ask-user',
    targetIds: () => ({}),
    dataClasses: () => ['C0'],
    summarize: () => '已向用户提出一个问题，等待回答。',
    inputExamples: [{
      question: '素材库里有两个都叫「参考图」的项目，你要改的是 2 月 3 日创建的那个，还是昨天创建的那个？',
      reason: '按名称匹配到两个素材库，改错无法自动撤销。',
    }],
  }) as AgentToolDefinition
}
