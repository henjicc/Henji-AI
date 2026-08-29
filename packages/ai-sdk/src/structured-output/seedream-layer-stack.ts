import { AiRuntimeError } from '../runtime/AiRuntimeError'
import type {
  JsonObject,
  JsonValue,
  StructuredGenerationBoundingBoxV1,
  StructuredGenerationLayerStackV1,
  StructuredGenerationLayerV1,
} from '../types/runtime'

type SeedreamLayerProvider = 'volcengine' | 'apimart' | 'kie'

interface RawLayer {
  sourceOutputIndex: number
  url: unknown
  zIndex: unknown
  name?: unknown
  description?: unknown
  size: unknown
  format: unknown
  boundingBox?: unknown
}

export function parseSeedreamLayerStack(
  provider: SeedreamLayerProvider,
  metadata: JsonValue
): StructuredGenerationLayerStackV1 {
  const rawLayers = provider === 'volcengine'
    ? readVolcengineLayers(metadata)
    : provider === 'apimart'
      ? readApiMartLayers(metadata)
      : readKieLayers(metadata)
  const outputs = validateLayers(rawLayers)
  return {
    version: 1,
    kind: 'layer-stack',
    primary: outputs[0],
    outputs,
    metadata: {
      colorSpace: 'srgb',
      alphaMode: 'straight',
      compositeOperation: 'source-over',
      order: 'bottom-to-top',
    },
  }
}

function readVolcengineLayers(value: JsonValue): RawLayer[] {
  const root = object(value, '火山响应')
  const data = array(root.data, '火山 data')
  return data.map((item, sourceOutputIndex) => {
    const layer = object(item, `火山 data[${sourceOutputIndex}]`)
    return fromObject(layer, sourceOutputIndex)
  })
}

function readApiMartLayers(value: JsonValue): RawLayer[] {
  const root = object(value, 'APIMart 响应')
  const data = isObject(root.data) ? root.data : root
  const result = object(data.result, 'APIMart result')
  const images = array(result.images, 'APIMart result.images')
  if (images.length !== 1) invalid('APIMart 图层响应必须且只能包含一组 images')
  const image = object(images[0], 'APIMart result.images[0]')
  const urls = array(image.url, 'APIMart url')
  const sizes = array(image.sizes, 'APIMart sizes')
  const formats = array(image.output_formats, 'APIMart output_formats')
  const layers = array(image.layers, 'APIMart layers')
  if (urls.length !== sizes.length || urls.length !== formats.length || urls.length !== layers.length) {
    invalid('APIMart 图层平行数组长度不一致')
  }
  return layers.map((item, sourceOutputIndex) => {
    const layer = object(item, `APIMart layers[${sourceOutputIndex}]`)
    return {
      ...fromObject(layer, sourceOutputIndex),
      url: urls[sourceOutputIndex],
      size: sizes[sourceOutputIndex],
      format: formats[sourceOutputIndex],
    }
  })
}

function readKieLayers(value: JsonValue): RawLayer[] {
  const root = object(value, 'KIE 响应')
  const data = object(root.data, 'KIE data')
  if (typeof data.resultJson !== 'string') invalid('KIE resultJson 缺失')
  let parsed: JsonValue
  try {
    parsed = JSON.parse(data.resultJson) as JsonValue
  } catch {
    return invalid('KIE resultJson 不是合法 JSON')
  }
  const resultObject = object(object(parsed, 'KIE resultJson').resultObject, 'KIE resultObject')
  return array(resultObject.layers_data, 'KIE layers_data').map((item, sourceOutputIndex) => {
    const layer = object(item, `KIE layers_data[${sourceOutputIndex}]`)
    return fromObject(layer, sourceOutputIndex)
  })
}

function fromObject(layer: JsonObject, sourceOutputIndex: number): RawLayer {
  return {
    sourceOutputIndex,
    url: layer.url,
    zIndex: layer.z_index,
    name: layer.name,
    description: layer.description,
    size: layer.size,
    format: layer.output_format,
    boundingBox: layer.bounding_box,
  }
}

function validateLayers(rawLayers: RawLayer[]): StructuredGenerationLayerV1[] {
  if (rawLayers.length < 1 || rawLayers.length > 17) {
    invalid(`图层输出数量必须为 1..17，实际 ${rawLayers.length}`)
  }
  const zIndexes = new Set<number>()
  const outputs = rawLayers.map((raw): StructuredGenerationLayerV1 => {
    const url = nonEmptyString(raw.url, `layers[${raw.sourceOutputIndex}].url`)
    const zIndex = integer(raw.zIndex, `layers[${raw.sourceOutputIndex}].z_index`)
    if (zIndex < 0 || zIndex > 16 || zIndexes.has(zIndex)) invalid(`图层 z_index 无效或重复：${zIndex}`)
    zIndexes.add(zIndex)
    const { width, height } = parseSize(raw.size, raw.sourceOutputIndex)
    const format = parseFormat(raw.format, raw.sourceOutputIndex)
    if (zIndex > 0 && format !== 'png') invalid(`内容层 ${zIndex} 必须为 PNG`)
    const boundingBox = parseBoundingBox(raw.boundingBox, zIndex)
    const name = optionalString(raw.name)
    const description = optionalString(raw.description)
    return {
      version: 1,
      sourceOutputIndex: raw.sourceOutputIndex,
      url,
      zIndex,
      role: zIndex === 0 ? 'base' : 'content',
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      width,
      height,
      format,
      ...(boundingBox ? { boundingBox } : {}),
    }
  }).sort((left, right) => left.zIndex - right.zIndex)
  if (outputs[0]?.zIndex !== 0) invalid('图层响应缺少 z_index=0 的底图')
  if (outputs.some((layer, index) => layer.zIndex !== index)) invalid('图层 z_index 必须从 0 开始连续')
  return outputs
}

function parseSize(value: unknown, index: number): { width: number; height: number } {
  if (typeof value !== 'string') invalid(`layers[${index}].size 缺失`)
  const match = /^(\d+)x(\d+)$/.exec(value.trim())
  if (!match) return invalid(`layers[${index}].size 必须为 WIDTHxHEIGHT`)
  const width = Number(match[1])
  const height = Number(match[2])
  if (width < 1 || height < 1) invalid(`layers[${index}].size 必须为正尺寸`)
  return { width, height }
}

function parseFormat(value: unknown, index: number): StructuredGenerationLayerV1['format'] {
  const normalized = nonEmptyString(value, `layers[${index}].format`).toLowerCase()
  if (normalized === 'jpg') return 'jpeg'
  if (normalized === 'png' || normalized === 'jpeg' || normalized === 'webp') return normalized
  return invalid(`layers[${index}].format 不受支持：${normalized}`)
}

function parseBoundingBox(value: unknown, zIndex: number): StructuredGenerationBoundingBoxV1 | undefined {
  if (value === undefined || value === null) {
    if (zIndex > 0) invalid(`内容层 ${zIndex} 缺少 bounding_box`)
    return undefined
  }
  if (!isJsonValue(value)) invalid(`图层 ${zIndex} bounding_box 不是 JSON`)
  const box = object(value, `图层 ${zIndex} bounding_box`)
  const absolute = tuple(box.absolute, `图层 ${zIndex} bounding_box.absolute`, false)
  const normalized = tuple(box.normalized, `图层 ${zIndex} bounding_box.normalized`, true)
  if (!absolute && !normalized) invalid(`图层 ${zIndex} bounding_box 至少需要一种坐标`)
  return { ...(absolute ? { absolute } : {}), ...(normalized ? { normalized } : {}) }
}

function tuple(value: JsonValue | undefined, label: string, normalized: boolean): [number, number, number, number] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 4 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    return invalid(`${label} 必须为 4 个有限数字`)
  }
  const result = value as [number, number, number, number]
  if (result[2] <= result[0] || result[3] <= result[1]) invalid(`${label} 必须满足 right>left 且 bottom>top`)
  if (normalized && result.some((item) => item < 0 || item > 1000)) invalid(`${label} 必须位于 0..1000`)
  return result
}

function object(value: JsonValue | undefined, label: string): JsonObject {
  if (!isObject(value)) return invalid(`${label} 必须为对象`)
  return value
}

function array(value: JsonValue | undefined, label: string): JsonValue[] {
  if (!Array.isArray(value)) return invalid(`${label} 必须为数组`)
  return value
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isObject(value) && Object.values(value).every(isJsonValue)
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) return invalid(`${label} 不能为空`)
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return invalid(`${label} 必须为整数`)
  return value
}

function invalid(message: string): never {
  throw new AiRuntimeError('invalid_response', message)
}
