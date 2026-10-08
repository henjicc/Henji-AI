import type { ModelDefinition } from '@/core/types'
import { hasAlternativeModelInput } from '@/core/inputs/alternativeInput'
import type { RowMediaKind } from '@/features/canvas/domain/socketTypes'
import { showAlertDialog } from '@/stores/alertDialogStore'
import { generatedMediaName } from '@/core/documents/generatedMediaName'

export const DEFAULT_GENERATION_DURATION_MS = 60_000
export const PROMPT_PARAM_IDS = ['prompt', 'text']
export const ROW_MEDIA_KINDS: RowMediaKind[] = ['image', 'video', 'audio']

export function buildResultNodeTitle(prompt: string, fallbackTitle: string): string {
  return generatedMediaName(prompt, fallbackTitle)
}

export function resolveGenerationPromptInput(
  model: Pick<ModelDefinition, 'alternativeInputParamIds'> | undefined,
  runtimeValues: DynamicValueMap,
  documentPrompt: string,
  injectedPrompt: DynamicValue
): { prompt: string; hasValidInput: boolean } {
  const prompt = typeof injectedPrompt === 'string'
    ? injectedPrompt.trim()
    : documentPrompt.trim()
  return {
    prompt,
    hasValidInput: prompt.length > 0 || hasAlternativeModelInput(model, runtimeValues),
  }
}

export function ensureGenerationProviderConfigured(
  configured: boolean,
  messages: { title: string; message: string; error: string }
): void {
  if (configured) return
  showAlertDialog({
    title: messages.title,
    message: messages.message,
    type: 'info',
    settingsTarget: { tab: 'providers', sectionId: 'providers' },
  })
  throw new Error(messages.error)
}
