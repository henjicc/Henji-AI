import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { z } from 'zod'
import { embeddedQuestionSchema, type EmbeddedPermissionMode, type EmbeddedQuestion, type EmbeddedQuestionAnswer } from '../../../../src/core/assistant/embeddedAgent'

type Ask = (questions: EmbeddedQuestion[], plan?: string) => Promise<Omit<EmbeddedQuestionAnswer, 'id'>>

const questionJsonSchema = z.toJSONSchema(z.object({ questions: z.array(embeddedQuestionSchema).min(1).max(4) }).strict(), { io: 'input' })
const planJsonSchema = z.toJSONSchema(z.object({ plan: z.string().trim().min(1).max(20000) }).strict(), { io: 'input' })
const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }], details: undefined })
const MODE_NAMES: Readonly<Record<Exclude<EmbeddedPermissionMode, 'plan'>, string>> = { auto: '自动', ask: '改前先问' }

function answerText(questions: EmbeddedQuestion[], answer: Omit<EmbeddedQuestionAnswer, 'id'>): string {
  if (answer.dismissed) return '用户跳过了这个问题，没有选择。按你的判断继续，或换个问法再问。'
  return questions.map((item, index) => `${item.question} → ${(answer.answers[index] ?? []).join('；') || '（没选）'}`).join('\n')
}

/**
 * 助手问用户的两个工具，对标 Claude Code 的 AskUserQuestion 与退出计划模式：
 * ask_user 随时可用，在对话里弹出选择卡片（多个方案选一个、多选，用户也能自己写一句）；
 * present_plan 只在只计划模式出现，交出计划并问用户按哪种方式执行。用户选了执行就切出只计划，同一轮里接着做。
 */
export function createQuestionTools(mode: EmbeddedPermissionMode, ask: Ask, switchMode: (mode: Exclude<EmbeddedPermissionMode, 'plan'>) => void): ToolDefinition[] {
  const askUser: ToolDefinition = {
    name: 'ask_user', label: '询问用户',
    description: '需要用户拍板时用：几个方案选哪个、要不要做某件事、缺一个只有用户知道的信息。每题 2–4 个选项（label 简短，description 写取舍），可设 multiSelect；用户总能不选而自己写一句。一次最多 4 题。用户回答前会一直等着；能自己判断的事不要问。',
    parameters: questionJsonSchema as ToolDefinition['parameters'], executionMode: 'sequential',
    execute: async (_id, args) => {
      const questions = z.array(embeddedQuestionSchema).min(1).max(4).parse((args as { questions?: unknown }).questions)
      return text(answerText(questions, await ask(questions)))
    },
  }
  if (mode !== 'plan') return [askUser]
  const presentPlan: ToolDefinition = {
    name: 'present_plan', label: '提交计划',
    description: '只计划模式下调查完后调用：plan 写成编号步骤（每步做什么、改哪里、会不会花钱或删东西）。用户会选按计划执行、要求修改或先不做；选了执行就切出只计划，你接着按计划做。',
    parameters: planJsonSchema as ToolDefinition['parameters'], executionMode: 'sequential',
    execute: async (_id, args) => {
      const plan = z.string().trim().min(1).parse((args as { plan?: unknown }).plan)
      const answer = await ask([], plan)
      if (answer.permissionMode) {
        switchMode(answer.permissionMode)
        return text(`用户同意按计划执行，已切换到“${MODE_NAMES[answer.permissionMode]}”模式。现在开始按计划逐步执行。`)
      }
      const feedback = answer.answers.flat().join('；').trim()
      return text(answer.dismissed || !feedback ? '用户先不执行这个计划。停下来，等用户下一条消息。' : `用户希望修改计划：${feedback}。按意见改好后再调用 present_plan。`)
    },
  }
  return [askUser, presentPlan]
}
