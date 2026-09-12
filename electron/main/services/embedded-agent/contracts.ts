import type { LlmModelConfig } from '@henjicc/ai-sdk'
import type { EmbeddedAgentSnapshot } from '../../../../src/core/assistant/embeddedAgent'
export interface EmbeddedTool { name: string; title?: string; description?: string; inputSchema: Record<string, unknown> }
export interface EmbeddedModel { providerId: string; model: LlmModelConfig; baseUrl: string; api: 'openai-completions' | 'openai-responses' | 'anthropic-messages'; apiKey: string }
export interface EngineConfiguration { directory: string; model: EmbeddedModel; tools: EmbeddedTool[]; instructions: string }
export type EngineCommand =
  | { action: 'initialize'; input: string }
  | { action: 'configure'; input: EngineConfiguration }
  | { action: 'prompt'; input: { text: string; context: string } }
  | { action: 'open'; input: string }
  | { action: 'snapshot' | 'cancel' | 'new' | 'sessions'; input?: never }
export type EngineEvent =
  | { type: 'snapshot'; value: EmbeddedAgentSnapshot }
  | { type: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'toolCancel'; id: string }
  | { type: 'log'; phase: 'start' | 'completed' | 'failed'; sessionId: string | null; message?: string }
export interface EmbeddedAgentEngine {
  command(command: EngineCommand): Promise<unknown>
  dispose(): Promise<void>
}
