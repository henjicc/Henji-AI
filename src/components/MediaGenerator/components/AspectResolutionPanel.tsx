import React, { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { UiSpecialPanel } from '@/components/ui'
import { AspectRatioTiles, type AspectRatioTileOption, type AspectTierOption } from '@/components/params/panels/ResolutionPanel/AspectRatioTiles'
import { getI18nText } from '@/core/types'
import {
  formatAspectRatioDisplayLabel,
  isSmartAspectValue,
  type ChoiceOptionDescriptor,
  type ChoiceParamDescriptor,
} from '@/core/params/ratioResolution'
import {
  buildSizeDerivedSpec,
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

type AspectRenderOption = AspectRatioTileOption

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

  const tileOptions = sizeDerivedSpec ? derivedAspectOptions : aspectOptions
  const tierOptions = sizeDerivedSpec ? derivedResolutionOptions : resolutionOptions

  const isAspectActive = (option: AspectRenderOption): boolean => sizeDerivedSpec
    ? (!option.smart && isChoiceValueMatch(selectedDerived?.ratioText, option.value))
    : (option.smart ? isSmartAspectValue(aspectValue) : isChoiceValueMatch(aspectValue, option.value))

  const selectAspect = async (option: AspectRenderOption): Promise<void> => {
    if (sizeDerivedSpec && resolutionParam) {
      const activeTier = selectedDerived?.tierLabel || sizeDerivedSpec.resolutionOptions[0]?.tierLabel
      if (!activeTier) return
      if (option.smart) {
        const imageRatio = uploadedImages.length > 0 ? await readImageRatio(uploadedImages[0]) : null
        const targetRatio = imageRatio && Number.isFinite(imageRatio) ? imageRatio : 1
        const closestRatio = pickClosestRatioText(sizeDerivedSpec, targetRatio)
        if (!closestRatio) return
        const nextValue = pickSizeDerivedValue(sizeDerivedSpec, closestRatio, activeTier)
        if (nextValue !== null) onChange(resolutionParam.id, nextValue)
        return
      }
      const nextValue = pickSizeDerivedValue(sizeDerivedSpec, String(option.value), activeTier)
      if (nextValue !== null) onChange(resolutionParam.id, nextValue)
      return
    }
    if (!aspectParam) return
    onChange(aspectParam.id, option.smart ? aspectSmartValue : option.value)
  }

  const isTierActive = (option: AspectTierOption): boolean => sizeDerivedSpec
    ? isChoiceValueMatch(selectedDerived?.tierLabel, option.value)
    : isChoiceValueMatch(resolutionValue, option.value)

  const selectTier = (option: AspectTierOption): void => {
    if (!resolutionParam || option.disabled) return
    if (!sizeDerivedSpec) {
      onChange(resolutionParam.id, option.value)
      return
    }
    const activeRatio = selectedDerived?.ratioText || sizeDerivedSpec.aspectOptions[0]?.ratioText
    if (!activeRatio) return
    const nextValue = pickSizeDerivedValue(sizeDerivedSpec, activeRatio, String(option.value))
    if (nextValue !== null) onChange(resolutionParam.id, nextValue)
  }

  return (
    <PanelTrigger
      label={triggerLabel}
      display={triggerDisplay}
      className="w-auto"
      buttonClassName="w-auto max-w-none"
      // 特殊面板：宽度跟格子数走（重要记录 021）
      panelSize="special"
      alignment="aboveCenter"
      freezePositionOnOpen
      closeOnPanelClick={false}
      renderPanel={() => (
        <UiSpecialPanel>
          <AspectRatioTiles
            options={aspectParam || sizeDerivedSpec ? tileOptions : []}
            isActive={isAspectActive}
            onSelect={(option) => { void selectAspect(option) }}
            tiers={resolutionParam ? tierOptions : undefined}
            isTierActive={isTierActive}
            onTierSelect={selectTier}
          />
        </UiSpecialPanel>
      )}
    />
  )
}

export default AspectResolutionPanel
