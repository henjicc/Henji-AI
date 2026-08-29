import type { PromptMediaBinding } from '@/core/inputs/promptDocument'
import { registry } from '@/core/ModelRegistry'
import { derivedMediaStateKey } from '@/core/params/derivedMediaState'
import type { ParamDef } from '@/core/types'

const MEDIA_URL_FIELDS = [
  'imageUrl',
  'previewImageUrl',
  'panoramaPreviewImageUrl',
  'environmentImageUrl',
  'videoUrl',
  'audioUrl',
] as const
const MEDIA_INPUT_KINDS = ['image', 'video', 'audio'] as const
const MEDIA_PARAM_TYPES = new Set<ParamDef['type']>([
  'image-upload',
  'video-upload',
  'file-upload',
])

export type CanvasNodeMediaValueMapper = (value: string) => string

function mapMediaParamValue(value: DynamicValue, mapValue: CanvasNodeMediaValueMapper): DynamicValue {
  if (typeof value === 'string' && value) return mapValue(value)
  if (!Array.isArray(value)) return value
  return value.map((item) => (
    typeof item === 'string' && item ? mapValue(item) : item
  ))
}

function mapModelParamMediaReferences(
  modelId: string,
  paramsValue: DynamicValue,
  mapValue: CanvasNodeMediaValueMapper,
): DynamicValue {
  if (!paramsValue || typeof paramsValue !== 'object' || Array.isArray(paramsValue)) {
    return paramsValue
  }
  const schema = registry.getSchema(modelId)
  if (schema.length === 0) return paramsValue

  const params = { ...(paramsValue as DynamicValueMap) }
  let changed = false
  for (const param of schema) {
    if (MEDIA_PARAM_TYPES.has(param.type) && params[param.id] !== undefined) {
      params[param.id] = mapMediaParamValue(params[param.id], mapValue)
      changed = true
    }
    if (param.type !== 'image-upload' || !param.derivedMediaAuthoring) continue
    const stateKey = derivedMediaStateKey(param.id)
    const documentValue = params[stateKey]
    if (!documentValue || typeof documentValue !== 'object' || Array.isArray(documentValue)) continue
    const sourceRef = (documentValue as DynamicValueMap).sourceRef
    if (typeof sourceRef !== 'string' || !sourceRef) continue
    params[stateKey] = {
      ...(documentValue as DynamicValueMap),
      sourceRef: mapValue(sourceRef),
    }
    changed = true
  }
  return changed ? params : paramsValue
}

/** 遍历节点全部可落盘媒体值；结构化文档本身只保存 resourceId。 */
export function mapCanvasNodeMediaReferences(
  data: DynamicValueMap,
  mapValue: CanvasNodeMediaValueMapper,
): DynamicValueMap {
  const next: DynamicValueMap = { ...data }

  MEDIA_URL_FIELDS.forEach((field) => {
    const value = next[field]
    if (typeof value === 'string' && value) next[field] = mapValue(value)
  })

  if (Array.isArray(next.frames)) {
    next.frames = next.frames.map((frame) => {
      if (!frame || typeof frame !== 'object') return frame
      const frameRecord = { ...(frame as DynamicValueMap) }
      ;(['imageUrl', 'previewImageUrl'] as const).forEach((field) => {
        const value = frameRecord[field]
        if (typeof value === 'string' && value) frameRecord[field] = mapValue(value)
      })
      return frameRecord
    })
  }

  if (next.mediaInputs && typeof next.mediaInputs === 'object') {
    const inputs = { ...(next.mediaInputs as DynamicValueMap) }
    MEDIA_INPUT_KINDS.forEach((kind) => {
      const values = inputs[kind]
      if (Array.isArray(values)) {
        inputs[kind] = values.map((value) => (
          typeof value === 'string' && value ? mapValue(value) : value
        ))
      }
    })
    next.mediaInputs = inputs
  }

  if (Array.isArray(next.promptMediaBindings)) {
    next.promptMediaBindings = next.promptMediaBindings.map((binding) => {
      if (!binding || typeof binding !== 'object') return binding
      const nextBinding = { ...(binding as PromptMediaBinding) }
      if (typeof nextBinding.dataUrl === 'string' && nextBinding.dataUrl) {
        nextBinding.dataUrl = mapValue(nextBinding.dataUrl)
      }
      if (typeof nextBinding.filePath === 'string' && nextBinding.filePath) {
        nextBinding.filePath = mapValue(nextBinding.filePath)
      }
      return nextBinding
    })
  }

  const modelId = next.modelId
  if (typeof modelId === 'string' && modelId && next.params !== undefined) {
    next.params = mapModelParamMediaReferences(modelId, next.params, mapValue)
  }

  const layerStackDocument = next.layerStackDocument
  if (layerStackDocument && typeof layerStackDocument === 'object' && !Array.isArray(layerStackDocument)) {
    const document = { ...(layerStackDocument as DynamicValueMap) }
    if (document.source && typeof document.source === 'object' && !Array.isArray(document.source)) {
      const source = { ...(document.source as DynamicValueMap) }
      if (typeof source.inputResourceId === 'string' && source.inputResourceId) {
        source.inputResourceId = mapValue(source.inputResourceId)
      }
      document.source = source
    }
    if (Array.isArray(document.resources)) {
      document.resources = document.resources.map((resource) => {
        if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return resource
        const nextResource = { ...(resource as DynamicValueMap) }
        if (typeof nextResource.filePath === 'string' && nextResource.filePath) {
          nextResource.filePath = mapValue(nextResource.filePath)
        }
        return nextResource
      })
    }
    next.layerStackDocument = document
  }

  return next
}
