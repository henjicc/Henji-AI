import { z } from 'zod'

/** 能力契约与源码审查共用；审查实现依赖 TypeScript 编译器，契约单独放才不会把编译器带进首屏。 */
export const codeEffectSuggestionSchema = z.object({
  file: z.string(), line: z.number().int().positive(), column: z.number().int().positive(), evidence: z.string(),
  factory: z.string(), confidence: z.enum(['static_assignment', 'structural_candidate']), message: z.string(),
}).strict()
export type CodeEffectSuggestion = z.infer<typeof codeEffectSuggestionSchema>
