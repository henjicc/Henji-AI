import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/assistant/builtinApplicationCapabilityRegistry'

export function parseCapabilityInput<TInput>(id: string, input: unknown): TInput {
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)
  if (!definition) throw new Error('NOT_FOUND')
  return definition.inputSchema.parse(input) as TInput
}

export function throwIfCapabilityAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('ABORTED')
}
