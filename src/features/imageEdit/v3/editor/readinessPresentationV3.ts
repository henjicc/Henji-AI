import type {
  ImageEditorCapabilityReadinessV3,
  ImageEditorReadinessReasonKeyV3,
} from '../application/imageEditorHostProfiles'

type TranslateImageEditorReadinessV3 = (key: ImageEditorReadinessReasonKeyV3) => string

/** Known limitations use locale keys; opaque lower-layer details remain safe interpolation values. */
export function resolveImageEditorReadinessReasonV3(
  readiness: Pick<ImageEditorCapabilityReadinessV3, 'reason' | 'reasonKey'>,
  translate: TranslateImageEditorReadinessV3,
): string | undefined {
  if (readiness.reasonKey) return translate(readiness.reasonKey)
  return readiness.reason?.trim() || undefined
}
