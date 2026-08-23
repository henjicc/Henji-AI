import type { ModelDefinition } from '@/core/types'

export function hasMeaningfulGenerationInputValue(value: DynamicValue): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined && value !== null && value !== false
}

export function hasAlternativeModelInput(
  model: Pick<ModelDefinition, 'alternativeInputParamIds'> | undefined,
  values: DynamicValueMap
): boolean {
  return model?.alternativeInputParamIds?.some(
    (paramId) => hasMeaningfulGenerationInputValue(values[paramId])
  ) === true
}
