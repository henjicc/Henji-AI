import { registry } from '@/core/ModelRegistry'
import {
  analyzeRatioResolutionParams,
  getAspectChoiceParams,
} from '@/core/params/ratioResolution'
import type { I18nText, ParamDef } from '@/core/types'
import { getI18nText } from '@/core/types'
import { mergeModelAliasParamDefaults } from '@/core/params/modelAliasDefaults'

interface ChoiceOption {
  value: string | number
  label: I18nText | string
  disabled?: boolean
}

interface SchemaSemantics {
  aspectIds: Set<string>
  resolutionIds: Set<string>
}

export interface TransferModelParamOverridesOptions {
  sourceSchema: ParamDef[]
  targetSchema: ParamDef[]
  sourceValues: DynamicValueMap
  sourceDefaults: DynamicValueMap
}

const UNSAFE_AUTOMATIC_TRANSFER_PATTERN = /(mode|audio|sound|bgm|music|off.?peak|service.?tier|web.?search|watermark|nsfw|safety|fast|turbo|fixed.?lens|camera|motion.?control|keep.?original|模式|音频|声音|音效|背景音乐|错峰|服务等级|联网搜索|水印|安全|快速|镜头)/i
const DURATION_PATTERN = /(duration|video.?length|时长)/i
const FPS_PATTERN = /(^|[^a-z])fps([^a-z]|$)|frame.?rate|帧率/i
const OUTPUT_COUNT_PATTERN = /(num.?images|num.?videos|output.?count|batch.?size|生成数量|输出数量)/i
const SEED_PATTERN = /(^|[^a-z])seed([^a-z]|$)|随机种子/i
const NEGATIVE_PROMPT_PATTERN = /(negative.?prompt|负面提示词|反向提示词)/i
const GUIDANCE_PATTERN = /(guidance|cfg.?scale|引导系数)/i
const STEPS_PATTERN = /(inference.?steps|num.?steps|采样步数|推理步数)/i
const QUALITY_PATTERN = /(^|[^a-z])quality([^a-z]|$)|画质|质量/i

function normalizeToken(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function labelText(label: I18nText | string): string {
  if (typeof label === 'string') return label
  return getI18nText(label, 'zh') || getI18nText(label, 'en') || ''
}

function paramSearchText(param: ParamDef): string {
  return [param.id, param.apiField, labelText(param.name)].filter(Boolean).join(' ')
}

function buildSchemaSemantics(schema: ParamDef[]): SchemaSemantics {
  const aspectIds = new Set(getAspectChoiceParams(schema).map((param) => param.id))
  const ratioResolution = analyzeRatioResolutionParams(schema, [])
  const resolutionIds = new Set(
    (ratioResolution?.consumedParamIds ?? []).filter((id) => !aspectIds.has(id))
  )

  for (const param of schema) {
    if (param.type === 'aspect-ratio') aspectIds.add(param.id)
    if (param.type === 'resolution') resolutionIds.add(param.id)
  }

  return { aspectIds, resolutionIds }
}

function semanticKey(param: ParamDef, semantics: SchemaSemantics): string | null {
  const explicitKey = param.transferKey?.trim()
  if (explicitKey) return `explicit:${explicitKey}`
  if (semantics.aspectIds.has(param.id)) return 'output.aspect-ratio'
  if (semantics.resolutionIds.has(param.id)) return 'output.resolution'

  const text = paramSearchText(param)
  if (DURATION_PATTERN.test(text)) return 'video.duration'
  if (FPS_PATTERN.test(text)) return 'video.fps'
  if (OUTPUT_COUNT_PATTERN.test(text)) return 'output.count'
  if (SEED_PATTERN.test(text)) return 'generation.seed'
  if (NEGATIVE_PROMPT_PATTERN.test(text)) return 'prompt.negative'
  if (GUIDANCE_PATTERN.test(text)) return 'generation.guidance'
  if (STEPS_PATTERN.test(text)) return 'generation.steps'
  if (QUALITY_PATTERN.test(text)) return 'output.quality'
  return null
}

function isSimpleParam(param: ParamDef): boolean {
  return param.type !== 'panel'
    && param.type !== 'composite'
    && param.type !== 'image-upload'
    && param.type !== 'video-upload'
    && param.type !== 'file-upload'
}

function isSimpleValue(value: DynamicValue): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isModifiedValue(value: DynamicValue, defaultValue: DynamicValue): boolean {
  return isSimpleValue(value) && !Object.is(value, defaultValue)
}

function automaticTransferAllowed(param: ParamDef): boolean {
  const behaviorText = [param.apiField, labelText(param.name)].filter(Boolean).join(' ')
  return !UNSAFE_AUTOMATIC_TRANSFER_PATTERN.test(behaviorText)
}

function matchScore(
  source: ParamDef,
  target: ParamDef,
  sourceSemantics: SchemaSemantics,
  targetSemantics: SchemaSemantics
): number {
  const sourceExplicit = source.transferKey?.trim()
  const targetExplicit = target.transferKey?.trim()
  if (sourceExplicit && targetExplicit && sourceExplicit === targetExplicit) return 100

  if (!automaticTransferAllowed(source) || !automaticTransferAllowed(target)) return 0

  const sourceSemantic = semanticKey(source, sourceSemantics)
  const targetSemantic = semanticKey(target, targetSemantics)
  if (sourceSemantic && sourceSemantic === targetSemantic) return 90

  const sourceApiField = normalizeToken(source.apiField)
  const targetApiField = normalizeToken(target.apiField)
  if (sourceApiField && sourceApiField === targetApiField) return 70

  const sourceId = normalizeToken(source.id)
  const targetId = normalizeToken(target.id)
  if (sourceId && sourceId === targetId) return 60

  const sourceName = normalizeToken(labelText(source.name))
  const targetName = normalizeToken(labelText(target.name))
  return sourceName && sourceName === targetName ? 50 : 0
}

function choiceOptions(param: ParamDef): ChoiceOption[] {
  if (param.type === 'dropdown' || param.type === 'radio' || param.type === 'aspect-ratio') {
    return param.options
      .map((option) => ({ value: option.value, label: option.label, disabled: 'disabled' in option ? option.disabled : false }))
      .filter((option) => option.disabled !== true)
  }
  if (param.type === 'resolution') {
    return param.presets.map((preset) => ({ value: preset.value, label: preset.label }))
  }
  return []
}

function selectedChoiceText(param: ParamDef, value: DynamicValue): string[] {
  const option = choiceOptions(param).find((candidate) => Object.is(candidate.value, value))
  return [String(value), option ? labelText(option.label) : ''].filter(Boolean)
}

function parseRatio(text: string): number | null {
  const aliases: Record<string, string> = {
    landscape: '16:9', portrait: '9:16', square: '1:1', square_hd: '1:1',
    portrait_4_3: '3:4', portrait_3_2: '2:3', portrait_16_9: '9:16',
    landscape_4_3: '4:3', landscape_3_2: '3:2', landscape_16_9: '16:9', landscape_21_9: '21:9',
  }
  const normalized = text.trim().toLowerCase()
  const candidate = aliases[normalized] ?? normalized
  const match = candidate.match(/(\d+)\s*:\s*(\d+)/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? width / height : null
}

function parseResolution(text: string): number | null {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, '')
  const dimensions = normalized.match(/(\d{3,5})[x*×](\d{3,5})/)
  if (dimensions) return Math.min(Number(dimensions[1]), Number(dimensions[2]))
  const pValue = normalized.match(/(\d{3,4})p/)
  if (pValue) return Number(pValue[1])
  const kValue = normalized.match(/(^|[^0-9])(2|4|8)k([^0-9]|$)/)
  if (kValue) return ({ '2': 1440, '4': 2160, '8': 4320 } as const)[kValue[2] as '2' | '4' | '8']
  return null
}

function parseNumericChoice(texts: string[]): number | null {
  for (const text of texts) {
    const match = text.match(/-?\d+(?:\.\d+)?/)
    if (match) return Number(match[0])
  }
  return null
}

function closestChoice(
  options: ChoiceOption[],
  target: number,
  parser: (text: string) => number | null
): string | number | undefined {
  let best: { value: string | number; distance: number } | undefined
  for (const option of options) {
    const parsed = parser(String(option.value)) ?? parser(labelText(option.label))
    if (parsed === null) continue
    const distance = Math.abs(parsed - target)
    if (!best || distance < best.distance) best = { value: option.value, distance }
  }
  return best?.value
}

function exactChoice(options: ChoiceOption[], value: DynamicValue): string | number | undefined {
  const exact = options.find((option) => Object.is(option.value, value))
  if (exact) return exact.value
  const normalized = normalizeToken(String(value))
  return options.find((option) => normalizeToken(String(option.value)) === normalized)?.value
}

function clampNumber(value: number, target: ParamDef): number | undefined {
  if (target.type !== 'number' || !Number.isFinite(value)) return undefined
  const min = target.min ?? Number.NEGATIVE_INFINITY
  const max = target.max ?? Number.POSITIVE_INFINITY
  let next = Math.min(max, Math.max(min, value))
  if (target.step && target.step > 0) {
    const base = Number.isFinite(min) ? min : 0
    next = base + Math.round((next - base) / target.step) * target.step
    next = Math.min(max, Math.max(min, next))
  }
  return next
}

function convertValue(
  source: ParamDef,
  target: ParamDef,
  value: DynamicValue,
  semantic: string | null
): DynamicValue | undefined {
  if (!isSimpleValue(value)) return undefined
  if (target.type === 'switch') return typeof value === 'boolean' ? value : undefined
  if (target.type === 'number') {
    const numeric = typeof value === 'number' ? value : Number(value)
    return clampNumber(numeric, target)
  }
  if (target.type === 'text' || target.type === 'textarea') {
    return typeof value === 'string' ? value : undefined
  }

  const options = choiceOptions(target)
  if (options.length === 0) return undefined
  const exact = exactChoice(options, value)
  if (exact !== undefined) return exact

  const sourceTexts = selectedChoiceText(source, value)
  if (semantic === 'output.aspect-ratio') {
    const ratio = sourceTexts.map(parseRatio).find((candidate) => candidate !== null)
    return ratio === undefined ? undefined : closestChoice(options, ratio, parseRatio)
  }
  if (semantic === 'output.resolution') {
    const resolution = sourceTexts.map(parseResolution).find((candidate) => candidate !== null)
    return resolution === undefined ? undefined : closestChoice(options, resolution, parseResolution)
  }
  if (semantic === 'video.duration' || semantic === 'video.fps' || semantic === 'output.count') {
    const numeric = parseNumericChoice(sourceTexts)
    return numeric === null
      ? undefined
      : closestChoice(options, numeric, (text) => parseNumericChoice([text]))
  }
  return undefined
}

export function transferModelParamOverrides({
  sourceSchema,
  targetSchema,
  sourceValues,
  sourceDefaults,
}: TransferModelParamOverridesOptions): DynamicValueMap {
  const sourceSemantics = buildSchemaSemantics(sourceSchema)
  const targetSemantics = buildSchemaSemantics(targetSchema)
  const usedSourceIds = new Set<string>()
  const overrides: DynamicValueMap = {}

  for (const target of targetSchema) {
    if (!isSimpleParam(target)) continue
    let best: { param: ParamDef; score: number } | undefined

    for (const source of sourceSchema) {
      if (usedSourceIds.has(source.id) || !isSimpleParam(source)) continue
      const value = sourceValues[source.id]
      if (!isModifiedValue(value, sourceDefaults[source.id])) continue
      const score = matchScore(source, target, sourceSemantics, targetSemantics)
      if (score > 0 && (!best || score > best.score)) best = { param: source, score }
    }

    if (!best) continue
    const sourceSemantic = semanticKey(best.param, sourceSemantics)
    const targetSemantic = semanticKey(target, targetSemantics)
    const semantic = sourceSemantic === targetSemantic ? sourceSemantic : null
    const converted = convertValue(best.param, target, sourceValues[best.param.id], semantic)
    if (converted === undefined) continue
    overrides[target.id] = converted
    usedSourceIds.add(best.param.id)
  }

  return overrides
}

export function transferModelParamOverridesBetweenModels(
  sourceModelId: string,
  targetModelId: string,
  sourceValues: DynamicValueMap
): DynamicValueMap {
  const sourceModel = registry.getModel(sourceModelId)
  const targetModel = registry.getModel(targetModelId)
  if (sourceModel && targetModel && sourceModel.meta.id === targetModel.meta.id) {
    return mergeModelAliasParamDefaults(sourceModelId, sourceModel, sourceValues)
  }
  return transferModelParamOverrides({
    sourceSchema: registry.getSchema(sourceModelId),
    targetSchema: registry.getSchema(targetModelId),
    sourceValues,
    sourceDefaults: registry.getDefaultValues(sourceModelId),
  })
}
