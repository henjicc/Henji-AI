import { z } from 'zod'
import { ApplicationWriteFailure } from '../application-control/execution/writeExecution'

export const transcriptionPreflightSchema = z.object({ sourcePath: z.string().min(1), durationMs: z.number().positive(), modelId: z.string().optional(), language: z.string().optional(), audioDocumentId: z.string().optional() }).strict()
export type TranscriptionPreflight = z.infer<typeof transcriptionPreflightSchema>
export interface TranscriptionPreparation { modelId?: string; requiresConfirmation: boolean; cost?: import('./asrCatalog').AsrCostEstimate }
/** Rejections through contextBridge discard Error custom properties; transfer a plain DTO instead. */
export type TranscriptionReply =
  | { ok: true; data: import('./types').AudioEditTranscriptionResult }
  | { ok: false; error: { message: string; transcriptionFacts?: TranscriptionFacts } }

/** Only execution facts, never credentials, paths or provider response bodies, cross IPC. */
export const transcriptionFactsSchema = z.object({
  billing: z.enum(['not_charged', 'submitted', 'completed', 'unknown']),
  targetMutation: z.enum(['none', 'applied']),
  audioDocumentId: z.string().optional(),
}).strict()
export type TranscriptionFacts = z.infer<typeof transcriptionFactsSchema>
export class TranscriptionFailure extends ApplicationWriteFailure {
  constructor(cause: unknown, readonly transcriptionFacts: TranscriptionFacts) {
    super(cause, { ...transcriptionFacts, notExecuted: transcriptionFacts.billing === 'not_charged' && transcriptionFacts.targetMutation === 'none' })
    this.name = 'TranscriptionFailure'
  }
}
export function readTranscriptionFacts(error: unknown): TranscriptionFacts | undefined {
  const result = transcriptionFactsSchema.safeParse(error && typeof error === 'object' && 'transcriptionFacts' in error ? error.transcriptionFacts : undefined)
  return result.success ? result.data : undefined
}
