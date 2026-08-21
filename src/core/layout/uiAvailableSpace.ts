export type UiWidthBand = 'narrow' | 'regular'
export type UiHeightBand = 'short' | 'constrained' | 'spacious'

export interface UiAvailableSpaceProfile {
  widthBand: UiWidthBand
  heightBand: UiHeightBand
}

const NARROW_MAX_WIDTH_PX = 1180
const SHORT_MAX_HEIGHT_PX = 920
const CONSTRAINED_MAX_HEIGHT_PX = 1050

export function classifyUiAvailableSpace(
  availableWidth: number,
  availableHeight: number,
): UiAvailableSpaceProfile {
  const widthBand: UiWidthBand = availableWidth <= NARROW_MAX_WIDTH_PX ? 'narrow' : 'regular'
  const heightBand: UiHeightBand = availableHeight <= SHORT_MAX_HEIGHT_PX
    ? 'short'
    : availableHeight <= CONSTRAINED_MAX_HEIGHT_PX
      ? 'constrained'
      : 'spacious'

  return { widthBand, heightBand }
}

export function shouldUseCompactGenerationLayout(
  availableWidth: number,
  availableHeight: number,
): boolean {
  const profile = classifyUiAvailableSpace(availableWidth, availableHeight)
  return profile.heightBand === 'short'
    || (profile.widthBand === 'narrow' && profile.heightBand === 'constrained')
}
