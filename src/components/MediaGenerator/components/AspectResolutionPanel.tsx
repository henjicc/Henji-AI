import React, { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { UiOptionButton } from '@/components/ui'
import { getI18nText } from '@/core/types'
import {
  formatAspectRatioDisplayLabel,
  isSmartAspectValue,
  type ChoiceOptionDescriptor,
  type ChoiceParamDescriptor,
} from '@/core/params/ratioResolution'
import {
  buildSizeDerivedSpec,
  getRatioBoxSize,
  parseRatio,
  pickClosestRatioText,
  pickSizeDerivedValue,
  readImageRatio,
  type SizeDerivedSpec,
} from './aspectResolutionPanelUtils'

interface AspectResolutionPanelProps {
  aspectParam?: ChoiceParamDescriptor
  resolutionParam?: ChoiceParamDescriptor
  values: DynamicValueMap
  uploadedImages: string[]
  onChange: (paramId: string, value: DynamicValue) => void
}

interface AspectRenderOption {
  value: string | number
  label: string
  ratio: { width: number; height: number } | null
  smart: boolean
}

const PANEL_SIDE_PADDING = 16
const PANEL_MIN_WIDTH = 196
const PANEL_MAX_WIDTH = 400
const ROW_GAP = 8
const OPTION_ITEM_WIDTH = 78
const ASPECT_ITEM_HEIGHT = 92
const RESOLUTION_ITEM_HEIGHT = 42
const ASPECT_ITEMS_PER_ROW = 4
const RESOLUTION_ITEMS_PER_ROW = 4

function estimateSectionWidth(
  itemCount: number,
  itemWidth: number,
  maxItemsPerRow: number
): number {
  if (itemCount <= 0) {
    return 0
  }
  const columns = Math.min(maxItemsPerRow, itemCount)
  return columns * itemWidth + ROW_GAP * Math.max(0, columns - 1)
}

function toSectionWidthStyle(width: number): React.CSSProperties | undefined {
  if (!Number.isFinite(width) || width <= 0) {
    return undefined
  }
  return { width: `${Math.round(width)}px` }
}

function isUnsetValue(value: DynamicValue): boolean {
  return value === undefined || value === null || value === ''
}

function getEffectiveChoiceValue(
  param: ChoiceParamDescriptor | undefined,
  value: DynamicValue
): DynamicValue {
  if (!param) {
    return value
  }
  if (!isUnsetValue(value)) {
    return value
  }
  if (!isUnsetValue(param.defaultValue)) {
    return param.defaultValue
  }
  return param.options.find((option) => option.disabled !== true)?.value
}

function getOptionLabel(
  option: ChoiceOptionDescriptor,
  language: string,
  normalizeAspectRatio = false
): string {
  const label = String(getI18nText(option.label, language) || option.value)
  return normalizeAspectRatio
    ? formatAspectRatioDisplayLabel(label, option.value)
    : label
}

function isChoiceValueMatch(left: DynamicValue, right: DynamicValue): boolean {
  if (left === right) {
    return true
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return left.trim().toLowerCase() === right.trim().toLowerCase()
  }
  if (left === undefined || left === null || right === undefined || right === null) {
    return false
  }
  return String(left) === String(right)
}

function getActiveLabel(
  param: ChoiceParamDescriptor | undefined,
  value: DynamicValue,
  language: string,
  smartLabel: string,
  normalizeAspectRatio = false
): string {
  if (!param || isUnsetValue(value)) {
    return ''
  }

  if (isSmartAspectValue(value)) {
    return smartLabel
  }

  const option = param.options.find((candidate) => isChoiceValueMatch(candidate.value, value))
  if (option) {
    return getOptionLabel(option, language, normalizeAspectRatio)
  }

  return normalizeAspectRatio
    ? formatAspectRatioDisplayLabel(String(value), value)
    : String(value)
}

function getCurrentDerivedOption(
  spec: SizeDerivedSpec | null,
  resolutionValue: DynamicValue
) {
  if (!spec) {
    return null
  }
  if (!isUnsetValue(resolutionValue)) {
    const direct = spec.valueMap.get(String(resolutionValue))
    if (direct) {
      return direct
    }
  }
  return spec.options[0] ?? null
}

export const AspectResolutionPanel: React.FC<AspectResolutionPanelProps> = ({
  aspectParam,
  resolutionParam,
  values,
  uploadedImages,
  onChange,
}) => {
  const { t, i18n } = useTranslation('ui')
  const smartInitRef = useRef<string | null>(null)

  const smartLabel = t('resolutionPanel.smart', { defaultValue: '智能' })
  const aspectLabel = t('resolutionPanel.aspectRatio', { defaultValue: '比例' })
  const resolutionLabel = t('resolutionPanel.resolution', { defaultValue: '分辨率' })
  const rawAspectValue = aspectParam ? values[aspectParam.id] : undefined
  const rawResolutionValue = resolutionParam ? values[resolutionParam.id] : undefined
  const aspectValue = useMemo(
    () => getEffectiveChoiceValue(aspectParam, rawAspectValue),
    [aspectParam, rawAspectValue]
  )
  const resolutionValue = useMemo(
    () => getEffectiveChoiceValue(resolutionParam, rawResolutionValue),
    [resolutionParam, rawResolutionValue]
  )
  const aspectSmartValue = useMemo(() => {
    if (!aspectParam) {
      return 'smart'
    }
    const existing = aspectParam.options.find((option) => isSmartAspectValue(option.value))
    return existing?.value ?? 'smart'
  }, [aspectParam])

  useEffect(() => {
    if (!aspectParam) {
      smartInitRef.current = null
      return
    }
    if (smartInitRef.current === aspectParam.id) {
      return
    }
    smartInitRef.current = aspectParam.id

    const shouldInitSmart = (
      isUnsetValue(rawAspectValue) ||
      isChoiceValueMatch(rawAspectValue, aspectParam.defaultValue)
    ) && !isSmartAspectValue(rawAspectValue)

    if (shouldInitSmart) {
      onChange(aspectParam.id, aspectSmartValue)
    }
  }, [aspectParam, rawAspectValue, aspectSmartValue, onChange])

  const sizeDerivedSpec = useMemo(() => {
    if (aspectParam || !resolutionParam) {
      return null
    }
    return buildSizeDerivedSpec(
      resolutionParam.options.map((option) => ({
        value: option.value,
        label: getOptionLabel(option, i18n.language),
        disabled: option.disabled === true,
      }))
    )
  }, [aspectParam, resolutionParam, i18n.language])

  const selectedDerived = useMemo(
    () => getCurrentDerivedOption(sizeDerivedSpec, resolutionValue),
    [sizeDerivedSpec, resolutionValue]
  )

  const aspectOptions = useMemo<AspectRenderOption[]>(() => {
    if (!aspectParam) {
      return []
    }

    const baseOptions = aspectParam.options
      .filter((option) => !(typeof option.value === 'string' && isSmartAspectValue(option.value)))
      .map((option) => {
        const label = getOptionLabel(option, i18n.language, true)
        const ratio = parseRatio(String(option.value)) ?? parseRatio(label)
        return {
          value: option.value,
          label,
          ratio,
          smart: false,
        }
      })

    return [
      {
        value: aspectSmartValue,
        label: smartLabel,
        ratio: null,
        smart: true,
      },
      ...baseOptions,
    ]
  }, [aspectParam, i18n.language, smartLabel, aspectSmartValue])

  const derivedAspectOptions = useMemo<AspectRenderOption[]>(() => {
    if (!sizeDerivedSpec) {
      return []
    }
    return [
      {
        value: '__smart__',
        label: smartLabel,
        ratio: null,
        smart: true,
      },
      ...sizeDerivedSpec.aspectOptions.map((option) => ({
        value: option.ratioText,
        label: option.ratioText,
        ratio: parseRatio(option.ratioText),
        smart: false,
      })),
    ]
  }, [sizeDerivedSpec, smartLabel])

  const resolutionOptions = useMemo(() => {
    if (!resolutionParam) {
      return []
    }
    return resolutionParam.options.map((option) => ({
      value: option.value,
      label: getOptionLabel(option, i18n.language),
      disabled: option.disabled === true,
    }))
  }, [resolutionParam, i18n.language])

  const derivedResolutionOptions = useMemo(() => {
    if (!sizeDerivedSpec) {
      return []
    }
    return sizeDerivedSpec.resolutionOptions.map((option) => ({
      value: option.tierLabel,
      label: option.tierLabel,
    }))
  }, [sizeDerivedSpec])

  const aspectDisplay = sizeDerivedSpec
    ? (selectedDerived?.ratioText || '')
    : getActiveLabel(aspectParam, aspectValue, i18n.language, smartLabel, true)
  const resolutionDisplay = sizeDerivedSpec
    ? (selectedDerived?.tierLabel || '')
    : getActiveLabel(resolutionParam, resolutionValue, i18n.language, smartLabel)

  const triggerLabel = (() => {
    if (aspectParam && resolutionParam) {
      return resolutionLabel
    }
    if (aspectParam) {
      return aspectLabel
    }
    if (resolutionParam || sizeDerivedSpec) {
      return resolutionLabel
    }
    return '参数'
  })()

  const aspectSectionWidth = useMemo(() => {
    const itemCount = (sizeDerivedSpec ? derivedAspectOptions : aspectOptions).length
    return estimateSectionWidth(itemCount, OPTION_ITEM_WIDTH, ASPECT_ITEMS_PER_ROW)
  }, [aspectOptions, derivedAspectOptions, sizeDerivedSpec])

  const resolutionSectionWidth = useMemo(() => {
    const itemCount = (sizeDerivedSpec ? derivedResolutionOptions : resolutionOptions).length
    return estimateSectionWidth(itemCount, OPTION_ITEM_WIDTH, RESOLUTION_ITEMS_PER_ROW)
  }, [derivedResolutionOptions, resolutionOptions, sizeDerivedSpec])

  const alignedSectionWidth = useMemo(
    () => Math.max(aspectSectionWidth, resolutionSectionWidth),
    [aspectSectionWidth, resolutionSectionWidth]
  )

  const panelWidth = useMemo(() => {
    const titleWidth = Math.max(aspectLabel.length, resolutionLabel.length) * 14
    const contentWidth = Math.max(titleWidth, alignedSectionWidth)
    const estimated = contentWidth + PANEL_SIDE_PADDING * 2
    return Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, estimated))
  }, [
    alignedSectionWidth,
    aspectLabel,
    resolutionLabel,
  ])

  const triggerDisplay = (() => {
    if (aspectDisplay && resolutionDisplay) {
      return `${aspectDisplay} / ${resolutionDisplay}`
    }
    if (aspectDisplay) {
      return aspectDisplay
    }
    if (resolutionDisplay) {
      return resolutionDisplay
    }
    return t('resolutionPanel.notSet', { defaultValue: '未设置' })
  })()

  if (!aspectParam && !resolutionParam) {
    return null
  }

  return (
    <PanelTrigger
      label={triggerLabel}
      display={triggerDisplay}
      className="w-auto"
      buttonClassName="w-auto max-w-none"
      panelWidth={panelWidth}
      alignment="aboveCenter"
      freezePositionOnOpen
      closeOnPanelClick={false}
      renderPanel={() => (
        <div className="p-4 flex flex-col gap-4">
          {(aspectParam || sizeDerivedSpec) && (
            <div className="flex flex-col gap-2">
              <div className="mx-auto" style={toSectionWidthStyle(alignedSectionWidth)}>
                <label className="mb-2 block text-xs text-zinc-400">
                  {aspectLabel}
                </label>
                <div className="flex flex-wrap justify-start gap-2">
                  {(sizeDerivedSpec ? derivedAspectOptions : aspectOptions).map((option) => {
                    const isActive = sizeDerivedSpec
                      ? (!option.smart && isChoiceValueMatch(selectedDerived?.ratioText, option.value))
                      : (option.smart
                        ? isSmartAspectValue(aspectValue)
                        : isChoiceValueMatch(aspectValue, option.value))

                    return (
                      <UiOptionButton
                        key={String(option.value)}
                        type="button"
                        active={isActive}
                        onClick={async () => {
                          if (sizeDerivedSpec && resolutionParam) {
                            const activeTier =
                              selectedDerived?.tierLabel ||
                              sizeDerivedSpec.resolutionOptions[0]?.tierLabel
                            if (!activeTier) {
                              return
                            }

                            if (option.smart) {
                              const imageRatio = uploadedImages.length > 0
                                ? await readImageRatio(uploadedImages[0])
                                : null
                              const targetRatio =
                                imageRatio && Number.isFinite(imageRatio) ? imageRatio : 1
                              const closestRatio = pickClosestRatioText(sizeDerivedSpec, targetRatio)
                              if (!closestRatio) {
                                return
                              }
                              const nextValue = pickSizeDerivedValue(
                                sizeDerivedSpec,
                                closestRatio,
                                activeTier
                              )
                              if (nextValue !== null) {
                                onChange(resolutionParam.id, nextValue)
                              }
                              return
                            }

                            const nextValue = pickSizeDerivedValue(
                              sizeDerivedSpec,
                              String(option.value),
                              activeTier
                            )
                            if (nextValue !== null) {
                              onChange(resolutionParam.id, nextValue)
                            }
                            return
                          }

                          if (!aspectParam) return
                          if (option.smart) {
                            onChange(aspectParam.id, aspectSmartValue)
                            return
                          }
                          onChange(aspectParam.id, option.value)
                        }}
                        className={`w-[78px] px-2 py-2 text-xs flex-col justify-center gap-2 ${
                          isActive ? '!bg-accent !border-accent !text-white' : ''
                        }`}
                        style={{ height: `${ASPECT_ITEM_HEIGHT}px` }}
                      >
                        <div className="h-8 flex items-center justify-center">
                          {option.smart ? (
                            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M13 2L3 14h8l-1 8 11-14h-8l1-6z" />
                            </svg>
                          ) : option.ratio ? (
                            <div
                              className="border-2 border-current"
                              style={getRatioBoxSize(option.ratio)}
                            />
                          ) : null}
                        </div>
                        <span className="font-medium leading-none">{option.label}</span>
                      </UiOptionButton>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {resolutionParam && (
            <div className="flex flex-col gap-2">
              <div className="mx-auto" style={toSectionWidthStyle(alignedSectionWidth)}>
                <label className="mb-2 block text-xs text-zinc-400">
                  {resolutionLabel}
                </label>
                <div className="flex flex-wrap justify-start gap-2">
                  {(sizeDerivedSpec ? derivedResolutionOptions : resolutionOptions).map((option) => {
                    const isActive = sizeDerivedSpec
                      ? isChoiceValueMatch(selectedDerived?.tierLabel, option.value)
                      : isChoiceValueMatch(resolutionValue, option.value)

                    return (
                      <UiOptionButton
                        key={String(option.value)}
                        type="button"
                        active={isActive}
                        disabled={!sizeDerivedSpec && 'disabled' in option && option.disabled}
                        onClick={() => {
                          if (!resolutionParam) return
                          if (!sizeDerivedSpec) {
                            if ('disabled' in option && option.disabled) return
                            onChange(resolutionParam.id, option.value)
                            return
                          }

                          const activeRatio =
                            selectedDerived?.ratioText ||
                            sizeDerivedSpec.aspectOptions[0]?.ratioText
                          if (!activeRatio) {
                            return
                          }
                          const nextValue = pickSizeDerivedValue(
                            sizeDerivedSpec,
                            activeRatio,
                            String(option.value)
                          )
                          if (nextValue !== null) {
                            onChange(resolutionParam.id, nextValue)
                          }
                        }}
                        className={`w-[78px] px-2 py-1.5 text-sm justify-center ${
                          isActive ? '!bg-accent !border-accent !text-white' : ''
                        } ${
                          !sizeDerivedSpec && 'disabled' in option && option.disabled
                            ? 'opacity-50 cursor-not-allowed'
                            : ''
                        }`}
                        style={{ height: `${RESOLUTION_ITEM_HEIGHT}px` }}
                      >
                        {option.label}
                      </UiOptionButton>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    />
  )
}

export default AspectResolutionPanel
