import {
  MULTI_ANGLE_CONTINUOUS_MODEL_ID,
  MULTI_ANGLE_DISCRETE_MODEL_ID,
  normalizeMultiAngleConfig,
} from '@/features/canvas/capabilities/multiAnglePolicy'

export function buildMultiAngleEditorDraft(
  state: Readonly<DynamicValueMap>,
  value: unknown,
): DynamicValueMap {
  const config = normalizeMultiAngleConfig(value)
  return {
    ...state,
    multiAngleConfig: config,
    modelId: config.controlProfile === 'continuous-v1'
      ? MULTI_ANGLE_CONTINUOUS_MODEL_ID
      : MULTI_ANGLE_DISCRETE_MODEL_ID,
    params: {},
    prompt: '',
  }
}
