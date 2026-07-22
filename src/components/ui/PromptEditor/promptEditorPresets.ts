import type { PromptEditorPreset } from './types'

export interface PromptEditorPresetCapabilities {
  mediaReferences: boolean
  templateVariables: boolean
}

export function resolvePromptEditorPreset(
  preset: PromptEditorPreset,
): PromptEditorPresetCapabilities {
  return {
    mediaReferences: preset === 'media-references' || preset === 'structured',
    templateVariables: preset === 'template-variables' || preset === 'structured',
  }
}
