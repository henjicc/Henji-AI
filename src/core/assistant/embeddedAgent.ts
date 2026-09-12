import { z } from 'zod'
import { agentAttachmentsSchema, type AgentAttachment } from './attachments'

export const embeddedAgentPromptSchema = z.object({
  text: z.string().trim().min(1).max(32000),
  model: z.object({ providerId: z.string().min(1), modelId: z.string().min(1) }).strict(),
  access: z.enum(['read', 'write', 'full']),
  context: z.string().max(16000),
  attachments: agentAttachmentsSchema.optional(),
}).strict()
export type EmbeddedAgentPrompt = z.infer<typeof embeddedAgentPromptSchema>
export interface EmbeddedAgentMessage { id: string; role: 'user' | 'assistant'; text: string; attachments?: AgentAttachment[] }
export interface EmbeddedAgentSnapshot {
  sessionId: string | null
  busy: boolean
  messages: EmbeddedAgentMessage[]
  activity: string | null
  error: string | null
}
export interface EmbeddedAgentSession { id: string; title: string; updatedAt: string }
export interface EmbeddedAgentModel { providerId: string; modelId: string; name: string; inputModalities: AgentAttachment['modality'][] }
export interface EmbeddedAgentPlatform {
  snapshot(): Promise<EmbeddedAgentSnapshot>
  models(): Promise<EmbeddedAgentModel[]>
  prompt(input: EmbeddedAgentPrompt): Promise<void>
  cancel(): Promise<void>
  newSession(): Promise<void>
  sessions(): Promise<EmbeddedAgentSession[]>
  openSession(id: string): Promise<void>
  onSnapshot(handler: (snapshot: EmbeddedAgentSnapshot) => void): () => void
}
export const emptyEmbeddedAgentSnapshot = (): EmbeddedAgentSnapshot => ({ sessionId: null, busy: false, messages: [], activity: null, error: null })
