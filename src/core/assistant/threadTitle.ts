import { z } from 'zod'

export const agentThreadTitleStageSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
])
export type AgentThreadTitleStage = z.infer<typeof agentThreadTitleStageSchema>

export const agentThreadTitleContextRequestSchema = z.object({
  runId: z.string().min(1),
  threadId: z.string().min(1).max(200),
}).strict()
export type AgentThreadTitleContextRequest = z.infer<
  typeof agentThreadTitleContextRequestSchema
>

export const agentThreadTitleContextSchema = z.object({
  threadId: z.string().min(1).max(200),
  currentTitle: z.string().max(200),
  generationStage: agentThreadTitleStageSchema,
  userMessageCount: z.number().int().nonnegative(),
  userInstructions: z.array(z.string().min(1).max(4_000)).max(6),
}).strict()
export type AgentThreadTitleContext = z.infer<typeof agentThreadTitleContextSchema>

export const agentThreadTitleUpdateSchema = z.object({
  runId: z.string().min(1),
  threadId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(80),
  expectedStage: agentThreadTitleStageSchema,
  nextStage: agentThreadTitleStageSchema,
}).strict().superRefine((value, context) => {
  if (value.nextStage <= value.expectedStage) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextStage'],
      message: '标题生成阶段必须向前推进',
    })
  }
})
export type AgentThreadTitleUpdate = z.infer<typeof agentThreadTitleUpdateSchema>

export const agentThreadTitleUpdateResultSchema = z.object({
  updated: z.boolean(),
  title: z.string().max(200),
  generationStage: agentThreadTitleStageSchema,
}).strict()
export type AgentThreadTitleUpdateResult = z.infer<
  typeof agentThreadTitleUpdateResultSchema
>
