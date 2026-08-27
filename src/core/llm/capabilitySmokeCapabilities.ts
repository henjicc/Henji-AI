import type {
  CapabilitySmokeCheckId,
  ModelCapabilitySmokeRequest,
  ModelCapabilitySmokeResult,
} from './capabilitySmoke'
import type { LlmCapabilities } from '@henjicc/ai-sdk'

export function applyCapabilitySmokeToCapabilities(
  capabilities: LlmCapabilities,
  result: ModelCapabilitySmokeResult,
  structuredOutputMode: ModelCapabilitySmokeRequest['structuredOutputMode']
): LlmCapabilities {
  const passed = (id: CapabilitySmokeCheckId): boolean => (
    result.checks.some(check => check.id === id && check.status === 'passed')
  )
  const structuredOutputPassed = passed('structuredOutput')
  return {
    ...capabilities,
    text: capabilities.text || passed('text'),
    streaming: capabilities.streaming || passed('streaming'),
    toolCall: capabilities.toolCall || passed('toolCall'),
    jsonOutput: capabilities.jsonOutput || structuredOutputPassed,
    structuredOutputMode: structuredOutputPassed
      ? structuredOutputMode
      : capabilities.structuredOutputMode,
    usage: capabilities.usage || passed('usage'),
  }
}
