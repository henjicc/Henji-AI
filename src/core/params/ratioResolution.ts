import type { DropdownParamDef, I18nText, ParamDef, RadioParamDef } from '@/core/types'
import { getI18nText } from '@/core/types'

export interface ChoiceOptionDescriptor {
  value: string | number
  label: I18nText
  disabled?: boolean
}

export interface ChoiceParamDescriptor {
  id: string
  order: number
  name: I18nText
  apiField?: string
  defaultValue?: unknown
  options: ChoiceOptionDescriptor[]
}

export interface RatioResolutionPanelSpec {
  aspectParam?: ChoiceParamDescriptor
  resolutionParam?: ChoiceParamDescriptor
  consumedParamIds: string[]
}

const SMART_VALUES = new Set(['smart', 'auto', 'adaptive', '智能'])
const RATIO_PATTERN = /^(\d+)\s*:\s*(\d+)$/
const RESOLUTION_PATTERN = /^(\d{3,4}[pP]|[1248][kK]|\d+\s*[x*]\s*\d+)$/
const ASPECT_HINT_PATTERN = /(aspect|ratio|宽高比|比例)/i
const RESOLUTION_HINT_PATTERN = /(resolution|size|分辨率|尺寸)/i
const QUALITY_HINT_PATTERN = /(quality|画质)/i
const DURATION_HINT_PATTERN = /(duration|video[_\s-]?length|时长|秒)/i

const RATIO_ALIASES: Record<string, string> = {
  landscape: '16:9',
  portrait: '9:16',
  square: '1:1',
  square_hd: '1:1',
  portrait_4_3: '3:4',
  portrait_3_2: '2:3',
  portrait_16_9: '9:16',
  landscape_4_3: '4:3',
  landscape_3_2: '3:2',
  landscape_16_9: '16:9',
  landscape_21_9: '21:9',
}

function isChoiceParam(param: ParamDef): param is DropdownParamDef | RadioParamDef {
  return param.type === 'dropdown' || param.type === 'radio'
}

function toChoiceDescriptor(param: ParamDef): ChoiceParamDescriptor | null {
  if (!isChoiceParam(param)) {
    return null
  }

  const rawOptions = (param as DropdownParamDef | RadioParamDef).options
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    return null
  }

  const options = rawOptions.filter(
    (option): option is ChoiceOptionDescriptor =>
      option !== null &&
      typeof option === 'object' &&
      'value' in option &&
      (typeof option.value === 'string' || typeof option.value === 'number') &&
      'label' in option
  )

  if (options.length === 0) {
    return null
  }

  return {
    id: param.id,
    order: param.order,
    name: param.name,
    apiField: param.apiField,
    defaultValue: param.default,
    options,
  }
}

function toLabelText(label: I18nText): string {
  return String(getI18nText(label, 'zh') || getI18nText(label, 'en') || '')
}

function toSearchText(param: ChoiceParamDescriptor): string {
  return [param.id, param.apiField, toLabelText(param.name)].filter(Boolean).join(' ')
}

export function isSmartAspectValue(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }
  const normalized = value.trim().toLowerCase()
  return SMART_VALUES.has(normalized) || SMART_VALUES.has(value.trim())
}

function parseRatioText(text: string): number | null {
  const match = text.trim().match(RATIO_PATTERN)
  if (!match) {
    return null
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return null
  }

  return width / height
}

function parseRatioFromRaw(raw: unknown): number | null {
  if (typeof raw !== 'string') {
    return null
  }

  const normalized = raw.trim().toLowerCase()
  const alias = RATIO_ALIASES[normalized]
  if (alias) {
    return parseRatioText(alias)
  }

  return parseRatioText(raw)
}

function hasRatioLikeOptions(param: ChoiceParamDescriptor): boolean {
  const ratioCount = param.options.reduce((count, option) => {
    if (parseRatioFromRaw(option.value) !== null) {
      return count + 1
    }
    if (parseRatioFromRaw(toLabelText(option.label)) !== null) {
      return count + 1
    }
    return count
  }, 0)

  return ratioCount >= 2
}

function hasResolutionLikeOptions(param: ChoiceParamDescriptor): boolean {
  return param.options.some((option) => {
    if (typeof option.value === 'string' && RESOLUTION_PATTERN.test(option.value.trim())) {
      return true
    }
    const labelText = toLabelText(option.label)
    return RESOLUTION_PATTERN.test(labelText.trim())
  })
}

function looksLikeAspect(param: ChoiceParamDescriptor): boolean {
  if (looksLikeDuration(param)) {
    return false
  }
  const text = toSearchText(param)
  if (ASPECT_HINT_PATTERN.test(text)) {
    return true
  }
  return hasRatioLikeOptions(param)
}

function looksLikeDuration(param: ChoiceParamDescriptor): boolean {
  const text = toSearchText(param)
  if (DURATION_HINT_PATTERN.test(text)) {
    return true
  }

  const durationLikeOptions = param.options.filter((option) => {
    if (typeof option.value === 'number') {
      return option.value >= 1 && option.value <= 120
    }

    const valueText = String(option.value).trim()
    if (/^\d+\s*(s|sec|secs|second|seconds|秒)$/i.test(valueText)) {
      return true
    }

    const labelText = toLabelText(option.label).trim()
    return /^\d+\s*(s|sec|secs|second|seconds|秒)$/i.test(labelText)
  }).length

  return durationLikeOptions >= 2
}

function looksLikeResolution(param: ChoiceParamDescriptor): boolean {
  if (looksLikeDuration(param)) {
    return false
  }
  const text = toSearchText(param)
  if (RESOLUTION_HINT_PATTERN.test(text)) {
    return true
  }
  if (QUALITY_HINT_PATTERN.test(text)) {
    return hasResolutionLikeOptions(param)
  }
  return hasResolutionLikeOptions(param)
}

function pickResolutionCandidate(
  candidates: ChoiceParamDescriptor[],
  hasReferenceImage: boolean
): ChoiceParamDescriptor | undefined {
  if (candidates.length === 0) {
    return undefined
  }
  if (candidates.length === 1) {
    return candidates[0]
  }

  const sizeCandidate = candidates.find((candidate) =>
    /(size|尺寸)/i.test(toSearchText(candidate))
  )
  const resolutionCandidate = candidates.find((candidate) =>
    /(resolution|分辨率)/i.test(toSearchText(candidate)) ||
    (QUALITY_HINT_PATTERN.test(toSearchText(candidate)) && hasResolutionLikeOptions(candidate))
  )

  if (sizeCandidate && resolutionCandidate) {
    return hasReferenceImage ? resolutionCandidate : sizeCandidate
  }

  return candidates[0]
}

export function getAspectChoiceParams(params: ParamDef[]): ChoiceParamDescriptor[] {
  return params
    .map(toChoiceDescriptor)
    .filter((param): param is ChoiceParamDescriptor => param !== null)
    .filter((param) => looksLikeAspect(param))
    .sort((a, b) => a.order - b.order)
}

export function analyzeRatioResolutionParams(
  params: ParamDef[],
  uploadedImages: string[]
): RatioResolutionPanelSpec | null {
  const hasReferenceImage = uploadedImages.length > 0
  const choices = params
    .map(toChoiceDescriptor)
    .filter((param): param is ChoiceParamDescriptor => param !== null)
    .sort((a, b) => a.order - b.order)

  const aspectCandidates = choices.filter((choice) => looksLikeAspect(choice))
  const aspectParam = aspectCandidates[0]

  const resolutionCandidates = choices.filter((choice) => {
    if (aspectParam && choice.id === aspectParam.id) {
      return false
    }
    return looksLikeResolution(choice)
  })

  const resolutionParam = pickResolutionCandidate(resolutionCandidates, hasReferenceImage)
  if (!aspectParam && !resolutionParam) {
    return null
  }

  const consumedIds = new Set<string>()
  if (aspectParam) {
    consumedIds.add(aspectParam.id)
  }

  if (resolutionCandidates.length > 1) {
    const hasSizeAndResolutionPair =
      resolutionCandidates.some((candidate) => /(size|尺寸)/i.test(toSearchText(candidate))) &&
      resolutionCandidates.some((candidate) =>
        /(resolution|分辨率)/i.test(toSearchText(candidate)) ||
        (QUALITY_HINT_PATTERN.test(toSearchText(candidate)) && hasResolutionLikeOptions(candidate))
      )

    if (hasSizeAndResolutionPair) {
      resolutionCandidates.forEach((candidate) => consumedIds.add(candidate.id))
    } else if (resolutionParam) {
      consumedIds.add(resolutionParam.id)
    }
  } else if (resolutionParam) {
    consumedIds.add(resolutionParam.id)
  }

  return {
    aspectParam,
    resolutionParam,
    consumedParamIds: Array.from(consumedIds),
  }
}

interface AspectValueCandidate {
  optionValue: string | number
  ratio: number
}

function toAspectValueCandidates(param: ChoiceParamDescriptor): AspectValueCandidate[] {
  return param.options.reduce<AspectValueCandidate[]>((acc, option) => {
    const ratioFromValue = parseRatioFromRaw(option.value)
    if (ratioFromValue !== null) {
      acc.push({ optionValue: option.value, ratio: ratioFromValue })
      return acc
    }

    const ratioFromLabel = parseRatioFromRaw(toLabelText(option.label))
    if (ratioFromLabel !== null) {
      acc.push({ optionValue: option.value, ratio: ratioFromLabel })
    }
    return acc
  }, [])
}

export function findSquareAspectValue(param: ChoiceParamDescriptor): string | number | null {
  const candidates = toAspectValueCandidates(param)
  const squareCandidate = candidates.find((candidate) => Math.abs(candidate.ratio - 1) < 0.001)
  return squareCandidate ? squareCandidate.optionValue : null
}

export function resolveClosestAspectValue(
  param: ChoiceParamDescriptor,
  targetRatio: number
): string | number | null {
  const candidates = toAspectValueCandidates(param)
  if (candidates.length === 0) {
    return null
  }

  let best = candidates[0]
  let bestDiff = Math.abs(best.ratio - targetRatio)

  for (const candidate of candidates.slice(1)) {
    const diff = Math.abs(candidate.ratio - targetRatio)
    if (diff < bestDiff) {
      best = candidate
      bestDiff = diff
    }
  }

  return best.optionValue
}
