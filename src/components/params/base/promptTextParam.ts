import type { PromptVariableItem } from '@/components/ui'
import {
  parseLegacyPromptString,
  toLegacyPromptString,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'
import type { TextParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'

export function resolveTextParamPromptVariables(
  param: TextParamDef,
  language: string,
): PromptVariableItem[] {
  return (param.editor?.variables ?? []).map((variable) => ({
    key: variable.key,
    label: getI18nText(variable.label, language),
    ...(variable.group ? { group: getI18nText(variable.group, language) } : {}),
    ...(variable.description
      ? { description: getI18nText(variable.description, language) }
      : {}),
  }))
}

export function resolveTextParamPromptDocument(
  value: string,
  variables: readonly PromptVariableItem[],
): PromptDocumentV1 {
  return parseLegacyPromptString(value, { variables })
}

export function serializeTextParamPromptDocument(
  document: PromptDocumentV1,
): string {
  return toLegacyPromptString(document)
}
