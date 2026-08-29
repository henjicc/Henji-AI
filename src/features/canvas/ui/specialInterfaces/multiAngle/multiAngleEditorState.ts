import {
  normalizeMultiAngleConfig,
  resolveMultiAngleExecutionTarget,
} from '@/features/canvas/capabilities/multiAnglePolicy'

export function buildMultiAngleEditorDraft(
  state: Readonly<DynamicValueMap>,
  value: unknown,
): DynamicValueMap {
  const config = normalizeMultiAngleConfig(value)
  const target = resolveMultiAngleExecutionTarget(config.controlProfile)
  return {
    ...state,
    multiAngleConfig: config,
    modelId: target.modelId,
    params: {},
    prompt: '',
  }
}
