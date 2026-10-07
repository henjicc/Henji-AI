import { z } from 'zod'

/** 图片候选的完成来源；不复制图片、源码或供应商凭据。 */
export const videoEditCodeImageGenerationSchema = z.object({
  sequenceId: z.string().min(1), clipId: z.string().min(1), versionId: z.string().min(1),
  effectId: z.string().min(1).optional(), parameterKey: z.string().min(1),
  taskId: z.string().min(1), modelId: z.string().min(1), prompt: z.string(),
  outputIndex: z.number().int().nonnegative(),
}).strict()
