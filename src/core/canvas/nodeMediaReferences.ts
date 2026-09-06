import { derivedMediaStateKey } from '../params/derivedMediaStateKey'

export interface CanvasMediaParamDescriptor { id: string; type: string }
export type CanvasMediaSchemaResolver = (modelId: string) => readonly CanvasMediaParamDescriptor[] | undefined

const MEDIA_URL_FIELDS = [
  'imageUrl',
  'previewImageUrl',
  'panoramaPreviewImageUrl',
  'environmentImageUrl',
  'localRedrawMaskSource',
  'videoUrl',
  'audioUrl',
] as const
const MEDIA_INPUT_KINDS = ['image', 'video', 'audio'] as const
const MEDIA_PARAM_TYPES = new Set<string>([
  'image-upload',
  'video-upload',
  'file-upload',
])

export type CanvasNodeMediaValueMapper = (value: string) => string

function mapMediaParamValue(value: unknown, mapValue: CanvasNodeMediaValueMapper): unknown {
  if (typeof value === 'string' && value) return mapValue(value)
  if (!Array.isArray(value)) return value
  return value.map((item) => (
    typeof item === 'string' && item ? mapValue(item) : item
  ))
}

function mapModelParamMediaReferences(
  modelId: string,
  paramsValue: unknown,
  mapValue: CanvasNodeMediaValueMapper,
  resolveSchema: CanvasMediaSchemaResolver,
): unknown {
  if (!paramsValue || typeof paramsValue !== 'object' || Array.isArray(paramsValue)) {
    return paramsValue
  }
  const schema = resolveSchema(modelId) ?? []
  if (schema.length === 0) return paramsValue

  const params = { ...(paramsValue as Record<string, unknown>) }
  let changed = false
  for (const param of schema) {
    if (MEDIA_PARAM_TYPES.has(param.type) && params[param.id] !== undefined) {
      params[param.id] = mapMediaParamValue(params[param.id], mapValue)
      changed = true
    }
    if (param.type !== 'image-upload') continue
    const stateKey = derivedMediaStateKey(param.id)
    const documentValue = params[stateKey]
    if (!documentValue || typeof documentValue !== 'object' || Array.isArray(documentValue)) continue
    const sourceRef = (documentValue as Record<string, unknown>).sourceRef
    if (typeof sourceRef !== 'string' || !sourceRef) continue
    params[stateKey] = {
      ...(documentValue as Record<string, unknown>),
      sourceRef: mapValue(sourceRef),
    }
    changed = true
  }
  return changed ? params : paramsValue
}

/** 遍历节点全部可落盘媒体值；结构化文档本身只保存 resourceId。 */
export function mapCanvasNodeMediaReferences(
  data: Record<string, unknown>,
  mapValue: CanvasNodeMediaValueMapper,
  resolveSchema: CanvasMediaSchemaResolver,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data }

  MEDIA_URL_FIELDS.forEach((field) => {
    const value = next[field]
    if (typeof value === 'string' && value) next[field] = mapValue(value)
  })

  if (Array.isArray(next.frames)) {
    next.frames = next.frames.map((frame) => {
      if (!frame || typeof frame !== 'object') return frame
      const frameRecord = { ...(frame as Record<string, unknown>) }
      ;(['imageUrl', 'previewImageUrl'] as const).forEach((field) => {
        const value = frameRecord[field]
        if (typeof value === 'string' && value) frameRecord[field] = mapValue(value)
      })
      return frameRecord
    })
  }

  if (next.mediaInputs && typeof next.mediaInputs === 'object') {
    const inputs = { ...(next.mediaInputs as Record<string, unknown>) }
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
      const nextBinding = { ...(binding as Record<string, unknown>) }
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
    next.params = mapModelParamMediaReferences(modelId, next.params, mapValue, resolveSchema)
  }

  const localRedrawMaskDocument = next.localRedrawMaskDocument
  if (localRedrawMaskDocument && typeof localRedrawMaskDocument === 'object' && !Array.isArray(localRedrawMaskDocument)) {
    const document = { ...(localRedrawMaskDocument as Record<string, unknown>) }
    if (typeof document.sourceRef === 'string' && document.sourceRef) {
      document.sourceRef = mapValue(document.sourceRef)
    }
    next.localRedrawMaskDocument = document
  }

  const generationLocalRedrawContext = next.generationLocalRedrawContext
  if (generationLocalRedrawContext && typeof generationLocalRedrawContext === 'object' && !Array.isArray(generationLocalRedrawContext)) {
    const context = { ...(generationLocalRedrawContext as Record<string, unknown>) }
    ;(['source', 'mask'] as const).forEach((field) => {
      if (typeof context[field] === 'string' && context[field]) context[field] = mapValue(context[field])
    })
    next.generationLocalRedrawContext = context
  }

  const layerStackDocument = next.layerStackDocument
  if (layerStackDocument && typeof layerStackDocument === 'object' && !Array.isArray(layerStackDocument)) {
    const document = { ...(layerStackDocument as Record<string, unknown>) }
    if (document.source && typeof document.source === 'object' && !Array.isArray(document.source)) {
      const source = { ...(document.source as Record<string, unknown>) }
      if (typeof source.inputResourceId === 'string' && source.inputResourceId) {
        source.inputResourceId = mapValue(source.inputResourceId)
      }
      document.source = source
    }
    if (Array.isArray(document.resources)) {
      document.resources = document.resources.map((resource) => {
        if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return resource
        const nextResource = { ...(resource as Record<string, unknown>) }
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
